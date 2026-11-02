import { z } from 'zod';
import { createJobSnapshotSchema } from './jobs';
import {
  materialSourceReferenceSchema,
  sourceReferenceSchema,
} from './sources';

const text = z.string().trim().min(1);
const revision = z.number().int().positive();
export const recordValueSchema = z.number().int().min(1).max(5);
export const recordAnchorSchema = z.strictObject({
  id: text,
  text,
  ruleVersion: text,
});
export const recordCitationSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('input'),
      quote: text,
      start: z.number().int().nonnegative(),
      end: z.number().int().positive(),
    })
    .refine((x) => x.end > x.start),
  z.strictObject({
    kind: z.literal('source'),
    quote: text,
    reference: sourceReferenceSchema,
  }),
]);
export const recordEvidenceScoreSchema = z.strictObject({
  value: recordValueSchema,
  anchor: recordAnchorSchema,
  citations: z.array(recordCitationSchema).min(1),
});
export const recordScoreSchema = z.discriminatedUnion('state', [
  recordEvidenceScoreSchema.extend({
    personId: text,
    dimensionId: text,
    state: z.literal('suggested'),
  }),
  z.strictObject({
    personId: text,
    dimensionId: text,
    state: z.literal('unknown'),
    reason: text,
  }),
]);
const selectionSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('resolved'), id: text }),
  z.strictObject({
    state: z.literal('needs_selection'),
    candidates: z.array(z.strictObject({ id: text, label: text })),
    reason: text,
  }),
  z.strictObject({ state: z.literal('none') }),
]);
export const recordSbiSchema = z.strictObject({
  title: text,
  situation: z.string(),
  behavior: text,
  impact: z.string(),
});
export const recordInputSchema = z.strictObject({
  operation_id: text,
  text,
  attachmentIds: z.array(text),
  personId: text.nullable(),
  projectId: text.nullable(),
});
export const recordDraftSchema = z.strictObject({
  draftId: text,
  revision,
  origin: z.enum(['text', 'recording', 'attachment']),
  originalInput: recordInputSchema,
  sbi: recordSbiSchema,
  people: z.array(selectionSchema),
  project: selectionSchema,
  scores: z.array(recordScoreSchema),
});
// Before identity is selected, no model-derived SBI or scores exist.
export const recordSelectionRequiredSchema = z.strictObject({
  state: z.literal('selection_required'),
  draftId: text,
  inputVersion: text,
  originalInput: recordInputSchema,
  people: z.array(selectionSchema),
  project: selectionSchema,
});
export const recordArrangeResultSchema = z.union([
  recordDraftSchema,
  recordSelectionRequiredSchema,
]);
export const recordJobSchema = createJobSnapshotSchema(
  'record_organize',
  recordArrangeResultSchema,
);
// This starts arrangement for a newly selected input, not a generic job resume.
// The server rechecks current candidate visibility and the input version.
export const recordSelectionInputSchema = z.strictObject({
  operation_id: text,
  draftId: text,
  expected_input_version: text,
  personIds: z
    .array(text)
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length),
  projectId: text.nullable(),
});
export const recordOpenDraftInputSchema = z.strictObject({ draftId: text });
const decisionBase = z.strictObject({
  personId: text,
  dimensionId: text,
});
export const recordDecisionSchema = z.discriminatedUnion('action', [
  decisionBase.extend({ action: z.literal('confirm') }),
  decisionBase.extend({
    action: z.literal('edit'),
    value: recordValueSchema,
    reason: z.string(),
  }),
  decisionBase.extend({
    action: z.literal('unknown'),
    reason: text,
  }),
]);
export const recordSaveInputSchema = z
  .strictObject({
    operation_id: text,
    expected_revision: revision,
    draftId: text,
    personIds: z.array(text).min(1),
    projectId: text.nullable(),
    sbi: recordSbiSchema,
    decisions: z.array(recordDecisionSchema),
  })
  .refine((x) => new Set(x.personIds).size === x.personIds.length)
  .refine((x) => x.decisions.every((d) => x.personIds.includes(d.personId)))
  .refine((x) => {
    const keys = x.decisions.map((d) => [d.personId, d.dimensionId]);
    return new Set(keys.map((key) => JSON.stringify(key))).size === keys.length;
  });

// Identity, current permissions, quote authenticity and the business uniqueness
// key (event, dimension, rater) remain server-side checks, including on replay.
export const RECORD_UNDO_WINDOW_MS = 5_000;
const eventMappingsSchema = z
  .array(z.strictObject({ personId: text, eventId: text }))
  .refine((events) => {
    const people = new Set(events.map((event) => event.personId));
    const ids = new Set(events.map((event) => event.eventId));
    return people.size === events.length && ids.size === events.length;
  });
