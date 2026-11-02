import { z } from 'zod';
import type { InterviewReviewResult } from '../../modules/records/attachments/interview-review/types';

// Private wire validation for the fixed 900 DTO, not another business contract.
export const pdfIsolationBudgetSchema = z.strictObject({
  maxInputBytes: z
    .number()
    .int()
    .positive()
    .max(32 * 1024 ** 2),
  maxOutputBytes: z
    .number()
    .int()
    .positive()
    .max(2 * 1024 ** 2),
  maxDurationMs: z.number().int().positive().max(60_000).default(60_000),
  maxOldGenerationSizeMb: z.number().int().min(16).max(256).default(256),
});
export type PdfIsolationBudget = z.input<typeof pdfIsolationBudgetSchema>;
export const pdfWorkerRequestSchema = z.strictObject({
  bytes: z.instanceof(Uint8Array),
  options: z.strictObject({
    positionKind: z.enum(['management', 'non_management', 'unknown']),
    allowSyntheticDemo: z.literal(true).optional(),
  }),
  budget: pdfIsolationBudgetSchema,
});
const region = z.strictObject({
  page: z.number().int().positive(),
  box: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  textRange: z
    .strictObject({
      start: z.number().int().nonnegative(),
      end: z.number().int().positive(),
    })
    .refine((range) => range.end > range.start),
});
const field = z
  .strictObject({ value: z.string(), sources: z.array(region) })
  .nullable();
const selection = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('recognized'),
    value: z.string(),
    source: region,
  }),
  z.strictObject({
    status: z.literal('unrecognized'),
    reason: z.enum([
      'missing_selection',
      'multiple_selections',
      'options_mismatch',
      'unsupported_graphics',
      'applicability_unknown',
    ]),
    source: region,
  }),
  z.strictObject({
    status: z.literal('not_applicable'),
    reason: z.literal('non_management_position'),
  }),
]);
const review = z.strictObject({
  template: z.string(),
  templateFingerprint: z.literal('bow-896-synthetic-v1'),
  demo: z.literal(true),
  templateSource: region,
  identity: z.strictObject({ candidateName: field, positionNumber: z.null() }),
  metadata: z.strictObject({
    interviewTime: field,
    interviewType: field,
    interviewer: field,
    interviewResult: field,
    overallComment: field,
  }),
  dimensions: z.array(z.strictObject({ name: z.string(), selection })),
  interviewRating: selection,
  suggestedLevel: selection,
});
const resultSchema = z.union([
  z.strictObject({
    status: z.enum(['parsed', 'needs_manual_input']),
    reviews: z.array(review),
    pageTexts: z.array(
      z.strictObject({
        page: z.number().int().positive(),
        text: z.string(),
        extractionVersion: z.literal('interview-review-lines-v1'),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    ),
  }),
  z.strictObject({
    status: z.literal('rejected'),
    reason: z.enum([
      'unknown_template',
      'fingerprint_mismatch',
      'no_detail_review',
      'unverified_template_profile',
    ]),
    message: z.string(),
    source: region.optional(),
  }),
]) satisfies z.ZodType<InterviewReviewResult>;
const failureReasonSchema = z.enum([
  'invalid_request',
  'resource_limit',
  'timeout',
  'cancelled',
  'invalid_pdf',
  'worker_failed',
  'invalid_result',
  'termination_failed',
]);
export type PdfIsolationFailureReason = z.infer<typeof failureReasonSchema>;
export type IsolatedPdfOutcome =
  | { status: 'parsed'; result: InterviewReviewResult }
  | { status: 'failed'; reason: PdfIsolationFailureReason };
const replySchema = z.discriminatedUnion('status', [
  z.strictObject({
    protocol: z.literal(1),
    status: z.literal('result'),
    payload: z.instanceof(ArrayBuffer),
  }),
  z.strictObject({
    protocol: z.literal(1),
    status: z.literal('failed'),
    reason: failureReasonSchema,
  }),
]);
export type PdfWorkerReply = z.infer<typeof replySchema>;
export function pdfWorkerFailure(
  reason: PdfIsolationFailureReason,
): PdfWorkerReply {
  return { protocol: 1, status: 'failed', reason };
}
export function encodePdfWorkerResult(
  result: InterviewReviewResult,
  maxBytes: number,
): PdfWorkerReply {
  const checked = resultSchema.safeParse(result);
  if (!checked.success) return pdfWorkerFailure('invalid_result');
  const text = JSON.stringify(checked.data);
  // Check before allocating/transferring the UTF-8 payload into the parent.
  if (Buffer.byteLength(text, 'utf8') > maxBytes)
    return pdfWorkerFailure('resource_limit');
  return {
    protocol: 1,
    status: 'result',
    payload: new TextEncoder().encode(text).buffer,
  };
}
export function decodePdfWorkerReply(
  message: unknown,
  maxBytes: number,
): IsolatedPdfOutcome {
  const checked = replySchema.safeParse(message);
  if (!checked.success) return { status: 'failed', reason: 'invalid_result' };
  if (checked.data.status === 'failed')
    return { status: 'failed', reason: checked.data.reason };
  if (checked.data.payload.byteLength > maxBytes)
    return { status: 'failed', reason: 'resource_limit' };
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(
      checked.data.payload,
    );
    const result = resultSchema.safeParse(JSON.parse(text));
    return result.success
      ? { status: 'parsed', result: result.data }
      : { status: 'failed', reason: 'invalid_result' };
  } catch {
    return { status: 'failed', reason: 'invalid_result' };
  }
}
