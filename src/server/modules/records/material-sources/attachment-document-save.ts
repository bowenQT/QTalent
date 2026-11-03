import { isDeepStrictEqual } from 'node:util';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Transaction } from '../../../db/client';
import { jobSnapshots } from '../../../jobs/schema';
import {
  attachmentBindingSchema,
  attachmentJobResultSchema,
} from '../attachments/flow';
import { DOCX_DECODER_VERSION } from '../attachments/document-protocol';
import { attachmentVersionSchema } from '../attachments/parse';
import { readValidatedUploadInTransaction } from '../uploads/handoff-transaction';
import {
  MaterialStoreError,
  prepareMaterialParse,
  writeMaterialParse,
} from './store';

const nonblank = z.string().min(1).regex(/\S/);
const documentParseSchema = z.strictObject({
  status: z.literal('parsed'),
  parseVersionId: nonblank,
  originalVersionId: nonblank,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  parserVersion: nonblank,
  fragments: z
    .array(
      z.strictObject({
        fragmentId: nonblank,
        originalVersionId: nonblank,
        excerpt: nonblank,
        location: z.strictObject({
          kind: z.literal('document'),
          paragraph: nonblank,
        }),
      }),
    )
    .min(1),
});
const provenanceSchema = z.strictObject({
  sourceCategory: z.literal('original'),
  demo: z.boolean(),
});
const docxMime =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Preserve the parser's paragraph locator, never manufacture PDF pages. The
 * expected version is an archived upload fact, not a browser-supplied locator. */
export function projectAttachmentDocument(
  input: unknown,
  expectedVersion: unknown,
  serverProvenance: unknown,
) {
  try {
    const parsed = documentParseSchema.parse(input);
    const version = attachmentVersionSchema.parse(expectedVersion);
    const provenance = provenanceSchema.parse(serverProvenance);
    const format =
      version.mediaType === 'text/plain' && /\.txt$/i.test(version.filename)
        ? 'txt'
        : version.mediaType === docxMime && /\.docx$/i.test(version.filename)
          ? 'docx'
          : null;
    if (
      !format ||
      parsed.originalVersionId !== version.originalVersionId ||
      parsed.sha256 !== version.sha256 ||
      parsed.parserVersion !==
        (format === 'txt' ? 'txt:v1' : `docx:${DOCX_DECODER_VERSION}`)
    )
      throw new Error('Unmatched document producer');
    let previousParagraph = 0;
    let previousEnd = 0;
    const locator =
      format === 'txt'
        ? /^txt:p([1-9]\d*):u16:(\d+)-(\d+)$/
        : /^docx:body:p([1-9]\d*):u16:(\d+)-(\d+)$/;
    for (const fragment of parsed.fragments) {
      const match = locator.exec(fragment.location.paragraph);
      const paragraph = Number(match?.[1]);
      const start = Number(match?.[2]);
      const end = Number(match?.[3]);
      if (
        !match ||
        ![paragraph, start, end].every(Number.isSafeInteger) ||
        paragraph <= previousParagraph ||
        end - start !== fragment.excerpt.length ||
        (format === 'txt' && start < previousEnd)
      )
        throw new Error('Invalid document paragraph');
      previousParagraph = paragraph;
      previousEnd = end;
    }
    return prepareMaterialParse({
      binding: {
        parseVersionId: parsed.parseVersionId,
        originalVersionId: version.originalVersionId,
        contentDigest: version.sha256,
        parserVersion: parsed.parserVersion,
        projectionVersion: 'document-paragraph-v1',
      },
      pages: [],
      fragments: parsed.fragments.map((fragment) => ({
        ...fragment,
        ...provenance,
      })),
    });
  } catch {
    throw new MaterialStoreError('invalid_material_parse');
  }
}

/** Run only after current source/write authorization, inside runAttachmentParse's
 * completion transaction. This adapter owns no queue, job lifecycle or permission. */
export async function saveAttachmentDocument(
  tx: Transaction,
  bindingInput: unknown,
  parsed: unknown,
  serverProvenance: unknown,
): Promise<'created' | 'existing'> {
  try {
    const binding = attachmentBindingSchema.parse(bindingInput);
    const [job] = await tx
      .select()
      .from(jobSnapshots)
      .where(eq(jobSnapshots.jobId, binding.completedJobId))
      .for('update');
    const result = attachmentJobResultSchema.safeParse(job?.result);
    if (
      !job ||
      job.kind !== 'media' ||
      job.resourceId !== binding.version.mediaId ||
      job.inputVersion !== binding.version.originalVersionId ||
      !['running', 'partial'].includes(job.status) ||
      job.cancelRequestedAt !== null ||
      !result.success ||
      result.data.stage !== 'parsing' ||
      result.data.mediaId !== job.resourceId
    )
      throw new MaterialStoreError('material_conflict');
    const upload = await readValidatedUploadInTransaction(tx, {
      uploadId: binding.version.mediaId,
      originalVersionId: binding.version.originalVersionId,
    });
    if (
      !upload ||
      upload.purpose !== 'attachment' ||
      upload.jobId !== job.jobId ||
      upload.accountId !== binding.accountId ||
      upload.recordCollectionId !== binding.recordCollectionId ||
      upload.quotaScope !== binding.quotaScope ||
      !isDeepStrictEqual(upload.target, binding.target) ||
      upload.filename !== binding.version.filename ||
      upload.object.mediaType !== binding.version.mediaType ||
      upload.object.byteLength !== binding.version.byteLength ||
      upload.object.sha256 !== binding.version.sha256
    )
      throw new MaterialStoreError('material_conflict');
    const projected = projectAttachmentDocument(
      parsed,
      binding.version,
      serverProvenance,
    );
    return await writeMaterialParse(
      tx,
      {
        binding: projected.binding,
        pages: [],
        fragments: projected.fragments,
      },
      {
        jobId: job.jobId,
        attempt: job.attempt,
        expectedRevision: job.revision,
        inputVersion: job.inputVersion,
      },
    );
  } catch (error) {
    if (error instanceof MaterialStoreError) throw error;
    throw new MaterialStoreError(
      error instanceof z.ZodError
        ? 'invalid_material_parse'
        : 'storage_unavailable',
    );
  }
}
