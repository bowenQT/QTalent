import { activeGrants, activeRoles, isCurrent, type Validity } from '../authz';
import {
  canReadNodeTalent,
  type EvaluationAuthzContext,
} from '../authz/evaluation-node';
import type { CurrentComparisonAccess } from '../modules/evaluation-system/judgment-comparison/ports';

export type ComparisonAudience = CurrentComparisonAccess['audience'];
type NodeGrant = CurrentComparisonAccess['grants'][number];

/** Same precedence as the shell role: manager, then HR, then a mentor as rater. */
export function comparisonAudience(
  ctx: EvaluationAuthzContext,
): ComparisonAudience | null {
  if (ctx.account.isSystemAdmin) return null;
  const roles = activeRoles(ctx);
  return roles.includes('manager')
    ? 'manager'
    : roles.includes('hr')
      ? 'hr'
      : roles.includes('mentor')
        ? 'rater'
        : null;
}

/**
 * A validity ends at whichever comes first of its end and its revocation. Stored
 * timestamps come back in PostgreSQL text form; the port carries ISO instants.
 */
function windowOf(value: Validity) {
  const ends = [value.validTo, value.revokedAt]
    .filter((end): end is string => end !== null)
    .map((end) => Date.parse(end));
  return {
    validFrom: new Date(value.validFrom).toISOString(),
    validUntil: ends.length ? new Date(Math.min(...ends)).toISOString() : null,
  };
}

/**
 * The node grants a comparison read may use, each with the window of the grant or
 * relation that authorizes it. Every pair first passes `canReadNodeTalent`, so this
 * never widens the node rules: a manager reads through the company grant, HR
 * through a cohort grant covering the person, a rater only through their own
 * current relation. Past participation is not a grant.
 */
export function comparisonGrants(
  ctx: EvaluationAuthzContext,
  audience: ComparisonAudience,
): NodeGrant[] {
  const grants = activeGrants(ctx);
  const result: NodeGrant[] = [];
  for (const subject of ctx.evaluationNodeSubjects) {
    const { evaluationNodeId: nodeId, personId } = subject;
    if (
      !canReadNodeTalent(
        ctx,
        { evaluationNodeId: nodeId, personId, kind: 'restricted-evaluation' },
        'source-read',
      )
    )
      continue;
    const node = ctx.evaluationNodes.find((item) => item.id === nodeId);
    const sources: Validity[] =
      audience === 'manager'
        ? grants.filter((grant) => grant.role === 'manager')
        : audience === 'hr'
          ? grants.filter(
              (grant) =>
                grant.role === 'hr' &&
                ctx.enrollments.some(
                  (entry) =>
                    entry.personId === personId &&
                    entry.cohortId === grant.cohortId &&
                    isCurrent(entry, ctx.now) &&
                    (entry.confirmed || node?.cohortId === entry.cohortId),
                ),
            )
          : ctx.evaluationRelations.filter(
              (relation) =>
                relation.evaluationNodeId === nodeId &&
                relation.personId === personId &&
                relation.evaluatorId === ctx.account.personId &&
                isCurrent(relation, ctx.now),
            );
    for (const source of sources)
      result.push({ personId, nodeId, ...windowOf(source) });
  }
  return result;
}

export function comparisonAccess(
  ctx: EvaluationAuthzContext,
): CurrentComparisonAccess | null {
  const audience = comparisonAudience(ctx);
  if (!audience) return null;
  return {
    audience,
    viewerId: ctx.account.personId,
    now: ctx.now,
    grants: comparisonGrants(ctx, audience),
  };
}
