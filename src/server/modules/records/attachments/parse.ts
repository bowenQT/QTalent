import { createHash } from 'node:crypto';
import { z } from 'zod';
import { sourceLocationSchema } from '../../../../contracts/sources';
import { parseLimitsSchema } from './limits';
import { createDocumentDecoders } from './document-decoders';
import type {
  AttachmentParseOutcome,
  AttachmentSegment,
  ParseAttachmentInput,
  ParseFailureReason,
} from './types';

const id = z.string().min(1).max(200).regex(/\S/);
export const attachmentVersionSchema = z.strictObject({
  mediaId: id,
  originalVersionId: id,
  filename: z
    .string()
    .min(1)
    .refine((name) => !/[\\/\0]/.test(name)),
  mediaType: z.string().min(1),
  byteLength: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const segmentSchema = z.strictObject({
  excerpt: z.string().min(1).regex(/\S/),
  location: sourceLocationSchema.options[1],
});
const decodedSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('decoded'),
    segments: z.array(segmentSchema),
  }),
  z.strictObject({
    status: z.literal('unsupported'),
    reason: z.enum(['format', 'scanned']),
  }),
  z.strictObject({
    status: z.literal('failed'),
    reason: z.enum([
      'invalid_content',
      'resource_limit',
      'processing_failed',
      'cancelled',
    ]),
  }),
]);
const mime = {
  txt: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
} as const;
type Format = keyof typeof mime;
function failure(reason: ParseFailureReason): AttachmentParseOutcome {
  return {
    status: 'failed',
    reason,
    message:
      reason === 'empty'
        ? '附件没有可解析的文字'
        : reason === 'dependency_unavailable'
          ? '附件解析暂不可用，请稍后重试'
          : reason === 'resource_limit'
            ? '附件超出当前解析能力，请拆分后重试'
            : reason === 'cancelled'
              ? '附件解析已取消'
              : '附件解析失败，请稍后重试',
  };
}
function unsupported(reason: 'format' | 'scanned'): AttachmentParseOutcome {
  return {
    status: 'unsupported',
    reason,
    message:
      reason === 'scanned'
        ? '暂不支持扫描件，请上传文字型 PDF'
        : '暂不支持，请上传 TXT、DOCX 或文字型 PDF',
  };
}
function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function textSegments(text: string): AttachmentSegment[] {
  const result: AttachmentSegment[] = [];
  // A CRLF is one newline; do not let regex backtracking turn it into a blank line.
  const separators = /\f|(?:\r?\n|\r(?!\n))[^\S\r\n\f]*(?:\r?\n|\r(?!\n))/g;
  let cursor = 0;
  function add(end: number) {
    const raw = text.slice(cursor, end);
    const excerpt = raw.trim();
    if (excerpt.length === 0) return;
    const start = cursor + raw.length - raw.trimStart().length;
    result.push({
      excerpt,
      location: {
        kind: 'document',
        paragraph: `txt:p${result.length + 1}:u16:${start}-${start + excerpt.length}`,
      },
    });
  }
  for (const match of text.matchAll(separators)) {
    add(match.index);
    cursor = match.index + match[0].length;
  }
  add(text.length);
  return result;
}

/** Decode only a verified version. Processing budgets never redefine upload limits. */
export async function parseAttachment(
  input: ParseAttachmentInput,
): Promise<AttachmentParseOutcome> {
  const version = attachmentVersionSchema.safeParse(input.version);
  if (!version.success) return failure('invalid_content');
  const limits = parseLimitsSchema.parse(input.limits);
  if (input.signal?.aborted) return failure('cancelled');
  const format = (Object.keys(mime) as Format[]).find((format) =>
    version.data.filename.toLowerCase().endsWith(`.${format}`),
  );
  if (!format) return unsupported('format');
  if (
    version.data.mediaType.split(';', 1)[0].trim().toLowerCase() !==
    mime[format]
  )
    return failure('invalid_content');
  const decoder =
    format === 'txt'
      ? undefined
      : (input.decoders ?? createDocumentDecoders())[format];
  if (format !== 'txt' && !decoder) return failure('dependency_unavailable');
  if (version.data.byteLength > limits.maxBytes)
    return failure('resource_limit');

  let segments: AttachmentSegment[];
  let parserVersion: string;
  try {
    const chunks: Buffer[] = [];
    const hash = createHash('sha256');
    let byteLength = 0;
    for await (const chunk of input.content) {
      if (input.signal?.aborted) return failure('cancelled');
      if (!(chunk instanceof Uint8Array)) return failure('invalid_content');
      byteLength += chunk.byteLength;
      if (byteLength > limits.maxBytes) return failure('resource_limit');
      // Own every byte: a provider may reuse/mutate its stream buffer after yield.
      const owned = Buffer.from(chunk);
      hash.update(owned);
      chunks.push(owned);
    }
    if (input.signal?.aborted) return failure('cancelled');
    if (
      byteLength !== version.data.byteLength ||
      hash.digest('hex') !== version.data.sha256
    )
      return failure('integrity');
    if (byteLength === 0) return failure('empty');
    const bytes = Buffer.concat(chunks, byteLength);
    if (format === 'txt') {
      let text: string;
      try {
        text = new TextDecoder('utf-8', {
          fatal: true,
          ignoreBOM: true,
        }).decode(bytes);
      } catch {
        return failure('invalid_content');
      }
      if (text.startsWith('\uFEFF')) text = text.slice(1);
      if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(text))
        return failure('invalid_content');
      segments = textSegments(text);
      parserVersion = 'txt:v1';
    } else {
      // Optional adapters are an explicit dependency boundary. No fallback parser.
      if (!decoder || !id.safeParse(decoder.version).success)
        return failure('invalid_content');
      const decoded = decodedSchema.safeParse(
        await decoder.decode(bytes, { limits, signal: input.signal }),
      );
      if (input.signal?.aborted) return failure('cancelled');
      if (!decoded.success) return failure('invalid_content');
      if (decoded.data.status === 'unsupported')
        return unsupported(decoded.data.reason);
      if (decoded.data.status === 'failed') return failure(decoded.data.reason);
      segments = decoded.data.segments;
      if (
        format === 'pdf' &&
        segments.some((segment) => segment.location.page === undefined)
      )
        return failure('invalid_content');
      parserVersion = `${format}:${decoder.version}`;
    }
  } catch {
    // Stream/decoder exceptions may contain object keys or source text.
    return failure(input.signal?.aborted ? 'cancelled' : 'processing_failed');
  }
  if (segments.length === 0) return failure('empty');
  if (
    segments.length > limits.maxFragments ||
    segments.some((segment) => segment.excerpt.length > limits.maxFragmentChars)
  )
    return failure('resource_limit');
  const locators = segments.map((segment) => JSON.stringify(segment.location));
  if (new Set(locators).size !== locators.length)
    return failure('invalid_content');
  const parseVersionId = `attachment-parse:${digest([version.data.originalVersionId, version.data.sha256, parserVersion, segments])}`;
  return {
    status: 'parsed',
    parseVersionId,
    originalVersionId: version.data.originalVersionId,
    sha256: version.data.sha256,
    parserVersion,
    fragments: segments.map((segment) => ({
      ...segment,
      originalVersionId: version.data.originalVersionId,
      fragmentId: `attachment-fragment:${digest([parseVersionId, segment.location, segment.excerpt])}`,
    })),
  };
}
