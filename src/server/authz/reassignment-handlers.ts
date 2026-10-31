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
/** An unknown interviewer can only be resolved by a scoped HR, not every rater. */
export function eligibleEvaluationWorkRelations(
  ctx: ReassignmentAuthzContext,
  item: { evaluationNodeId: string; personId: string; kind: string },
) {
  const relations = eligibleNodeEvaluatorRelations(
    ctx,
    item.evaluationNodeId,
    item.personId,
  );
  if (item.kind !== 'unknown_interviewer') return relations;
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
