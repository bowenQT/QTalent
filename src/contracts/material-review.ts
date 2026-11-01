import { z } from 'zod';
import {
  materialImageRegionSchema,
  materialSourceReferenceSchema,
} from './sources';
import { recordActionResultSchema } from './record';
const id = z.string().min(1).max(200).regex(/\S/);
const text = z.string().min(1).regex(/\S/);
const revision = z.number().int().positive();
const ids = z
  .array(id)
  .refine((values) => new Set(values).size === values.length);
const candidates = z
  .array(z.strictObject({ personId: id, displayName: text }))
  .refine(
    (values) =>
      new Set(values.map((value) => value.personId)).size === values.length,
  );
const projects = z
  .array(z.strictObject({ projectId: id, displayName: text }))
  .refine(
    (values) =>
      new Set(values.map((value) => value.projectId)).size === values.length,
  );
/** Server policy descriptions, not client grants. Candidate IDs are current,
 * authorized existing directory/project lookups. Resolve scope before model use;
 * an expired relation goes through BOW-899 reassignment, never wider disclosure.
 */
export const MATERIAL_REVIEW_POLICIES = {
  speaker: {
    resolver: 'current_node_evaluator_or_scoped_manager_or_hr',
    resumeAt: 'organizing',
    owner: 'BOW-860',
  },
  unknown_person: {
    resolver: 'current_node_evaluator_or_scoped_manager_or_hr',
    resumeAt: 'organizing',
    owner: 'BOW-905',
  },
  image_scope: {
    resolver: 'current_node_evaluator_or_scoped_manager_or_hr',
    resumeAt: 'image_scope_check',
    owner: 'BOW-905',
  },
  unknown_interviewer: {
    resolver: 'scoped_hr',
    resumeAt: 'interview_import',
    owner: 'BOW-906',
  },
  unknown_project: {
    resolver: 'current_node_evaluator_or_scoped_manager_or_hr',
    resumeAt: 'organizing',
    owner: 'BOW-845',
  },
  unknown_interview_candidate: {
    resolver: 'scoped_hr',
    resumeAt: 'interview_import',
    owner: 'BOW-906',
  },
} as const;
const item = {
  itemId: id,
  batchId: id,
  evaluationNodeId: id,
  materialId: id,
  originalVersionId: id,
  revision,
  state: z.enum(['pending', 'deferred']),
  source: materialSourceReferenceSchema.nullable(),
};
const pdfSource = materialSourceReferenceSchema.refine(
  (source) => source.location.kind === 'pdf',
);
/** Only unresolved items live here. Imported interview candidate/interviewer
 * associations are READ ONLY. The server checks the authoritative import row
 * inside the transaction before handling a command/replay; an imported row
 * conflicts without changing either association. Correction requires audited
 * withdrawal of the import first, then a new revision and explicit relinking.
 * Neither an item ID, candidate list nor client role proves that permission.
 */
export const materialReviewItemSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      ...item,
      kind: z.literal('speaker'),
      source: materialSourceReferenceSchema,
      recordingId: id,
      transcriptVersionId: id,
      speakerId: id,
      quote: text,
      candidates,
    }),
    z.strictObject({
      ...item,
      kind: z.literal('unknown_person'),
      observedName: text.nullable(),
      candidates,
    }),
    z.strictObject({
      ...item,
      kind: z.literal('image_scope'),
      proposedRegion: materialImageRegionSchema.nullable(),
    }),
    z.strictObject({
      ...item,
      kind: z.literal('unknown_interviewer'),
      source: pdfSource,
      importRowId: id,
      observedName: text,
      candidates,
    }),
    z.strictObject({
      ...item,
      kind: z.literal('unknown_project'),
      observedName: text.nullable(),
      candidates: projects,
    }),
    z.strictObject({
      ...item,
      kind: z.literal('unknown_interview_candidate'),
      source: pdfSource,
      importRowId: id,
      observedName: text.nullable(),
      candidates,
    }),
  ])
  .refine(
    (value) =>
      value.source === null ||
      value.source.originalVersionId === value.originalVersionId,
  )
  .refine(
    (value) =>
      value.source === null ||
      ((value.kind !== 'image_scope' ||
        value.source.location.kind === 'image') &&
        (value.kind !== 'speaker' ||
          value.source.location.kind === 'recording' ||
          value.source.location.kind === 'video')),
  );

