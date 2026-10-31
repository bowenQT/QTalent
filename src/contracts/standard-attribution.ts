import { z } from 'zod';
import {
  comparisonActorSchema,
  standardAttributionCategorySchema,
  comparisonCaseSchema,
  comparisonMappingSchema,
  comparisonTableRowSchema,
  createComparisonCaseSchema,
  type ComparisonCase,
} from './judgment-comparison';

const text = z.string().trim().min(1);
const revision = z.number().int().positive();
export const standardAttributionCategoriesSchema = z
  .array(standardAttributionCategorySchema)
  .min(1)
  .refine(
    (values) => new Set(values).size === values.length,
    '归因类别不能重复',
  );
export const comparisonCaseCitationSchema = z.strictObject({
  caseId: text,
  side: z.enum(['front', 'back']),
  nodeId: text,
  standardVersionId: text,
  row: comparisonTableRowSchema,
});
export const standardModelTraceSchema = z.strictObject({
  service: text,
  model: text,
  promptVersion: text,
});
export const standardAttributionHypothesisSchema = z.strictObject({
  id: text,
  batchId: text,
  origin: z.literal('ai_hypothesis'),
  text,
  categories: standardAttributionCategoriesSchema,
  citations: z.array(comparisonCaseCitationSchema).min(1),
  model: standardModelTraceSchema,
  generatedAt: z.iso.datetime(),
});
// Resolve model citations only against the authorized input snapshot, before
// saving an AI hypothesis. A syntactically valid source ID is not evidence.
export function createGroundedStandardHypothesisSchema(
  cases: readonly ComparisonCase[],
) {
  return standardAttributionHypothesisSchema.superRefine((hypothesis, ctx) => {
    for (const citation of hypothesis.citations) {
      const unit = cases.find(
        (item) =>
          item.id === citation.caseId && item.batchId === hypothesis.batchId,
      );
      const stage = unit?.[citation.side];
      if (
        !stage ||
        stage.state !== 'present' ||
        citation.nodeId !== stage.judgment.nodeId ||
        citation.standardVersionId !== stage.judgment.standardVersionId ||
        JSON.stringify(comparisonTableRowSchema.parse(citation.row)) !==
          JSON.stringify(comparisonTableRowSchema.parse(stage.judgment.row))
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['citations'],
          message: 'AI 引用须匹配当前授权案例中这一段的真实原表行与原文',
        });
      }
    }
  });
}

export const confirmedStandardAttributionSchema = z.strictObject({
  id: text,
  revision,
  batchId: text,
  origin: z.literal('human_conclusion'),
  hypothesisId: text.nullable(),
  categories: standardAttributionCategoriesSchema,
  rationale: text,
  citations: z.array(comparisonCaseCitationSchema).min(1),
  confirmedBy: comparisonActorSchema,
  confirmedAt: z.iso.datetime(),
});
export const revisionEligibleAttributionSchema =
  confirmedStandardAttributionSchema.refine(
    (attribution) => attribution.categories.includes('evaluation_standard'),
    '只有已由 HR 署名且含「评价标准」的归因可以起草修订',
  );
export type ConfirmedStandardAttribution = z.infer<
  typeof confirmedStandardAttributionSchema
>;

// Construct this from the caller's already authorized, human-confirmed cases.
// Parse BEFORE invoking the model; the model receives no rater-wide directory,
// inaccessible case, profile score, quadrant or unconfirmed hypothesis.
export const standardAttributionModelInputSchema = z
  .strictObject({
    batchId: text,
    promptVersion: text,
    mapping: comparisonMappingSchema,
    cases: z.array(comparisonCaseSchema).min(1),
  })
  .superRefine((input, ctx) => {
    const validator = createComparisonCaseSchema(input.mapping);
    if (
      new Set(input.cases.map((unit) => unit.id)).size !== input.cases.length ||
      input.cases.some(
        (unit) =>
          unit.batchId !== input.batchId || !validator.safeParse(unit).success,
      )
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['cases'],
        message: '模型输入须为本批次、同对应表的已确认案例',
      });
    }
  });
export function createAuthorizedAttributionModelInputSchema(
  authorizedCaseIds: readonly string[],
) {
  return standardAttributionModelInputSchema.refine(
    (input) => input.cases.every((unit) => authorizedCaseIds.includes(unit.id)),
    '模型输入不得包含当前权限之外的案例',
  );
}

const caseIds = z
  .array(text)
  .min(1)
  .refine((ids) => new Set(ids).size === ids.length);
// Actor, signature and current permissions always come from the server.
export const confirmStandardAttributionInputSchema = z.strictObject({
  operationId: text,
  batchId: text,
  hypothesisId: text.nullable(),
  categories: standardAttributionCategoriesSchema,
  rationale: text,
  caseIds,
});
export const generateStandardHypothesesInputSchema = z.strictObject({
  operationId: text,
  batchId: text,
});
export function standardIterationActionResultSchema<
  I extends z.ZodType,
  R extends z.ZodType,
>(input: I, result: R) {
  return z.discriminatedUnion('status', [
    z.strictObject({
      status: z.literal('success'),
      replayed: z.boolean(),
      result,
    }),
    z.strictObject({
      status: z.literal('validation_error'),
      fieldErrors: z.record(z.string(), z.array(z.string())),
      input: z.unknown(),
    }),
    z.strictObject({ status: z.literal('conflict'), message: text, input }),
    z.strictObject({
      status: z.enum(['forbidden', 'not_found', 'model_failed']),
      message: text,
    }),
  ]);
}
export const confirmStandardAttributionResultSchema =
  standardIterationActionResultSchema(
    confirmStandardAttributionInputSchema,
    confirmedStandardAttributionSchema,
  );
export const generateStandardHypothesesResultSchema =
  standardIterationActionResultSchema(
    generateStandardHypothesesInputSchema,
    z.array(standardAttributionHypothesisSchema).min(1),
  );
export type StandardAttributionHypothesis = z.infer<
  typeof standardAttributionHypothesisSchema
>;
export type ConfirmStandardAttributionInput = z.infer<
  typeof confirmStandardAttributionInputSchema
>;
export type ConfirmStandardAttributionResult = z.infer<
  typeof confirmStandardAttributionResultSchema
>;
export type StandardAttributionModelInput = z.infer<
  typeof standardAttributionModelInputSchema
>;
