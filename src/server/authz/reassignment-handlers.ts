import type { Grant } from './index';
import {
  canManageNodeAssignments,
  eligibleNodeEvaluatorRelations,
  type EvaluationAuthzContext,
} from './evaluation-node';

export interface ReassignmentHrCandidateGrant {
  personId: string;
  accountId: string;
  isSystemAdmin: boolean;
  grant: Grant;
}
export type ReassignmentAuthzContext = EvaluationAuthzContext & {
  hrCandidateGrants?: ReassignmentHrCandidateGrant[];
};
/** Unknown interview identities require scoped HR, not every node rater. */
export function eligibleEvaluationWorkRelations(
  ctx: ReassignmentAuthzContext,
  item: { evaluationNodeId: string; personId: string; kind: string },
) {
  const relations = eligibleNodeEvaluatorRelations(
    ctx,
    item.evaluationNodeId,
    item.personId,
  );
  if (
    item.kind !== 'unknown_interviewer' &&
    item.kind !== 'unknown_interview_candidate'
  )
    return relations;
  return relations.filter(
    (relation) =>
      ctx.hrCandidateGrants?.some(
        (candidate) =>
          candidate.personId === relation.evaluatorId &&
          canManageNodeAssignments(
            {
              ...ctx,
              account: {
                id: candidate.accountId,
                personId: candidate.personId,
                isSystemAdmin: candidate.isSystemAdmin,
              },
              grants: [candidate.grant],
            },
            item.evaluationNodeId,
            item.personId,
          ),
      ) === true,
  );
}
