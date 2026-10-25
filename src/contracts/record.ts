import { z } from 'zod';
import { createJobSnapshotSchema } from './jobs';
import { sourceReferenceSchema } from './sources';

const text = z.string().trim().min(1);
// Original wording and quotes retain their exact bytes for provenance/offsets.
const verbatimText = z.string().refine((value) => value.trim().length > 0, {
  message: '不能为空白',
});
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
      quote: verbatimText,
      start: z.number().int().nonnegative(),
      end: z.number().int().positive(),
    })
    .refine((x) => x.end > x.start),
  z.strictObject({
    kind: z.literal('source'),
    quote: verbatimText,
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
  text: verbatimText,
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
export const recordUndoReceiptSchema = z.strictObject({
  saveId: text,
  // Only events created by this batch; a second rater may create none.
  withdrawnEvents: eventMappingsSchema,
  withdrawnConfirmationIds: z.array(text),
  withdrawnReviewItemIds: z.array(text),
  originalInput: recordInputSchema,
});

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
