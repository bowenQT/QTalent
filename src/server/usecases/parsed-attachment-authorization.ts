import {
  canReadNodeTalent,
  type EvaluationAuthzContext,
} from '../authz/evaluation-node';

/** 897 material resolution / unconfirmed draft production, NOT 846 score
 * confirmation. Reuse current evaluator or scoped HR/manager source authority;
 * callers separately require the complete captured scope's actual source kinds
 * for source-read and model-input before generation. */
export function canResolveAttachmentSubjects(
  actor: { context: EvaluationAuthzContext },
  personIds: readonly string[],
  evaluationNodeId: string,
): boolean {
  const allowed = (personId: string) =>
    canReadNodeTalent(
      actor.context,
      { evaluationNodeId, personId, kind: 'evaluation' },
      'source-read',
    );
  return personIds.length
    ? personIds.every(allowed)
    : actor.context.evaluationNodeSubjects.some(
        (subject) =>
          subject.evaluationNodeId === evaluationNodeId &&
          allowed(subject.personId),
      );
}