const defer = z.strictObject({ action: z.literal('defer') });
const speaker = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('bind'), personId: id }),
  z.strictObject({ action: z.literal('mark_irrelevant') }),
  z.strictObject({ action: z.literal('unbind') }),
  defer,
]);
const unknownPerson = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('bind_people'), personIds: ids.min(1) }),
  z.strictObject({ action: z.literal('keep_original_only') }),
  defer,
]);
const imageScope = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('confirm_scope'),
    region: materialImageRegionSchema,
    personIds: ids.min(1),
  }),
  z.strictObject({ action: z.literal('keep_attachment_only') }),
  defer,
]);
const interviewer = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('link_existing_interviewer'),
    personId: id,
  }),
  defer,
]);
const unknownProject = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('link_existing_project'), projectId: id }),
  z.strictObject({ action: z.literal('mark_no_project') }),
  defer,
]);
const interviewCandidate = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('link_existing_candidate'),
    personId: id,
  }),
  z.strictObject({ action: z.literal('keep_original_only') }),
  defer,
]);
const command = {
  operationId: id,
  batchId: id,
  itemId: id,
  expectedRevision: revision,
};
export const materialReviewCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...command,
    kind: z.literal('speaker'),
    resolution: speaker,
  }),
  z.strictObject({
    ...command,
    kind: z.literal('unknown_person'),
    resolution: unknownPerson,
  }),
  z.strictObject({
    ...command,
    kind: z.literal('image_scope'),
    resolution: imageScope,
  }),
  z.strictObject({
    ...command,
    kind: z.literal('unknown_interviewer'),
    resolution: interviewer,
  }),
  z.strictObject({
    ...command,
    kind: z.literal('unknown_project'),
    resolution: unknownProject,
  }),
  z.strictObject({
    ...command,
    kind: z.literal('unknown_interview_candidate'),
    resolution: interviewCandidate,
  }),
]);
const receipt = {
  batchId: id,
  materialId: id,
  itemId: id,
  revision,
  remainingReviewItemIds: ids,
  // Unresolved blockers of THIS material/affected target, not the whole batch.
  blockingReviewItemIds: ids,
  invalidatedDraftIds: ids,
};
const resume = <T extends string>(stage: T) =>
  z.strictObject({ stage: z.literal(stage), jobId: id }).nullable();
/** Echo the accepted semantic resolution to bind its no-disclosure outcome.
 * Unrelated remaining items do not hold the entire batch hostage. The server
 * resolves target-specific blockers and rechecks ALL current subjects/sources;
 * the response cannot serve as an authorization flag on a later request.
 */
export const materialReviewResolutionReceiptSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      ...receipt,
      kind: z.literal('speaker'),
      resolution: speaker,
      resume: resume('organizing'),
    }),
    z.strictObject({
      ...receipt,
      kind: z.literal('unknown_person'),
      resolution: unknownPerson,
      resume: resume('organizing'),
    }),
    z.strictObject({
      ...receipt,
      kind: z.literal('image_scope'),
      resolution: imageScope,
      resume: resume('image_scope_check'),
    }),
    z.strictObject({
      ...receipt,
      kind: z.literal('unknown_interviewer'),
      resolution: interviewer,
      resume: resume('interview_import'),
    }),
    z.strictObject({
      ...receipt,
      kind: z.literal('unknown_project'),
      resolution: unknownProject,
      resume: resume('organizing'),
    }),
    z.strictObject({
      ...receipt,
      kind: z.literal('unknown_interview_candidate'),
      resolution: interviewCandidate,
      resume: resume('interview_import'),
    }),
  ])
  .refine((value) =>
    value.blockingReviewItemIds.every((id) =>
      value.remainingReviewItemIds.includes(id),
    ),
  )
  .refine(
    (value) =>
      value.resume === null ||
      (value.blockingReviewItemIds.length === 0 &&
        !(
          [
            'defer',
            'unbind',
            'keep_original_only',
            'keep_attachment_only',
          ] as string[]
        ).includes(value.resolution.action)),
  );
/** Read-only current resolved items, not a client-writable result history.
 * Current authorization filters these just like pending items. Availability is
 * display metadata: the write transaction must recheck actual dependencies.
 */
