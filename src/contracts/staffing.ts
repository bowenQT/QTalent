import { z } from 'zod';
import { createJobSnapshotSchema } from './jobs';
import { sourceReferenceSchema, sourceSchema } from './sources';

const text = z.string().trim().min(1);
const revision = z.number().int().positive();
const actorSchema = z.strictObject({ id: text, name: text });

export const staffingConclusionSchema = z.enum([
  'supported',
  'not_supported',
  'insufficient',
  'conflict',
]);

export const staffingRequirementSchema = z.strictObject({
  id: text,
  text,
  priority: z.enum(['required', 'bonus']),
});
const requirementsSchema = z
  .array(staffingRequirementSchema)
  .min(1)
  .refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
    '要求标识不能重复',
  );
const demandFields = {
  id: text,
  projectId: text,
  revision,
  inputText: text,
  requirements: requirementsSchema,
};
export const staffingDemandSchema = z.discriminatedUnion('status', [
  z.strictObject({ ...demandFields, status: z.literal('draft') }),
  z.strictObject({
    ...demandFields,
    status: z.literal('confirmed'),
    confirmedBy: actorSchema,
    confirmedAt: z.iso.datetime(),
  }),
]);
export type StaffingDemand = z.infer<typeof staffingDemandSchema>;

const judgmentFields = {
  conclusion: staffingConclusionSchema,
  rationale: text,
  sources: z.array(sourceSchema),
};
function hasRequiredEvidence(value: {
  conclusion: z.infer<typeof staffingConclusionSchema>;
  sources: unknown[];
}) {
  return value.conclusion === 'insufficient' || value.sources.length > 0;
}
const aiJudgmentSchema = z
  .strictObject(judgmentFields)
  .refine(hasRequiredEvidence, '明确结论须有来源');
const humanJudgmentSchema = z
  .strictObject({
    ...judgmentFields,
    judgedBy: actorSchema,
    judgedAt: z.iso.datetime(),
  })
  .refine(hasRequiredEvidence, '明确结论须有来源');

export const staffingMatchSchema = z
  .strictObject({
    requirementId: text,
    progress: z.enum([
      'queued',
      'judging',
      'awaiting_manual',
      'failed',
      'completed',
    ]),
    aiJudgment: aiJudgmentSchema.nullable(),
    humanJudgment: humanJudgmentSchema.nullable(),
  })
  .refine(
    (value) =>
      value.progress === 'completed'
        ? value.aiJudgment !== null || value.humanJudgment !== null
        : value.aiJudgment === null && value.humanJudgment === null,
    '未完成时结论留空；完成时必须有判断',
  );
export const staffingCandidateSchema = z.strictObject({
  person: z.strictObject({ id: text, name: text, orgName: text }),
  demandRevision: revision,
  requirements: z.array(staffingMatchSchema),
});
export type StaffingCandidate = z.infer<typeof staffingCandidateSchema>;

export const staffingPageSchema = z
  .strictObject({
    demand: staffingDemandSchema,
    candidates: z.array(staffingCandidateSchema),
    plan: z.strictObject({ status: z.literal('not_connected') }),
  })
  .refine((page) => {
    const ids = new Set(page.demand.requirements.map((item) => item.id));
    const people = new Set(page.candidates.map((item) => item.person.id));
    if (people.size !== page.candidates.length) return false;
    return page.candidates.every((candidate) => {
      const matched = candidate.requirements.map((item) => item.requirementId);
      return (
        candidate.demandRevision === page.demand.revision &&
        matched.length === ids.size &&
        new Set(matched).size === ids.size &&
        matched.every((id) => ids.has(id))
      );
    });
  });
export type StaffingPage = z.infer<typeof staffingPageSchema>;

/** Counts concern this demand only, never a talent score or company ranking. */
export function orderStaffingCandidates(
  demand: StaffingDemand,
  candidates: StaffingCandidate[],
): StaffingCandidate[] {
  const required = new Set(
    demand.requirements
      .filter((item) => item.priority === 'required')
      .map((item) => item.id),
  );
  const supported = (candidate: StaffingCandidate) =>
    candidate.requirements.filter(
      (item) =>
        required.has(item.requirementId) &&
        (item.humanJudgment ?? item.aiJudgment)?.conclusion === 'supported',
    ).length;
  return [...candidates].sort((a, b) => supported(b) - supported(a));
}

const operationFields = { operationId: text };
const revisionFields = {
  ...operationFields,
  demandId: text,
  expectedRevision: revision,
};
export const createStaffingDemandInputSchema = z.strictObject({
  ...operationFields,
  projectId: text,
  inputText: text,
});
export const editStaffingDemandInputSchema = z.strictObject({
  ...revisionFields,
  requirements: requirementsSchema,
});
export const confirmStaffingDemandInputSchema = z.strictObject(revisionFields);
export const humanStaffingJudgmentInputSchema = z
  .strictObject({
    ...revisionFields,
    personId: text,
    requirementId: text,
    conclusion: staffingConclusionSchema,
    rationale: text,
    sources: z.array(sourceReferenceSchema),
  })
  .refine(hasRequiredEvidence, '明确结论须有来源');
export type HumanStaffingJudgmentInput = z.infer<
  typeof humanStaffingJudgmentInputSchema
>;

const demandInputSchema = z.union([
  createStaffingDemandInputSchema,
  editStaffingDemandInputSchema,
  confirmStaffingDemandInputSchema,
]);
function errorSchemas<S extends z.ZodType>(input: S) {
  return [
    z.strictObject({
      status: z.literal('validation_error'),
      fieldErrors: z.record(z.string(), z.array(z.string())),
      input: z.unknown(),
    }),
    z.strictObject({
      status: z.enum(['forbidden', 'not_found', 'conflict']),
      message: text,
      input,
    }),
  ] as const;
}
export const staffingDemandResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('success'),
    demand: staffingDemandSchema,
    replayed: z.boolean(),
  }),
  ...errorSchemas(demandInputSchema),
]);
export const staffingJudgmentResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('success'),
    demandId: text,
    personId: text,
    revision,
    match: staffingMatchSchema.refine(
      (match) =>
        match.progress === 'completed' && match.humanJudgment !== null,
      '人工判断成功必须返回署名结论',
    ),
    replayed: z.boolean(),
  }),
  ...errorSchemas(humanStaffingJudgmentInputSchema),
]);

export const staffingJobSnapshotSchema = createJobSnapshotSchema(
  'staffing_match',
  staffingPageSchema,
);
export type StaffingJobSnapshot = z.infer<typeof staffingJobSnapshotSchema>;
