import { and, eq, inArray, isNull } from 'drizzle-orm';
import { activeGrants } from '../authz';
import { canManageNodeAssignments } from '../authz/evaluation-node';
import type { DbExecutor } from '../db/client';
import { events } from '../modules/records';
import { scoreReviews } from '../modules/talent';
import {
  ScoreReviewForbiddenError,
  type ReviewAuthority,
  type ReviewTarget,
} from '../modules/talent/score-review/ports';
import { loadEvaluationContext } from './evaluation-context';
import { ForbiddenError } from './project-context';

async function current(db: DbExecutor, accountId: string, now: string) {
  try {
    const loaded = await loadEvaluationContext(db, accountId, now);
    if (!activeGrants(loaded.context).some((grant) => grant.role === 'hr'))
      throw new ScoreReviewForbiddenError();
    return loaded.context;
  } catch (error) {
    if (error instanceof ForbiddenError) throw new ScoreReviewForbiddenError();
    throw error;
  }
}

/** Native current authority; actor noReview is not a prohibition on HR work. */
export async function readScoreReviewAuthority(
  db: DbExecutor,
  accountId: string,
  now: string,
): Promise<ReviewAuthority> {
  const context = await current(db, accountId, now);
  return {
    accountId: context.account.id,
    personId: context.account.personId,
    isSystemAdmin: false,
    hasHrRole: true,
  };
}

const targetColumns = {
  itemId: scoreReviews.id,
  eventId: events.id,
  personId: events.personId,
  evaluationNodeId: events.evaluationNodeId,
  dimensionId: scoreReviews.dimensionId,
  ruleVersion: events.ruleVersionId,
};

/** Metadata only, filtered before loading either score, reason, or citation.
 * A review's current revision and exact saved sides require the ledger reader.
 * These rows are not ready review items and grant no source access. */
export async function listAuthorizedScoreReviewIdentities(
  db: DbExecutor,
  accountId: string,
  now: string,
) {
  const context = await current(db, accountId, now);
  const rows = await db
    .select(targetColumns)
    .from(scoreReviews)
    .innerJoin(events, eq(events.id, scoreReviews.eventId))
    .where(
      and(
        eq(scoreReviews.status, 'open'),
        isNull(scoreReviews.withdrawnAt),
        isNull(events.withdrawnAt),
        inArray(scoreReviews.reason, [
          'score_gap',
          'ai_changed_without_reason',
        ]),
      ),
    )
    .orderBy(scoreReviews.id);
  return rows.filter(
    (row) =>
      row.evaluationNodeId !== null &&
      canManageNodeAssignments(context, row.evaluationNodeId, row.personId),
  );
}

/** Re-read both binding and target identity. A caller-supplied HR flag or a
 * person's permission at a different node cannot authorize this review. */
export async function canReviewScoreTarget(
  db: DbExecutor,
  authority: ReviewAuthority,
  target: ReviewTarget,
  now: string,
): Promise<boolean> {
  let context;
  try {
    context = await current(db, authority.accountId, now);
  } catch (error) {
    if (error instanceof ScoreReviewForbiddenError) return false;
    throw error;
  }
  if (context.account.personId !== authority.personId) return false;
  const [row] = await db
    .select(targetColumns)
    .from(scoreReviews)
    .innerJoin(events, eq(events.id, scoreReviews.eventId))
    .where(
      and(
        eq(scoreReviews.id, target.itemId),
        isNull(scoreReviews.withdrawnAt),
        isNull(events.withdrawnAt),
        inArray(scoreReviews.reason, [
          'score_gap',
          'ai_changed_without_reason',
        ]),
      ),
    );
  return (
    row !== undefined &&
    row.evaluationNodeId !== null &&
    row.eventId === target.eventId &&
    row.personId === target.personId &&
    row.evaluationNodeId === target.evaluationNodeId &&
    row.dimensionId === target.dimensionId &&
    row.ruleVersion === target.ruleVersion &&
    canManageNodeAssignments(context, row.evaluationNodeId, row.personId)
  );
}
