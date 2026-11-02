import {
  canEvaluateNode,
  canManageNodeAssignments,
  canReadNodeTalent,
  type EvaluationAuthzContext,
} from '../../../authz/evaluation-node';
import type {
  ManagementObservation,
  ObservationSource,
  ObservationSubject,
} from './model';

function complete(context: EvaluationAuthzContext): boolean {
  return (
    Number.isFinite(Date.parse(context.now)) &&
    Array.isArray(context.evaluationNodes) &&
    Array.isArray(context.evaluationNodeSubjects) &&
    Array.isArray(context.evaluationRelations)
  );
}
export function canCreateObservation(
  context: EvaluationAuthzContext,
  subject: ObservationSubject,
  origin: 'manual' | 'interview_import',
): boolean {
  if (!complete(context)) return false;
  if (origin === 'interview_import')
    return (
      context.evaluationNodes.some(
        (node) =>
          node.id === subject.evaluationNodeId && node.kind === 'interview',
      ) &&
      canManageNodeAssignments(
        context,
        subject.evaluationNodeId,
        subject.personId,
      )
    );
  return (
    canReadNodeTalent(
      context,
      { ...subject, kind: 'management-observation' },
      'person-profile',
    ) || canEvaluateNode(context, subject.evaluationNodeId, subject.personId)
  );
}
export function canReadObservation(
  context: EvaluationAuthzContext,
  row: ManagementObservation,
): boolean {
  if (!complete(context)) return false;
  return (
    canReadNodeTalent(
      context,
      {
        evaluationNodeId: row.evaluationNodeId,
        personId: row.personId,
        kind: 'management-observation',
      },
      'person-profile',
    ) ||
    (row.author.personId === context.account.personId &&
      canEvaluateNode(context, row.evaluationNodeId, row.personId))
  );
}
/** Every mixed source subject/kind must remain allowed; authorship is not a file grant. */
export function canReadObservationSource(
  context: EvaluationAuthzContext,
  source: ObservationSource,
): boolean {
  return (
    complete(context) &&
    source.subjects.length > 0 &&
    source.subjects.every((subject) =>
      [source.kind, ...source.requiredKinds].every((kind) =>
        canReadNodeTalent(context, { ...subject, kind }, 'source-read'),
      ),
    )
  );
}
