import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DbExecutor, Transaction } from '../../db/client';
import { aiSuggestions, confirmations, scoreReviews } from './schema';
import { confirmationReviewReasons } from './write-policy';

/** Shared by confirmation, HR review and undo; acquire after a draft lock if any. */
export async function lockScoreEvents(tx: Transaction, eventIds: string[]) {
  for (const eventId of [...new Set(eventIds)].sort()) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${'score-event:' + eventId},0))`,
    );
  }
}
export async function readEventScoreState(db: DbExecutor, eventIds: string[]) {
  if (!eventIds.length)
    return { confirmations: [], suggestions: [], reviews: [] };
  return {
    confirmations: await db
      .select()
      .from(confirmations)
      .where(inArray(confirmations.eventId, eventIds)),
    suggestions: await db
      .select()
      .from(aiSuggestions)
      .where(inArray(aiSuggestions.eventId, eventIds)),
    reviews: await db
      .select()
      .from(scoreReviews)
      .where(inArray(scoreReviews.eventId, eventIds)),
  };
}
export async function insertConfirmedScore(
  tx: Transaction,
  row: Omit<
    typeof confirmations.$inferInsert,
    | 'id'
    | 'sourceCategory'
    | 'revision'
    | 'active'
    | 'previousId'
    | 'previousRevision'
  >,
  context: {
    saveId: string;
    aiValue: number | null;
    peers: { id: string; evaluatorId: string | null; value: number | null }[];
  },
) {
  const id = randomUUID();
  await tx.insert(confirmations).values({
    ...row,
    id,
    sourceCategory: 'original',
    revision: 1,
    active: true,
  });
  const reasons = confirmationReviewReasons({
    value: row.value ?? null,
    aiValue: context.aiValue,
    reason: row.reason ?? '',
    evaluatorId: row.evaluatorId!,
    peers: context.peers.flatMap((peer) =>
      peer.evaluatorId === null
        ? []
        : [{ evaluatorId: peer.evaluatorId, value: peer.value }],
    ),
  });
  const reviewIds: string[] = [];
  if (reasons.includes('ai_changed_without_reason')) {
    const reviewId = randomUUID();
    await tx.insert(scoreReviews).values({
      id: reviewId,
      eventId: row.eventId,
      dimensionId: row.dimensionId,
      reason: 'ai_changed_without_reason',
      saveId: context.saveId,
      confirmationId: id,
      suggestionId: row.suggestionId,
    });
    reviewIds.push(reviewId);
  }
  if (reasons.includes('score_gap')) {
    for (const peer of context.peers) {
      if (
        peer.evaluatorId === null ||
        peer.evaluatorId === row.evaluatorId ||
        peer.value === null ||
        row.value == null ||
        Math.abs(peer.value - row.value) < 2
      )
        continue;
      const reviewId = randomUUID();
      await tx.insert(scoreReviews).values({
        id: reviewId,
        eventId: row.eventId,
        dimensionId: row.dimensionId,
        reason: 'score_gap',
        saveId: context.saveId,
        confirmationId: id,
        counterpartConfirmationId: peer.id,
      });
      reviewIds.push(reviewId);
    }
  }
  return { confirmationId: id, reviewIds };
}
export async function withdrawSavedScores(
  tx: Transaction,
  confirmationIds: string[],
  reviewIds: string[],
  withdrawnAt: Date,
) {
  if (confirmationIds.length)
    await tx
      .update(confirmations)
      .set({ active: false })
      .where(inArray(confirmations.id, confirmationIds));
  if (reviewIds.length)
    await tx
      .update(scoreReviews)
      .set({ withdrawnAt })
      .where(inArray(scoreReviews.id, reviewIds));
}
export async function readEffectiveScoreReviews(db: DbExecutor) {
  return db
    .select()
    .from(scoreReviews)
    .where(
      and(eq(scoreReviews.status, 'open'), isNull(scoreReviews.withdrawnAt)),
    );
}

export async function insertRecordSuggestion(
  tx: Transaction,
  row: Omit<typeof aiSuggestions.$inferInsert, 'id' | 'sourceCategory'>,
): Promise<string> {
  const id = randomUUID();
  await tx
    .insert(aiSuggestions)
    .values({ ...row, id, sourceCategory: 'original' });
  return id;
}
