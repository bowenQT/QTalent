import { z } from 'zod';

// Shared with records storage. A quote alone is never a resolvable citation.
export const sourceLocationSchema = z.discriminatedUnion('kind', [
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
export const sourceSchema = sourceReferenceSchema
  .extend({
    excerpt: z.string().min(1).regex(/\S/, '不能为空白'),
    sourceType: z.enum(['document', 'spreadsheet', 'recording']),
    demo: z.boolean(),
  })
  .refine((x) => x.sourceType === x.location.kind, '来源类型须与位置一致');
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
