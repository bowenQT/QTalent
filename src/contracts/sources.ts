import { z } from 'zod';

export const sourceCategorySchema = z.enum(['original', 'prototype_baseline']);

// Shared with records storage. A quote alone is never a resolvable citation.
// Four location kinds exist: document, spreadsheet, recording and snapshot_field.
// The authorization layer's TalentSourceLocation must map all four; a baseline
// (snapshot_field) source that it cannot rebuild would fail every demo read.
export const sourceLocationSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('snapshot_field'),
    fieldPath: z.string().min(1).regex(/\S/, '不能为空白'),
    originalLocation: z.string().min(1).regex(/\S/, '不能为空白').optional(),
  }),
  z.strictObject({
    kind: z.literal('document'),
    page: z.number().int().positive().optional(),
    paragraph: z.string().min(1).regex(/\S/, '不能为空白'),
  }),
  z.strictObject({
    kind: z.literal('spreadsheet'),
    sheet: z.string().min(1).regex(/\S/, '不能为空白'),
    cell: z.string().min(1).regex(/\S/, '不能为空白'),
  }),
  z
    .strictObject({
      kind: z.literal('recording'),
      startMs: z.number().int().nonnegative(),
      endMs: z.number().int().positive(),
    })
    .refine((x) => x.endMs > x.startMs, '片段结束时间须晚于开始时间'),
]);
export const sourceReadInputSchema = z.strictObject({
  fragmentId: z.string().min(1).regex(/\S/, '不能为空白'),
  originalVersionId: z.string().min(1).regex(/\S/, '不能为空白'),
});
export const sourceReferenceSchema = sourceReadInputSchema.extend({
  location: sourceLocationSchema,
});
// The only place a citation becomes a read request: just the two identifiers.
// The server resolves the position from them and never trusts the client.
export function toSourceReadInput(reference: SourceReference): SourceReadInput {
  return {
    fragmentId: reference.fragmentId,
    originalVersionId: reference.originalVersionId,
  };
}
// What the popover shows besides the excerpt. `recordedByName` is null when the
// recorder is unknown: a fragment has no recorder of its own and the event's
// recorder must not stand in for it.
const sourceDetail = {
  excerpt: z.string().min(1).regex(/\S/, '不能为空白'),
  originalTitle: z.string().min(1).regex(/\S/, '不能为空白'),
  recordedByName: z.string().min(1).regex(/\S/, '不能为空白').nullable(),
};
// Baseline provenance is an explicit demo-only response, not an original HR file.
const originalSourceSchema = sourceReferenceSchema
  .extend({
    ...sourceDetail,
    sourceType: z.enum(['document', 'spreadsheet', 'recording']),
    sourceCategory: z.literal('original'),
    demo: z.boolean(),
  })
  .refine((x) => x.sourceType === x.location.kind, '来源类型须与位置一致');
const baselineSourceSchema = sourceReferenceSchema
  .extend({
    ...sourceDetail,
    sourceType: z.literal('prototype_snapshot'),
    sourceCategory: z.literal('prototype_baseline'),
    displayNotice: z.string().min(1).regex(/\S/, '不能为空白'),
    demo: z.literal(true),
  })
  .refine(
    (x) => x.location.kind === 'snapshot_field',
    '快照来源须定位到快照字段',
  );
export const sourceSchema = z.discriminatedUnion('sourceCategory', [
  originalSourceSchema,
  baselineSourceSchema,
]);
// Playback is deliberately absent until BOW-873 supplies short-lived authorized URLs.
export const sourceReadResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('success'), source: sourceSchema }),
  z.strictObject({
    status: z.literal('validation_error'),
    fieldErrors: z.record(z.string(), z.array(z.string())),
    input: z.unknown(),
  }),
  z.strictObject({
    status: z.enum(['forbidden', 'not_found', 'conflict']),
    message: z.string().min(1).regex(/\S/, '不能为空白'),
  }),
]);
export type SourceLocation = z.infer<typeof sourceLocationSchema>;
export type SourceReference = z.infer<typeof sourceReferenceSchema>;
export type SourceReadInput = z.infer<typeof sourceReadInputSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type SourceReadResult = z.infer<typeof sourceReadResultSchema>;
