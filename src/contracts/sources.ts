import { z } from 'zod';

export const sourceCategorySchema = z.enum(['original', 'prototype_baseline']);

// Shared with records storage. A quote alone is never a resolvable citation.
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
// Baseline provenance is an explicit demo-only response, not an original HR file.
const originalSourceSchema = sourceReferenceSchema
  .extend({
    excerpt: z.string().min(1).regex(/\S/, '不能为空白'),
    sourceType: z.enum(['document', 'spreadsheet', 'recording']),
    sourceCategory: z.literal('original'),
    demo: z.boolean(),
  })
  .refine((x) => x.sourceType === x.location.kind, '来源类型须与位置一致');
const baselineSourceSchema = sourceReferenceSchema
  .extend({
    excerpt: z.string().min(1).regex(/\S/, '不能为空白'),
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

/**
 * BOW-897 acquisition contract. The P0 source* schemas above remain the current
 * reader boundary; new ingestion/arrangement consumers use materialSource*.
 * BOW-873/906/908 migrate persistence, authorization and readers explicitly.
 * A valid locator is not proof of access or of a quote's authenticity.
 */
const materialText = z.string().min(1).regex(/\S/, '不能为空白');
const positiveIndex = z.number().int().positive();
// Offsets are zero-based, half-open UTF-16 offsets within this extracted page.
const textRangeSchema = z
  .strictObject({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .refine((range) => range.end > range.start, '文字范围不能为空或倒置');
/** Normalized coordinates in the stored original image, before cropping. */
export const materialImageRegionSchema = z
  .strictObject({
    left: z.number().min(0).max(1),
    top: z.number().min(0).max(1),
    right: z.number().min(0).max(1),
    bottom: z.number().min(0).max(1),
  })
  .refine(
    (region) => region.right > region.left && region.bottom > region.top,
    '图片区域须有面积且位于原图内',
  );
export const materialSourceLocationSchema = z.discriminatedUnion('kind', [
  // Preserve document paragraphs, worksheet cells and audio time points.
  sourceLocationSchema.options[1],
  sourceLocationSchema.options[2],
  sourceLocationSchema.options[3],
  z.strictObject({
    kind: z.literal('pdf'),
    page: positiveIndex,
    textRange: textRangeSchema,
  }),
  z.strictObject({ kind: z.literal('presentation'), slide: positiveIndex }),
  z
    .strictObject({
      kind: z.literal('video'),
      startMs: z.number().int().nonnegative(),
      endMs: z.number().int().positive(),
    })
    .refine((range) => range.endMs > range.startMs),
  z.strictObject({
    kind: z.literal('image'),
    region: materialImageRegionSchema,
  }),
  z
    .strictObject({
      kind: z.literal('code'),
      // Submitted locator metadata; this does not claim a server repository read.
      repository: materialText,
      commit: z.string().regex(/^[a-f0-9]{40}$/),
      path: materialText.refine(
        (path) =>
          !path.startsWith('/') &&
          !/[\\\0]/.test(path) &&
          path
            .split('/')
            .every((part) => part !== '' && part !== '.' && part !== '..'),
        '代码路径须为仓库内相对路径',
      ),
      startLine: positiveIndex,
      endLine: positiveIndex,
    })
    .refine((range) => range.endLine >= range.startLine),
]);
export const materialSourceReferenceSchema = sourceReadInputSchema.extend({
  location: materialSourceLocationSchema,
});
const materialSourceBase = materialSourceReferenceSchema.extend({
  excerpt: materialText,
  demo: z.boolean(),
});
/** Historical interview scales are provenance, never dimension-score inputs. */
export const materialSourceSchema = z.discriminatedUnion('sourceCategory', [
  materialSourceBase
    .extend({ sourceCategory: z.literal('original') })
    .refine((source) => source.location.kind !== 'code'),
  materialSourceBase
    .extend({
      sourceCategory: z.literal('historical_evaluation'),
      evaluationKind: z.literal('interview'),
    })
    .refine((source) => source.location.kind === 'pdf'),
  materialSourceBase
    .extend({
      sourceCategory: z.literal('submitted_code_snapshot'),
      displayNotice: z.literal('提交的代码快照'),
    })
    .refine((source) => source.location.kind === 'code'),
]);
export const materialSourceReadResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('success'),
    source: materialSourceSchema,
  }),
  sourceReadResultSchema.options[1],
  sourceReadResultSchema.options[2],
]);
export type MaterialImageRegion = z.infer<typeof materialImageRegionSchema>;
export type MaterialSourceLocation = z.infer<
  typeof materialSourceLocationSchema
>;
export type MaterialSourceReference = z.infer<
  typeof materialSourceReferenceSchema
>;
export type MaterialSource = z.infer<typeof materialSourceSchema>;
export type MaterialSourceReadResult = z.infer<
  typeof materialSourceReadResultSchema
>;
