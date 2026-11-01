import { createHash } from 'node:crypto';
import { isCurrent } from '../../authz';
import {
  canEvaluateNode,
  canManageNodeAssignments,
  type EvaluationAuthzContext,
} from '../../authz/evaluation-node';
import {
  eligibleEvaluationWorkRelations,
  type ReassignmentAuthzContext,
} from '../../authz/reassignment-handlers';
import type {
  EvaluationReassignmentReceipt,
  EvaluationWorkItem,
  ReassignEvaluationWorkInput,
} from './reassignment-contract';

export class EvaluationReassignmentError extends Error {
  constructor(
    readonly status: 'forbidden' | 'not_found' | 'conflict',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'EvaluationReassignmentError';
  }
}
export function evaluationReassignmentFingerprint(
  input: ReassignEvaluationWorkInput,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        input.workItemId,
        input.expectedRevision,
        input.targetRelationId,
      ]),
    )
    .digest('hex');
}
/** Exact bound relation, not merely a new grant for the same evaluated person. */
export function assignedEvaluationRelationIsCurrent(
  context: EvaluationAuthzContext,
  item: EvaluationWorkItem,
): boolean {
  return context.evaluationRelations.some(
    (relation) =>
      relation.id === item.assignedRelationId &&
      relation.evaluationNodeId === item.evaluationNodeId &&
      relation.personId === item.personId &&
      relation.evaluatorId === item.assignedEvaluatorId &&
      isCurrent(relation, context.now),
  );
}
/** The original owner must still be able to handle this KIND of item.
 * A current node relation alone does not retain scoped HR qualification.
 */
export function assignedEvaluationHandlerIsCurrent(
  context: ReassignmentAuthzContext,
  item: EvaluationWorkItem,
): boolean {
  return eligibleEvaluationWorkRelations(context, item).some(
    (relation) =>
      relation.id === item.assignedRelationId &&
      relation.evaluatorId === item.assignedEvaluatorId,
  );
}
export function canWorkOnEvaluationItem(
  context: EvaluationAuthzContext,
  item: EvaluationWorkItem,
): boolean {
  return (
    (item.state === 'pending' || item.state === 'processing') &&
    context.account.personId === item.assignedEvaluatorId &&
    assignedEvaluationRelationIsCurrent(context, item) &&
    canEvaluateNode(context, item.evaluationNodeId, item.personId) &&
    (!['unknown_interviewer', 'unknown_interview_candidate'].includes(
      item.kind,
    ) ||
      canManageNodeAssignments(context, item.evaluationNodeId, item.personId))
  );
}
/**
 * Called under the operation lock and work-row lock with fresh scope facts.
 * Current HR authorization is checked before replay; state eligibility is only
 * for a new operation, so a completed/reassigned item can replay its receipt.
 */
export function planEvaluationReassignment(
  context: ReassignmentAuthzContext,
  item: EvaluationWorkItem | null,
  input: ReassignEvaluationWorkInput,
  operation: {
    fingerprint: string;
    receipt: EvaluationReassignmentReceipt;
  } | null,
): { replayed: boolean; receipt: EvaluationReassignmentReceipt } {
  if (!item)
    throw new EvaluationReassignmentError('not_found', '事项不存在或不可见');
  if (!canManageNodeAssignments(context, item.evaluationNodeId, item.personId))
    throw new EvaluationReassignmentError(
      'forbidden',
      '你没有重新分派此事项的权限',
    );
  if (operation) {
    if (operation.fingerprint !== evaluationReassignmentFingerprint(input))
      throw new EvaluationReassignmentError(
        'conflict',
        '同一提交编号不能用于不同内容',
      );
    return { replayed: true, receipt: operation.receipt };
  }
  if (
    item.revision !== input.expectedRevision ||
    (item.state !== 'pending' && item.state !== 'processing') ||
    assignedEvaluationHandlerIsCurrent(context, item)
  )
    throw new EvaluationReassignmentError(
      'conflict',
      '事项版本或分派状态已变化，请刷新后重试',
    );
  const target = eligibleEvaluationWorkRelations(context, item).find(
    (relation) => relation.id === input.targetRelationId,
  );
  if (!target)
    throw new EvaluationReassignmentError(
      'conflict',
      '接手评价关系已失效或不属于当前节点',
    );
  return {
    replayed: false,
    receipt: {
      workItemId: item.id,
      evaluationNodeId: item.evaluationNodeId,
      personId: item.personId,
      kind: item.kind,
      resourceId: item.resourceId,
      previousRelationId: item.assignedRelationId,
      previousEvaluatorId: item.assignedEvaluatorId,
      assignedRelationId: target.id,
      assignedEvaluatorId: target.evaluatorId,
      revision: item.revision + 1,
      reassignedBy: context.account.id,
      reassignedAt: new Date(context.now).toISOString(),
    },
  };
}
