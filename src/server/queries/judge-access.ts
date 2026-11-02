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

const canReadSubject = (
  ctx: EvaluationAuthzContext,
  evaluationNodeId: string,
  personId: string,
) =>
  canReadNodeTalent(
    ctx,
    { evaluationNodeId, personId, kind: 'restricted-evaluation' },
    'source-read',
  );

const ownRelations = (
  ctx: EvaluationAuthzContext,
  evaluationNodeId: string,
  personId: string,
) =>
  ctx.evaluationRelations.filter(
    (relation) =>
      relation.evaluationNodeId === evaluationNodeId &&
      relation.personId === personId &&
      relation.evaluatorId === ctx.account.personId &&
      isCurrent(relation, ctx.now),
  );

/**
 * A rater's current relations that cover a stage of this person: their own
 * relation on the stage node, or on the cohort node of the stage's cohort, where
 * mentors and assistants are assigned. The cohort relation counts here only, for
 * comparing the rater's own judgments; it grants nothing on the stage node itself,
 * so profiles, recording and score confirmation keep the node rules.
 */
function raterSources(
  ctx: EvaluationAuthzContext,
  nodeId: string,
  personId: string,
): Validity[] {
  const direct = canReadSubject(ctx, nodeId, personId)
    ? ownRelations(ctx, nodeId, personId)
    : [];
  const cohortId = ctx.evaluationNodes.find(
    (node) => node.id === nodeId,
  )?.cohortId;
  const viaCohort = ctx.evaluationNodes
    .filter(
      (node) =>
        node.kind === 'program_cohort' &&
        node.id !== nodeId &&
        cohortId != null &&
        node.cohortId === cohortId &&
        canReadSubject(ctx, node.id, personId),
    )
    .flatMap((node) => ownRelations(ctx, node.id, personId));
  return [...direct, ...viaCohort];
}

/**
 * The node grants a comparison read may use, each with the window of the grant or
 * relation that authorizes it. A manager reads through the company grant and HR
 * through a cohort grant covering the person, both after `canReadNodeTalent`; a
 * rater only through their own current relations (`raterSources`). Past
 * participation is not a grant.
 */
export function comparisonGrants(
  ctx: EvaluationAuthzContext,
  audience: ComparisonAudience,
): NodeGrant[] {
  const grants = activeGrants(ctx);
  const result: NodeGrant[] = [];
  for (const subject of ctx.evaluationNodeSubjects) {
    const { evaluationNodeId: nodeId, personId } = subject;
    if (audience === 'rater') {
      for (const source of raterSources(ctx, nodeId, personId))
        result.push({ personId, nodeId, ...windowOf(source) });
      continue;
    }
    if (!canReadSubject(ctx, nodeId, personId)) continue;
    const node = ctx.evaluationNodes.find((item) => item.id === nodeId);
    const sources: Validity[] =
      audience === 'manager'
        ? grants.filter((grant) => grant.role === 'manager')
        : grants.filter(
            (grant) =>
              grant.role === 'hr' &&
              ctx.enrollments.some(
                (entry) =>
                  entry.personId === personId &&
                  entry.cohortId === grant.cohortId &&
                  isCurrent(entry, ctx.now) &&
                  (entry.confirmed || node?.cohortId === entry.cohortId),
              ),
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
