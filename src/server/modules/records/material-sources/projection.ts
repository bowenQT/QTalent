import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  materialSourceSchema,
  materialSourceLocationSchema,
  sourceReferenceSchema,
} from '../../../../contracts/sources';

const nonblank = z.string().min(1).regex(/\S/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const bindingSchema = z.strictObject({
  parseVersionId: nonblank,
  originalVersionId: nonblank,
  contentDigest: digest,
  parserVersion: nonblank,
  projectionVersion: nonblank,
});
const pageSchema = z.strictObject({
  page: z.number().int().positive(),
  text: z.string(),
});
const pdfSourceSchema = materialSourceSchema.transform((source) => {
  if (source.location.kind !== 'pdf') throw new MaterialProjectionError();
  return { ...source, location: source.location };
});
const inputSchema = z.strictObject({
  binding: bindingSchema,
  pages: z.array(pageSchema).min(1),
  fragments: z.array(pdfSourceSchema).min(1),
});
const storedSchema = inputSchema.extend({
  pages: z.array(pageSchema.extend({ textDigest: digest })).min(1),
  resultDigest: digest,
});

export type PdfParseBinding = z.infer<typeof bindingSchema>;
export type PdfProjection = ReturnType<typeof projectValidated>;

export class MaterialProjectionError extends Error {
  readonly code = 'invalid_pdf_projection';

  constructor() {
    super('invalid_pdf_projection');
    this.name = 'MaterialProjectionError';
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function high(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
function low(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
function validUnicode(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (high(code)) {
      if (!low(text.charCodeAt(++i))) return false;
    } else if (low(code)) return false;
  }
  return true;
}
function splitsPair(text: string, offset: number): boolean {
  return high(text.charCodeAt(offset - 1)) && low(text.charCodeAt(offset));
}

function projectValidated(
  input: z.infer<typeof inputSchema>,
  expected: PdfParseBinding,
) {
  // `expected` must come from independently loaded server facts, never the
  // request being checked. Equality alone does not authenticate a producer.
  if (JSON.stringify(input.binding) !== JSON.stringify(expected)) {
    throw new MaterialProjectionError();
  }
  const pages = input.pages
    .sort((a, b) => a.page - b.page)
    .map((page, index) => {
      // Include empty physical pages; missing/duplicate pages cannot be silently
      // renumbered into a different document. Reject lossy UTF-8 replacement.
      if (page.page !== index + 1 || !validUnicode(page.text)) {
        throw new MaterialProjectionError();
      }
      return { ...page, textDigest: sha256(page.text) };
    });
  const ids = new Set<string>();
  const fragments = input.fragments.sort((a, b) =>
    a.fragmentId < b.fragmentId ? -1 : a.fragmentId > b.fragmentId ? 1 : 0,
  );
  for (const source of fragments) {
    const page = pages[source.location.page - 1];
    const { start, end } = source.location.textRange;
    if (
      source.originalVersionId !== expected.originalVersionId ||
      ids.has(source.fragmentId) ||
      !page ||
      end > page.text.length ||
      splitsPair(page.text, start) ||
      splitsPair(page.text, end) ||
      page.text.slice(start, end) !== source.excerpt
    ) {
      throw new MaterialProjectionError();
    }
    ids.add(source.fragmentId);
  }
  const result = { binding: input.binding, pages, fragments };
  // Domain/version separation makes the serialization rule explicit. This is
  // integrity/replay metadata, not a signature or a permission decision.
  const resultDigest = sha256(
    JSON.stringify(['pdf-projection-bundle-v1', result]),
  );
  return { ...result, resultDigest };
}

/** Private pure boundary. No PDF decoding, database writes or access decision. */
export function projectPdfParse(input: unknown, expectedBinding: unknown) {
  try {
    return projectValidated(
      inputSchema.parse(input),
      bindingSchema.parse(expectedBinding),
    );
  } catch {
    throw new MaterialProjectionError();
  }
}

/** Revalidate persisted facts before use; authorization must happen separately. */
export function verifyPdfParse(input: unknown, expectedBinding: unknown) {
  try {
    const stored = storedSchema.parse(input);
    const result = projectValidated(
      {
        binding: stored.binding,
        pages: stored.pages.map(({ page, text }) => ({ page, text })),
        fragments: stored.fragments,
      },
      bindingSchema.parse(expectedBinding),
    );
    if (
      result.resultDigest !== stored.resultDigest ||
      stored.pages.some(
        (page) => result.pages[page.page - 1].textDigest !== page.textDigest,
      )
    ) {
      throw new MaterialProjectionError();
    }
    return result;
  } catch {
    throw new MaterialProjectionError();
  }
}

// BOW-866 producer interface frozen in #248/6560298661. This validates that
// boundary without importing an unmerged parser or implementing PDF decoding.
const pdfTextSchema = z.strictObject({
  version: z.literal('pdf-page-text-v1'),
  pages: z.array(pageSchema).min(1),
  ranges: z
    .array(
      z.strictObject({
        fragmentId: nonblank,
        page: z.number().int().positive(),
        textRange: materialSourceLocationSchema.options[3].shape.textRange,
      }),
    )
    .min(1),
});
const attachmentSchema = z.strictObject({
  status: z.literal('parsed'),
  parseVersionId: nonblank,
  originalVersionId: nonblank,
  sha256: digest,
  parserVersion: nonblank,
  fragments: z
    .array(sourceReferenceSchema.extend({ excerpt: nonblank }))
    .min(1),
  pdfText: pdfTextSchema,
});
const provenanceSchema = z.discriminatedUnion('sourceCategory', [
  z.strictObject({ sourceCategory: z.literal('original'), demo: z.boolean() }),
  z.strictObject({
    sourceCategory: z.literal('historical_evaluation'),
    evaluationKind: z.literal('interview'),
    demo: z.boolean(),
  }),
]);

/** Convert only the explicit page-text producer; never infer item offsets. */
export function projectAttachmentPdf(
  input: unknown,
  expectedBinding: unknown,
  serverProvenance: unknown,
) {
  try {
    const parsed = attachmentSchema.parse(input);
    const provenance = provenanceSchema.parse(serverProvenance);
    const ranges = new Map(
      parsed.pdfText.ranges.map((range) => [range.fragmentId, range]),
    );
    if (
      ranges.size !== parsed.pdfText.ranges.length ||
      ranges.size !== parsed.fragments.length
    ) {
      throw new MaterialProjectionError();
    }
    const fragments = parsed.fragments.map((fragment) => {
      const range = ranges.get(fragment.fragmentId);
      if (
        !range ||
        fragment.location.kind !== 'document' ||
        fragment.location.page !== range.page
      ) {
        throw new MaterialProjectionError();
      }
      return {
        fragmentId: fragment.fragmentId,
        originalVersionId: fragment.originalVersionId,
        location: { kind: 'pdf', page: range.page, textRange: range.textRange },
        excerpt: fragment.excerpt,
        ...provenance,
      };
    });
    return projectPdfParse(
      {
        binding: {
          parseVersionId: parsed.parseVersionId,
          originalVersionId: parsed.originalVersionId,
          contentDigest: parsed.sha256,
          parserVersion: parsed.parserVersion,
          projectionVersion: parsed.pdfText.version,
        },
        pages: parsed.pdfText.pages,
        fragments,
      },
      expectedBinding,
    );
  } catch {
    throw new MaterialProjectionError();
  }
}
