import { z } from 'zod';

const id = z.string().min(1);
const text = z.string().refine((v) => /\S/u.test(v), 'Nonblank text required');
const nullableId = id.nullable().default(null);
const category = z.enum(['original', 'prototype_baseline']).default('original');
const status = z.enum(['scored', 'unknown', 'not_demonstrated']);
const value = z.number().int().min(1).max(5).nullable();
const reference = { fragmentId: id, originalVersionId: id };
const location = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('document'),
    page: z.number().int().positive().optional(),
    paragraph: text,
  }),
  z.strictObject({ kind: z.literal('spreadsheet'), sheet: text, cell: text }),
  z
    .strictObject({
      kind: z.literal('recording'),
      startMs: z.number().int().nonnegative(),
      endMs: z.number().int().positive(),
    })
    .refine((v) => v.endMs > v.startMs),
  z.strictObject({
    kind: z.literal('snapshot_field'),
    fieldPath: text,
    originalLocation: z.string().optional(),
  }),
]);
const scoreFields = {
  id,
  eventId: id,
  dimensionId: id,
  ruleVersionId: id,
  sourceCategory: category,
  status,
  value,
  anchorId: nullableId,
  ...reference,
};
const validScore = (v: {
  status: string;
  value: number | null;
  anchorId: string | null;
}) =>
  v.status === 'scored'
    ? v.value !== null && v.anchorId !== null
    : v.value === null && v.anchorId === null;
const dateTime = z
  .union([z.date(), z.iso.datetime().transform((v) => new Date(v))])
  .nullable()
  .default(null);

/** Server import rows, not a browser API. Unknown control fields must not be stripped. */
export const evidenceRecordsSchema = z.strictObject({
  originals: z
    .array(
      z.strictObject({
        id,
        title: text,
        kind: z.enum(['original', 'prototype_snapshot']).default('original'),
        displayNotice: z.string().nullable().default(null),
      }),
    )
    .default([]),
  originalVersions: z
    .array(
      z.strictObject({
        id,
        originalId: id,
        version: z.number().int().positive(),
        contentDigest: text,
        sourceCommit: z.string().nullable().default(null),
        sourceBlob: z.string().nullable().default(null),
        sourcePath: z.string().nullable().default(null),
      }),
    )
    .default([]),
  fragments: z
    .array(
      z.strictObject({ id, originalVersionId: id, location, excerpt: text }),
    )
    .default([]),
  events: z
    .array(
      z.strictObject({
        id,
        personId: id,
        recorderId: id,
        evaluationNodeId: id.regex(/\S/u).nullable().default(null),
        projectId: nullableId,
        occurredOn: z.iso.date(),
        title: text,
        situation: z.string(),
        behavior: z.string(),
        impact: z.string(),
        ruleVersionId: id,
        demo: z.boolean().default(false),
      }),
    )
    .default([]),
  eventParticipants: z
    .array(z.strictObject({ eventId: id, personId: id }))
    .default([]),
  eventSources: z
    .array(z.strictObject({ eventId: id, ...reference }))
    .default([]),
  statements: z
    .array(
      z.strictObject({
        id,
        eventId: id,
        kind: z.enum([
          'original_fact',
          'self_report',
          'management_observation',
          'ai_inference',
          'human_conclusion',
        ]),
        text,
        authorId: nullableId,
        modelVersion: z.string().nullable().default(null),
        uncertainty: z.string().nullable().default(null),
        ...reference,
      }),
    )
    .default([]),
  aiSuggestions: z
    .array(
      z
        .strictObject({ ...scoreFields, modelVersion: text, rationale: text })
        .refine(validScore),
    )
    .default([]),
  confirmations: z
    .array(
      z
        .strictObject({
          ...scoreFields,
          evaluatorId: nullableId,
          confirmedAt: dateTime,
          revision: z.number().int().positive().default(1),
          active: z.boolean().default(true),
          modifiedBy: nullableId,
          reason: z.string().nullable().default(null),
          previousId: nullableId,
          previousRevision: z
            .number()
            .int()
            .positive()
            .nullable()
            .default(null),
          suggestionId: nullableId,
        })
        .refine(validScore),
    )
    .default([]),
  scoreReviews: z
    .array(
      z.strictObject({
        id,
        eventId: id,
        dimensionId: id,
        reason: z.enum([
          'score_gap',
          'ai_changed_without_reason',
          'post_freeze_position_change',
        ]),
        status: z.enum(['open', 'resolved']).default('open'),
      }),
    )
    .default([]),
  historicalEvaluations: z
    .array(
      z.strictObject({
        id,
        sourceRecordId: id,
        evaluationNodeId: id.nullable().default(null),
        personId: nullableId,
        recorderId: id,
        occurredOn: z.iso.date(),
        kind: text,
        period: z.string().nullable().default(null),
        scale: z.array(z.tuple([z.string(), z.string()])),
        ruleVersionId: nullableId,
        ...reference,
        sourceCategory: category,
      }),
    )
    .default([]),
  historicalParticipants: z
    .array(z.strictObject({ evaluationId: id, personId: id }))
    .default([]),
});
export type EvidenceRecords = z.infer<typeof evidenceRecordsSchema>;

export function parseFormalEvidence(input: unknown): EvidenceRecords {
  const records = evidenceRecordsSchema.parse(input);
  const key = (...parts: string[]) => JSON.stringify(parts);
  const forbidden =
    records.originals.some(
      (r) => r.kind !== 'original' || r.displayNotice !== null,
    ) ||
    records.fragments.some((r) => r.location.kind === 'snapshot_field') ||
    records.events.some((r) => r.demo || !/\S/u.test(r.behavior)) ||
    [
      ...records.aiSuggestions,
      ...records.confirmations,
      ...records.historicalEvaluations,
    ].some((r) => r.sourceCategory !== 'original') ||
    records.confirmations.some(
      (r) => r.evaluatorId === null || r.modifiedBy === null,
    );
  if (forbidden)
    throw new Error(
      'Formal import rejects prototype_baseline and demo records',
    );
  // This is a complete evidence batch, not the later score-confirmation/update use case.
  const versions = new Set(records.originalVersions.map((r) => r.id));
  const originals = new Set(records.originals.map((r) => r.id));
  const fragments = new Set(
    records.fragments.map((r) => key(r.id, r.originalVersionId)),
  );
  const events = new Set(records.events.map((r) => r.id));
  const evaluations = new Set(records.historicalEvaluations.map((r) => r.id));
  const linked = new Set(
    records.eventSources.map((r) =>
      key(r.eventId, r.fragmentId, r.originalVersionId),
    ),
  );
  if (
    records.originalVersions.some((r) => !originals.has(r.originalId)) ||
    records.fragments.some((r) => !versions.has(r.originalVersionId)) ||
    records.eventParticipants.some((r) => !events.has(r.eventId)) ||
    records.eventSources.some(
      (r) =>
        !events.has(r.eventId) ||
        !fragments.has(key(r.fragmentId, r.originalVersionId)),
    ) ||
    [
      ...records.statements,
      ...records.aiSuggestions,
      ...records.confirmations,
    ].some(
      (r) => !linked.has(key(r.eventId, r.fragmentId, r.originalVersionId)),
    ) ||
    records.scoreReviews.some((r) => !events.has(r.eventId)) ||
    records.historicalEvaluations.some(
      (r) => !fragments.has(key(r.fragmentId, r.originalVersionId)),
    ) ||
    records.historicalParticipants.some((r) => !evaluations.has(r.evaluationId))
  )
    throw new Error(
      'Formal import requires a complete original evidence chain',
    );
  return records;
}