// One saveId identifies the whole atomic batch, not a representative event.
// The server permits undo only at savedAt <= now < undoUntil.
export const recordSaveReceiptSchema = z
  .strictObject({
    saveId: text,
    events: eventMappingsSchema.min(1),
    revision,
    confirmationIds: z.array(text),
    reviewItemIds: z.array(text),
    savedBy: text,
    savedAt: z.iso.datetime(),
    undoUntil: z.iso.datetime(),
  })
  .refine(
    (x) =>
      Date.parse(x.undoUntil) - Date.parse(x.savedAt) === RECORD_UNDO_WINDOW_MS,
  );
export const recordUndoInputSchema = z.strictObject({
  operation_id: text,
  saveId: text,
});
const draftRestorationSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('available'),
    draftId: text,
    draftRevision: revision,
  }),
  z.strictObject({ status: z.literal('refresh_required') }),
]);
// A submitted undo version, not a promise that today's draft is still current.
// Historical absence is handled only when reading the internal operation ledger.
const recordUndoReceiptBase = {
  draftRestoration: draftRestorationSchema,
  saveId: text,
  // Only events created by this batch; a second rater may create none.
  withdrawnEvents: eventMappingsSchema,
  withdrawnConfirmationIds: z.array(text),
  withdrawnReviewItemIds: z.array(text),
};
// Undo eligibility never implies access to the entire original input. The server
// reprojects this pair under current complete-input authorization on every replay.
export const recordUndoReceiptSchema = z.discriminatedUnion(
  'inputRestoration',
  [
    z.strictObject({
      ...recordUndoReceiptBase,
      inputRestoration: z.literal('available'),
      originalInput: recordInputSchema,
    }),
    z.strictObject({
      ...recordUndoReceiptBase,
      inputRestoration: z.literal('unavailable'),
      originalInput: z.null(),
    }),
  ],
);

// Typed input is returned on conflicts so callers can retain edits.
export function recordActionResultSchema<
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
    z.strictObject({
      status: z.literal('conflict'),
      message: text,
      input,
    }),
    z.strictObject({
      status: z.enum(['forbidden', 'not_found']),
      message: text,
    }),
  ]);
}
export const recordSaveResultSchema = recordActionResultSchema(
  recordSaveInputSchema,
  recordSaveReceiptSchema,
);
export const recordUndoResultSchema = recordActionResultSchema(
  recordUndoInputSchema,
  recordUndoReceiptSchema,
);
export const recordStartResultSchema = recordActionResultSchema(
  recordInputSchema,
  recordJobSchema,
);
export const recordSelectionResultSchema = recordActionResultSchema(
  recordSelectionInputSchema,
  recordJobSchema,
);
export const recordOpenDraftResultSchema = recordActionResultSchema(
  recordOpenDraftInputSchema,
  recordDraftSchema,
);
export type RecordInput = z.infer<typeof recordInputSchema>;
export type RecordDraft = z.infer<typeof recordDraftSchema>;
export type RecordSaveInput = z.infer<typeof recordSaveInputSchema>;
export type RecordUndoInput = z.infer<typeof recordUndoInputSchema>;
export type RecordSaveResult = z.infer<typeof recordSaveResultSchema>;
export type RecordUndoResult = z.infer<typeof recordUndoResultSchema>;
export type RecordArrangeResult = z.infer<typeof recordArrangeResultSchema>;
export type RecordSelectionInput = z.infer<typeof recordSelectionInputSchema>;

const batchIds = z
  .array(text)
  .refine((ids) => new Set(ids).size === ids.length);
const batchCitationSchema = z.strictObject({
  kind: z.literal('source'),
  quote: text,
  reference: materialSourceReferenceSchema,
});
const batchScoreSchema = z.discriminatedUnion('state', [
  recordEvidenceScoreSchema.extend({
    personId: text,
    dimensionId: text,
    state: z.literal('suggested'),
    citations: z.array(batchCitationSchema).min(1),
  }),
  recordScoreSchema.options[1],
]);
/**
 * One draft is one event, not one person. Two events for one person keep two IDs.
 * Retry/reopen returns persisted IDs and revisions. Any semantic change,
 * including rebinding/regeneration, advances the revision without replacing IDs.
 * Sources are the authorized union of all materials supporting this event.
 * BOW-845 still verifies verbatim quotes and frozen dimension/anchor versions.
 */