const resolved = {
  itemId: id,
  batchId: id,
  evaluationNodeId: id,
  materialId: id,
  originalVersionId: id,
  revision,
  source: materialSourceReferenceSchema.nullable(),
  state: z.literal('resolved'),
  resolvedAt: z.iso.datetime(),
  auditId: id,
  undo: z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('available') }),
    z.strictObject({
      status: z.literal('blocked'),
      reason: z.enum(['dependent_draft_confirmed', 'interview_row_imported']),
    }),
  ]),
};
export const materialReviewResolvedItemSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      ...resolved,
      kind: z.literal('speaker'),
      source: materialSourceReferenceSchema,
      resolution: z.discriminatedUnion('action', [
        z.strictObject({ action: z.literal('bind'), personId: id }),
        z.strictObject({ action: z.literal('mark_irrelevant') }),
      ]),
    }),
    z.strictObject({
      ...resolved,
      kind: z.literal('unknown_person'),
      resolution: z.discriminatedUnion('action', [
        z.strictObject({
          action: z.literal('bind_people'),
          personIds: ids.min(1),
        }),
        z.strictObject({ action: z.literal('keep_original_only') }),
      ]),
    }),
    z.strictObject({
      ...resolved,
      kind: z.literal('image_scope'),
      resolution: z.discriminatedUnion('action', [
        z.strictObject({
          action: z.literal('confirm_scope'),
          region: materialImageRegionSchema,
          personIds: ids.min(1),
        }),
        z.strictObject({ action: z.literal('keep_attachment_only') }),
      ]),
    }),
    z.strictObject({
      ...resolved,
      kind: z.literal('unknown_interviewer'),
      source: pdfSource,
      importRowId: id,
      resolution: z.strictObject({
        action: z.literal('link_existing_interviewer'),
        personId: id,
      }),
    }),
    z.strictObject({
      ...resolved,
      kind: z.literal('unknown_project'),
      resolution: z.discriminatedUnion('action', [
        z.strictObject({
          action: z.literal('link_existing_project'),
          projectId: id,
        }),
        z.strictObject({ action: z.literal('mark_no_project') }),
      ]),
    }),
    z.strictObject({
      ...resolved,
      kind: z.literal('unknown_interview_candidate'),
      source: pdfSource,
      importRowId: id,
      resolution: z.discriminatedUnion('action', [
        z.strictObject({
          action: z.literal('link_existing_candidate'),
          personId: id,
        }),
        z.strictObject({ action: z.literal('keep_original_only') }),
      ]),
    }),
  ])
  .refine(
    (value) =>
      value.source === null ||
      value.source.originalVersionId === value.originalVersionId,
  )
  .refine(
    (value) =>
      value.source === null ||
      ((value.kind !== 'image_scope' ||
        value.source.location.kind === 'image') &&
        (value.kind !== 'speaker' ||
          ['recording', 'video'].includes(value.source.location.kind))),
  )
  .refine(
    (value) =>
      value.undo.status !== 'blocked' ||
      value.undo.reason !== 'interview_row_imported' ||
      ['unknown_interviewer', 'unknown_interview_candidate'].includes(
        value.kind,
      ),
  );

/** All six kinds use the same version fence. Actor/permission, resolved payload
 * and cutoff flags are server facts and cannot be supplied by the caller.
 */
export const materialReviewUndoCommandSchema = z.strictObject({
  ...command,
  action: z.literal('undo'),
  kind: z.enum([
    'speaker',
    'unknown_person',
    'image_scope',
    'unknown_interviewer',
    'unknown_project',
    'unknown_interview_candidate',
  ]),
});
export const materialReviewUndoReceiptSchema = z
  .strictObject({
    previousRevision: revision,
    item: materialReviewItemSchema.refine((value) => value.state === 'pending'),
    invalidatedDraftIds: ids,
    auditId: id,
    resume: z.null(),
  })
  .refine((value) => value.item.revision === value.previousRevision + 1);
/** Recheck current authority, material/row binding and actual dependent draft
 * confirmations/imported rows AFTER the source locks, including on replay.
 * A confirmed dependent draft or imported row conflicts; withdraw confirmation
 * or import first. Undo, audit, draft invalidation and pending revision commit
 * together. Never modify confirmed history or automatically enqueue the model.
 * Same actor/key/semantic command replays the original receipt without a new
 * write/job; stale versions or another payload conflict and preserve input.
 */
export const materialReviewUndoResultSchema = recordActionResultSchema(
  materialReviewUndoCommandSchema,
  materialReviewUndoReceiptSchema,
);
export type MaterialReviewResolvedItem = z.infer<
  typeof materialReviewResolvedItemSchema
>;
export type MaterialReviewUndoCommand = z.infer<
  typeof materialReviewUndoCommandSchema
>;
export type MaterialReviewUndoReceipt = z.infer<
  typeof materialReviewUndoReceiptSchema
>;
export type MaterialReviewUndoResult = z.infer<
  typeof materialReviewUndoResultSchema
>;

/** Resolution, invalidation and target-specific resume enqueue commit together.
 * Actor/key/payload replay uses the original receipt/job after CURRENT checks;
 * changed payload or stale revision conflicts and preserves input. Defer/unbind
 * do not arrange. Original-only retains bytes without creating a person/event;
 * whole-image attachment-only has zero model calls and reads require current
 * permission for the WHOLE image. Confirm-scope still returns to BOW-905 for real
 * crop and source/subject filtering before any outbound bytes.
 * Interview kinds only link existing directory entries on the same row. Both
 * candidate and interviewer become read only after import; correction requires
 * audited withdrawal, never a direct relink or undo of the old review item.
 */
export const materialReviewCommandResultSchema = recordActionResultSchema(
  materialReviewCommandSchema,
  materialReviewResolutionReceiptSchema,
);
export type MaterialReviewItem = z.infer<typeof materialReviewItemSchema>;
export type MaterialReviewCommand = z.infer<typeof materialReviewCommandSchema>;
export type MaterialReviewResolutionReceipt = z.infer<
  typeof materialReviewResolutionReceiptSchema
>;
export type MaterialReviewCommandResult = z.infer<
  typeof materialReviewCommandResultSchema
>;
