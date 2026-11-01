import { z } from 'zod';
import { activeGrants } from '../../authz';
import {
  canManageNodeAssignments,
  type EvaluationAuthzContext,
} from '../../authz/evaluation-node';
import {
  materialReviewCommandSchema,
  materialReviewResolvedItemSchema,
  materialReviewResolutionReceiptSchema,
  materialReviewUndoCommandSchema,
  materialReviewUndoReceiptSchema,
  type MaterialReviewItem,
  type MaterialReviewCommand,
  type MaterialReviewResolvedItem,
  type MaterialReviewResolutionReceipt,
} from '../../../contracts/material-review';
import type { MaterialSource } from '../../../contracts/sources';

const id = z.string().min(1).max(200).regex(/\S/);
const revision = z.number().int().positive();
const ids = z.array(id).refine((a) => new Set(a).size === a.length);
const snapshotSchema = z.strictObject({
  batchId: id,
  rowId: id,
  evaluationNodeId: id,
  materialId: id,
  originalVersionId: id,
  revision,
  /** Current whole-original/row HR check, never an upload receipt or client flag. */
  actorAccountId: id,
  hrCohortId: id,
  access: z.enum(['allowed', 'forbidden', 'unavailable']),
  subjectPersonIds: ids.nullable(),
  hasHiddenContent: z.boolean().nullable(),
  blockingReviewItemIds: ids.nullable(),
  import: z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('unimported') }),
    z.strictObject({
      state: z.literal('imported'),
      evaluationId: id,
      personId: id,
    }),
    z.strictObject({
      state: z.literal('withdrawn'),
      previousRevision: revision,
      withdrawalAuditId: id,
      withdrawnAt: z.iso.datetime(),
    }),
  ]),
});
export type InterviewRowSnapshot = z.infer<typeof snapshotSchema>;
export type CommittedInterviewResolution = {
  rowRevision: number;
  item: MaterialReviewResolvedItem;
  receipt: MaterialReviewResolutionReceipt;
};
export type InterviewReviewScope = {
  context: EvaluationAuthzContext;
  batchId: string;
  rowId: string;
  evaluationNodeId: string;
  materialId: string | null;
  originalVersionId: string;
  source: MaterialSource;
};
export function readInterviewRowSnapshot(
  scope: InterviewReviewScope,
  value: unknown,
):
  | { status: 'available'; row: InterviewRowSnapshot }
  | { status: 'forbidden' | 'unavailable' | 'conflict' } {
  if (
    !activeGrants(scope.context).some((g) => g.role === 'hr') ||
    !scope.context.evaluationNodes.some(
      (n) => n.id === scope.evaluationNodeId && n.kind === 'interview',
    )
  )
    return { status: 'forbidden' };
  const p = snapshotSchema.safeParse(value);
  if (
    !p.success ||
    p.data.access === 'unavailable' ||
    p.data.subjectPersonIds === null ||
    p.data.hasHiddenContent === null ||
    p.data.blockingReviewItemIds === null
  )
    return { status: 'unavailable' };
  const row = p.data;
  if (
    row.batchId !== scope.batchId ||
    row.rowId !== scope.rowId ||
    row.evaluationNodeId !== scope.evaluationNodeId ||
    row.materialId !== scope.materialId ||
    row.originalVersionId !== scope.originalVersionId
  )
    return { status: 'conflict' };
  if (
    row.access !== 'allowed' ||
    row.actorAccountId !== scope.context.account.id ||
    !activeGrants(scope.context).some(
      (grant) => grant.role === 'hr' && grant.cohortId === row.hrCohortId,
    ) ||
    !row.subjectPersonIds!.every((personId) =>
      canManageNodeAssignments(scope.context, scope.evaluationNodeId, personId),
    )
  )
    return { status: 'forbidden' };
  if (
    row.import.state === 'withdrawn' &&
    row.import.previousRevision >= row.revision
  )
    return { status: 'conflict' };
  return { status: 'available', row };
}
type InterviewKind = 'unknown_interview_candidate' | 'unknown_interviewer';
export function sameInterviewReview(
  scope: InterviewReviewScope,
  value: MaterialReviewItem | MaterialReviewResolvedItem,
  kind: InterviewKind,
  observedName?: string | null,
) {
  return (
    value.kind === kind &&
    value.batchId === scope.batchId &&
    value.importRowId === scope.rowId &&
    value.evaluationNodeId === scope.evaluationNodeId &&
    value.materialId === scope.materialId &&
    value.originalVersionId === scope.originalVersionId &&
    value.source?.fragmentId === scope.source.fragmentId &&
    value.source.originalVersionId === scope.source.originalVersionId &&
    JSON.stringify(value.source.location) ===
      JSON.stringify(scope.source.location) &&
    (observedName === undefined || value.observedName === observedName)
  );
}
/** Consumes an actual stored resolved item and receipt. Never treats the incoming
 * command or a receipt's resume field as current authority. */