export const recordBatchDraftSchema = z
  .strictObject({
    batchId: text,
    evaluationNodeId: text,
    draftId: text,
    revision,
    origin: z.literal('ai_suggestion'),
    personIds: batchIds.min(1),
    // Explicit per-event topic lookup; null is resolved no-topic, never a grant.
    projectId: text.nullable(),
    sourceReferences: z
      .array(materialSourceReferenceSchema)
      .min(1)
      .refine(
        (sources) =>
          new Set(
            sources.map((source) =>
              JSON.stringify([source.fragmentId, source.originalVersionId]),
            ),
          ).size === sources.length,
        '草稿来源集合不得重复',
      ),
    dimensionVersionId: text,
    anchorVersionId: text,
    sbi: recordSbiSchema,
    scores: z.array(batchScoreSchema),
  })
  .refine(
    (draft) =>
      draft.scores.every((score) => draft.personIds.includes(score.personId)),
    '建议仅属于草稿所涉及人员',
  )
  .refine(
    (draft) =>
      new Set(
        draft.scores.map((score) =>
          JSON.stringify([score.personId, score.dimensionId]),
        ),
      ).size === draft.scores.length,
    '同一人员维度只保留一个建议',
  )
  .refine(
    (draft) =>
      draft.scores.every(
        (score) =>
          score.state === 'unknown' ||
          score.anchor.ruleVersion === draft.anchorVersionId,
      ),
    '建议锚点须来自草稿冻结的锚点版本',
  )
  .refine(
    (draft) =>
      draft.scores.every(
        (score) =>
          score.state === 'unknown' ||
          score.citations.every((citation) =>
            draft.sourceReferences.some(
              (source) =>
                JSON.stringify(source) === JSON.stringify(citation.reference),
            ),
          ),
      ),
    '建议引用须在草稿来源集合内',
  );
const duplicateCandidateSchema = z.strictObject({
  candidateId: text,
  // Similarity is a review hint, never an automatic cross-batch merge.
  draftIds: batchIds.min(2),
  reason: text,
});
/**
 * Exact, verified same-event material may share a canonical draft and source
 * union inside this batch. Person identity alone is never a deduplication key.
 * Uncertain similarity keeps both drafts until a versioned human decision.
 * No global automatic merging, discarded sources, or silent event loss.
 */
export const recordBatchDraftSetSchema = z
  .strictObject({
    batchId: text,
    revision,
    drafts: z.array(recordBatchDraftSchema).min(1),
    duplicateCandidates: z.array(duplicateCandidateSchema),
  })
  .refine(
    (set) =>
      set.drafts.every((draft) => draft.batchId === set.batchId) &&
      new Set(set.drafts.map((draft) => draft.draftId)).size ===
        set.drafts.length,
  )
  .refine((set) => {
    const ids = new Set(set.drafts.map((draft) => draft.draftId));
    const candidates = set.duplicateCandidates;
    const members = candidates.flatMap((candidate) => candidate.draftIds);
    return (
      new Set(candidates.map((candidate) => candidate.candidateId)).size ===
        candidates.length &&
      new Set(members).size === members.length &&
      members.every((draftId) => ids.has(draftId))
    );
  });
const draftVersionSchema = z.strictObject({
  draftId: text,
  expectedRevision: revision,
});
export const recordBatchDuplicateDecisionInputSchema = z
  .strictObject({
    batchId: text,
    operationId: text,
    expectedRevision: revision,
    candidateId: text,
    drafts: z.array(draftVersionSchema).min(2),
    decision: z.discriminatedUnion('action', [
      z.strictObject({ action: z.literal('keep_separate') }),
      z.strictObject({ action: z.literal('merge'), canonicalDraftId: text }),
    ]),
  })
  .refine(
    (input) =>
      new Set(input.drafts.map((draft) => draft.draftId)).size ===
      input.drafts.length,
  )
  .refine((input) => {
    const decision = input.decision;
    return (
      decision.action !== 'merge' ||
      input.drafts.some((draft) => draft.draftId === decision.canonicalDraftId)
    );
  });
/**
 * Server transaction checks the candidate membership and every expected revision.
 * Merge preserves the chosen canonical ID, unions sources and invalidates old
 * suggestions for recheck. Pending duplicate candidates cannot be confirmed.
 * Same actor + operationId + semantic payload replays the original result after
 * CURRENT authorization; changed payload or stale revision returns conflict.
 */
export const recordBatchDuplicateDecisionResultSchema =
  recordActionResultSchema(
    recordBatchDuplicateDecisionInputSchema,
    recordBatchDraftSetSchema,
  );
export type RecordBatchDraft = z.infer<typeof recordBatchDraftSchema>;
export type RecordBatchDraftSet = z.infer<typeof recordBatchDraftSetSchema>;
export type RecordBatchDuplicateDecisionInput = z.infer<
  typeof recordBatchDuplicateDecisionInputSchema
>;
export type RecordBatchDuplicateDecisionResult = z.infer<
  typeof recordBatchDuplicateDecisionResultSchema
>;
