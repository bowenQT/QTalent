import {
  materialReviewCommandSchema,
  materialReviewItemSchema,
  materialReviewResolutionReceiptSchema,
} from '../../../../contracts/material-review';
import type { MaterialImageRegion } from '../../../../contracts/sources';
import type { MediaReviewState } from './read';

export type CurrentImageDecision =
  | { state: 'unavailable' }
  | { state: 'attachment_only'; operationId: string; itemRevision: number }
  | {
      state: 'verified';
      operationId: string;
      itemRevision: number;
      region: MaterialImageRegion;
      personIds: string[];
    };

/** Only the CURRENT, exact operation can prove a crop decision. This is still
 * not permission: the usecase must load the entire original's current subjects
 * and kinds and apply current write/read/model policy before any bytes leave.
 */
export function currentImageDecision(
  state: MediaReviewState,
): CurrentImageDecision {
  const unavailable: CurrentImageDecision = { state: 'unavailable' };
  if (
    state.availability !== 'current' ||
    !state.input.batchId ||
    !state.input.evaluationNodeId
  )
    return unavailable;
  const images = state.items.filter((item) => item.kind === 'image_scope');
  if (images.length !== 1) return unavailable;
  const item = images[0];
  const question = materialReviewItemSchema.safeParse(item.question);
  if (
    !question.success ||
    question.data.kind !== 'image_scope' ||
    question.data.originalVersionId !== state.material.originalVersionId ||
    question.data.batchId !== state.input.batchId ||
    question.data.evaluationNodeId !== state.input.evaluationNodeId ||
    item.state !== 'resolved' ||
    item.currentOperationId === null
  )
    return unavailable;
  const operation = state.operations.find(
    (row) => row.id === item.currentOperationId,
  );
  if (
    !operation ||
    operation.action !== 'resolve' ||
    operation.materialId !== state.material.id ||
    operation.itemId !== item.id
  )
    return unavailable;
  if (
    !state.audits.some(
      (audit) =>
        audit.id === operation.auditId &&
        audit.actorId === operation.actorAccountId &&
        audit.resourceId === state.material.id &&
        audit.action === 'material.review',
    )
  )
    return unavailable;
  const command = materialReviewCommandSchema.safeParse(operation.command);
  const receipt = materialReviewResolutionReceiptSchema.safeParse(
    operation.receipt,
  );
  if (
    !command.success ||
    !receipt.success ||
    command.data.kind !== 'image_scope' ||
    receipt.data.kind !== 'image_scope'
  )
    return unavailable;
  const c = command.data,
    r = receipt.data;
  const changed = operation.changes.filter(
    (change) => change.itemId === item.id,
  );
  if (
    c.operationId !== operation.operationId ||
    c.itemId !== item.id ||
    r.itemId !== item.id ||
    c.batchId !== state.input.batchId ||
    r.batchId !== c.batchId ||
    r.materialId !== state.material.id ||
    r.revision !== item.revision ||
    changed.length !== 1 ||
    changed[0].previousRevision !== c.expectedRevision ||
    changed[0].revision !== item.revision ||
    item.revision !== c.expectedRevision + 1 ||
    JSON.stringify(c.resolution) !== JSON.stringify(r.resolution)
  )
    return unavailable;
  if (r.resolution.action === 'keep_attachment_only')
    return {
      state: 'attachment_only',
      operationId: operation.id,
      itemRevision: item.revision,
    };
  if (
    r.resolution.action !== 'confirm_scope' ||
    r.blockingReviewItemIds.length ||
    r.resume?.stage !== 'image_scope_check' ||
    r.resume.jobId !== state.job.jobId ||
    state.items.some((row) => row.state !== 'resolved')
  )
    return unavailable;
  return {
    state: 'verified',
    operationId: operation.id,
    itemRevision: item.revision,
    region: r.resolution.region,
    personIds: r.resolution.personIds,
  };
}