export function committedInterviewResolution(
  scope: InterviewReviewScope,
  pending: MaterialReviewItem,
  command: MaterialReviewCommand,
  value: CommittedInterviewResolution | null,
  currentRowRevision: number,
) {
  const item = materialReviewResolvedItemSchema.safeParse(value?.item);
  const receipt = materialReviewResolutionReceiptSchema.safeParse(
    value?.receipt,
  );
  const cmd = materialReviewCommandSchema.safeParse(command);
  if (
    value?.rowRevision !== currentRowRevision ||
    !item.success ||
    !receipt.success ||
    !cmd.success ||
    (pending.kind !== 'unknown_interviewer' &&
      pending.kind !== 'unknown_interview_candidate') ||
    !sameInterviewReview(
      scope,
      item.data,
      pending.kind,
      pending.observedName,
    ) ||
    item.data.itemId !== pending.itemId ||
    item.data.revision !== pending.revision + 1 ||
    cmd.data.kind !== pending.kind ||
    cmd.data.batchId !== pending.batchId ||
    cmd.data.itemId !== pending.itemId ||
    cmd.data.expectedRevision !== pending.revision ||
    receipt.data.kind !== pending.kind ||
    receipt.data.batchId !== pending.batchId ||
    receipt.data.materialId !== pending.materialId ||
    receipt.data.itemId !== pending.itemId ||
    receipt.data.revision !== item.data.revision ||
    JSON.stringify(cmd.data.resolution) !==
      JSON.stringify(item.data.resolution) ||
    JSON.stringify(receipt.data.resolution) !==
      JSON.stringify(item.data.resolution)
  )
    return null;
  return { item: item.data, receipt: receipt.data };
}

/** Read-only projection of current, server-loaded interview decisions. Hidden
 * items contribute one bit only. No hidden IDs/names/counts are returned. */
export function projectInterviewReviewState(
  scope: InterviewReviewScope,
  snapshot: unknown,
  decisions: MaterialReviewResolvedItem[],
  visibleDirectoryPersonIds: string[],
) {
  const checked = readInterviewRowSnapshot(scope, snapshot);
  if (checked.status !== 'available') return checked;
  let hidden = checked.row.hasHiddenContent!;
  const resolvedItems: MaterialReviewResolvedItem[] = [];
  const seen = new Set<string>();
  for (const value of decisions) {
    const p = materialReviewResolvedItemSchema.safeParse(value);
    if (
      !p.success ||
      !['unknown_interviewer', 'unknown_interview_candidate'].includes(
        p.data.kind,
      )
    )
      return { status: 'conflict' as const };
    const item = p.data;
    if (seen.has(item.itemId)) return { status: 'conflict' as const };
    seen.add(item.itemId);
    if (
      (item.kind !== 'unknown_interviewer' &&
        item.kind !== 'unknown_interview_candidate') ||
      !sameInterviewReview(scope, item, item.kind)
    )
      return { status: 'conflict' as const };
    if (
      'personId' in item.resolution &&
      (!visibleDirectoryPersonIds.includes(item.resolution.personId) ||
        (item.kind === 'unknown_interview_candidate' &&
          !canManageNodeAssignments(
            scope.context,
            scope.evaluationNodeId,
            item.resolution.personId,
          )))
    ) {
      hidden = true;
      continue;
    }
    resolvedItems.push({
      ...item,
      undo:
        checked.row.import.state === 'imported'
          ? { status: 'blocked', reason: 'interview_row_imported' }
          : item.undo,
    });
  }
  return {
    status: 'projected' as const,
    resolvedItems,
    hasHiddenContent: hidden,
  };
}

/** Validate the real transaction's undo receipt; this function does not append
 * audits, invalidate drafts, write pending rows or enqueue jobs. */
export function consumeInterviewUndoReceipt(
  scope: InterviewReviewScope,
  snapshot: unknown,
  resolved: unknown,
  command: unknown,
  receipt: unknown,
  visibleDirectoryPersonIds: string[] | null,
) {
  const checked = readInterviewRowSnapshot(scope, snapshot);
  if (checked.status !== 'available') return checked;
  if (checked.row.import.state === 'imported')
    return {
      status: 'conflict' as const,
      reason: 'interview_row_imported' as const,
    };
  if (visibleDirectoryPersonIds === null)
    return { status: 'unavailable' as const };
  const prior = materialReviewResolvedItemSchema.safeParse(resolved);
  const cmd = materialReviewUndoCommandSchema.safeParse(command);
  const result = materialReviewUndoReceiptSchema.safeParse(receipt);
  if (
    !prior.success ||
    !cmd.success ||
    !result.success ||
    (prior.data.kind !== 'unknown_interviewer' &&
      prior.data.kind !== 'unknown_interview_candidate') ||
    prior.data.undo.status !== 'available' ||
    !sameInterviewReview(scope, prior.data, prior.data.kind) ||
    cmd.data.kind !== prior.data.kind ||
    cmd.data.batchId !== prior.data.batchId ||
    cmd.data.itemId !== prior.data.itemId ||
    cmd.data.expectedRevision !== prior.data.revision ||
    result.data.previousRevision !== prior.data.revision ||
    result.data.item.itemId !== prior.data.itemId ||
    !sameInterviewReview(
      scope,
      result.data.item,
      prior.data.kind,
      prior.data.observedName,
    )
  )
    return { status: 'conflict' as const };
  if (
    'personId' in prior.data.resolution &&
    (!visibleDirectoryPersonIds.includes(prior.data.resolution.personId) ||
      (prior.data.kind === 'unknown_interview_candidate' &&
        !canManageNodeAssignments(
          scope.context,
          scope.evaluationNodeId,
          prior.data.resolution.personId,
        )))
  )
    return { status: 'conflict' as const };
  const pending = result.data.item;
  if (
    (pending.kind !== 'unknown_interviewer' &&
      pending.kind !== 'unknown_interview_candidate') ||
    pending.candidates.some(
      (candidate) =>
        !visibleDirectoryPersonIds.includes(candidate.personId) ||
        (pending.kind === 'unknown_interview_candidate' &&
          !canManageNodeAssignments(
            scope.context,
            scope.evaluationNodeId,
            candidate.personId,
          )),
    )
  )
    return { status: 'conflict' as const };
  return { status: 'accepted' as const, receipt: result.data };
}
