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
/**
 * Server policy descriptions, not client role grants. Candidate lists are
 * filtered by current node/people permissions. Expired relationships go to
 * HR reassignment (BOW-899), never to a wider implicit audience.
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
      // null also represents a batch submitted without selecting any person.
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
      source: materialSourceReferenceSchema.refine(
        (source) => source.location.kind === 'pdf',
      ),
      importRowId: id,
      observedName: text,
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
const command = {
  operationId: id,
  batchId: id,
  itemId: id,
  expectedRevision: revision,
};
const defer = z.strictObject({ action: z.literal('defer') });
export const materialReviewCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...command,
    kind: z.literal('speaker'),
    resolution: z.discriminatedUnion('action', [
      z.strictObject({ action: z.literal('bind'), personId: id }),
      z.strictObject({ action: z.literal('mark_irrelevant') }),
      z.strictObject({ action: z.literal('unbind') }),
      defer,
    ]),
  }),
  z.strictObject({
    ...command,
    kind: z.literal('unknown_person'),
    resolution: z.discriminatedUnion('action', [
      z.strictObject({
        action: z.literal('bind_people'),
        personIds: ids.min(1),
      }),
      defer,
    ]),
  }),
  z.strictObject({
    ...command,
    kind: z.literal('image_scope'),
    resolution: z.discriminatedUnion('action', [
      z.strictObject({
        action: z.literal('confirm_scope'),
        region: materialImageRegionSchema,
        personIds: ids.min(1),
      }),
      defer,
    ]),
  }),
  z.strictObject({
    ...command,
    kind: z.literal('unknown_interviewer'),
    resolution: z.discriminatedUnion('action', [
      // Existing directory entries only; no create-person escape hatch.
      z.strictObject({
        action: z.literal('link_existing_interviewer'),
        personId: id,
      }),
      defer,
    ]),
  }),
]);
const receipt = {
  batchId: id,
  itemId: id,
  revision,
  remainingReviewItemIds: ids,
  invalidatedDraftIds: ids,
};
const resume = <T extends string>(stage: T) =>
  z.strictObject({ stage: z.literal(stage), jobId: id }).nullable();
export const materialReviewResolutionReceiptSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      ...receipt,
      kind: z.literal('speaker'),
      resume: resume('organizing'),
    }),
    z.strictObject({
      ...receipt,
      kind: z.literal('unknown_person'),
      resume: resume('organizing'),
    }),
    z.strictObject({
      ...receipt,
      kind: z.literal('image_scope'),
      resume: resume('image_scope_check'),
    }),
    z.strictObject({
      ...receipt,
      kind: z.literal('unknown_interviewer'),
      resume: resume('interview_import'),
    }),
  ])
  .refine(
    (value) =>
      value.resume === null || value.remainingReviewItemIds.length === 0,
  );
/**
 * Resolution and resume enqueue commit together, with three-layer idempotency.
 * Same actor/key/payload returns the same receipt/job; changed payload or stale
 * item revision conflicts and preserves input. Recheck permissions before replay.
 * Defer, unbind or remaining blockers never enqueue arrangement. Rebinding
 * invalidates old drafts; confirmed results require an explicit revision.
 *
 * Image scope resolution is NOT authorization to send the original image:
 * BOW-905 rechecks all subjects and actually crops outbound bytes first.
 * Unknown/unauthorized scope => zero model calls, even with a selected node.
 * Interviewer linking resumes this same import batch; never invent a person or
 * import unresolved rows, never attribute an import to interviewer confirmation.
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
