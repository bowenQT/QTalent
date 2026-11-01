import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { reviewCalibrationSchema } from '../../../../contracts/review-queue';
import type { Transaction } from '../../../db/client';
import { recordAudit } from '../../../platform/audit';
import { accountBindings } from '../../directory';
import { anchors } from '../../evaluation-system';
import { events } from '../../records';
import {
  aiSuggestions,
  confirmations,
  scoreReviews,
  scoreReviewCalibrations,
  scoreReviewOperations,
} from '../schema';
import { validateCalibrationWrite } from './calibration-write';
import { digest } from './service';
import {
  ScoreReviewForbiddenError,
  ScoreReviewStoreConflict,
  type Calibration,
  type ReviewOperation,
} from './ports';

const hex = z.string().regex(/^[a-f0-9]{64}$/);
const bindingsSchema = z.strictObject({
  sourceFactRevision: hex,
  confirmationId: z.string().min(1),
  counterpartConfirmationId: z.string().min(1).nullable(),
  suggestionId: z.string().min(1).nullable(),
});
export type NativeCalibrationBindings = z.infer<typeof bindingsSchema>;
type StoredCalibration = typeof scoreReviewCalibrations.$inferSelect;
function conflict(): never {
  throw new ScoreReviewStoreConflict();
}
function scope(row: StoredCalibration) {
  return {
    itemId: row.itemId,
    eventId: row.eventId,
    personId: row.personId,
    evaluationNodeId: row.evaluationNodeId,
    dimensionId: row.dimensionId,
    ruleVersion: row.ruleVersionId,
  };
}

/** Integrity only. This reader never grants permission to view the payload. */
function decode(row: StoredCalibration): Calibration {
  try {
    const result = reviewCalibrationSchema.parse(row.payload);
    if (
      result.itemId !== row.itemId ||
      result.revision !== row.revision ||
      result.original.id !== row.itemId ||
      result.original.revision !== row.originalRevision ||
      row.revision !== row.originalRevision + 1 ||
      result.original.eventId !== row.eventId ||
      result.original.personId !== row.personId ||
      result.original.dimensionId !== row.dimensionId ||
      result.score.raterId !== row.actorPersonId ||
      result.score.confirmedAt !== row.confirmedAt.toISOString() ||
      result.score.value !== row.value ||
      result.score.anchor.id !== row.anchorId ||
      result.score.anchor.ruleVersion !== row.ruleVersionId ||
      !result.score.reason.trim() ||
      digest(result.original) !== row.originalFingerprint ||
      digest(scope(row)) !== row.scopeFingerprint ||
      !hex.safeParse(row.sourceFactRevision).success
    )
      conflict();
    const sides =
      result.original.kind === 'rater_gap'
        ? result.original.sides
        : [result.original.human, result.original.ai];
    if (sides.some((side) => side.anchor.ruleVersion !== row.ruleVersionId))
      conflict();
    const citations = new Set(
      sides.flatMap((side) => side.citations).map(digest),
    );
    const written = result.score.citations.map(digest);
    if (
      written.length !== citations.size ||
      new Set(written).size !== citations.size ||
      written.some((value) => !citations.has(value)) ||
      (result.original.kind === 'rater_gap' &&
        !row.counterpartConfirmationId) ||
      (result.original.kind === 'ai_gap' && !row.suggestionId)
    )
      conflict();
    return result;
  } catch {
    return conflict();
  }
}

async function storage<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (
      error instanceof ScoreReviewStoreConflict ||
      error instanceof ScoreReviewForbiddenError
    )
      throw error;
    const cause = error instanceof Error && error.cause ? error.cause : error;
    if (
      typeof cause === 'object' &&
      cause !== null &&
      'code' in cause &&
      ['23505', '23503', '23514', '40001', '40P01'].includes(String(cause.code))
    )
      conflict();
    // Raw SQL, parameters and original evidence never escape this boundary.
    throw new Error('评分复核存储不可用');
  }
}

/** Private persistence adapter, not a public command or an authorization reader.
 * Caller FIRST acquires the shared READ COMMITTED ledger fence, then locks and
 * rechecks current HR/full-source authority and exact native facts in this tx.
 * The pre-write source digest is evidence; closing the review changes that digest.
 * Never compare it wholesale against the post-write ledger to invalidate history.
 */
export function createPostgresScoreReviewStore() {
  async function calibration(tx: Transaction, itemId: string) {
    return storage(async () => {
      const [row] = await tx
        .select()
        .from(scoreReviewCalibrations)
        .where(eq(scoreReviewCalibrations.itemId, itemId));
      return row ? decode(row) : null;
    });
  }
  async function operation(
    tx: Transaction,
    accountId: string,
    operationId: string,
  ): Promise<ReviewOperation | null> {
    return storage(async () => {
      const [row] = await tx
        .select({
          operation: scoreReviewOperations,
          calibration: scoreReviewCalibrations,
        })
        .from(scoreReviewOperations)
        .innerJoin(
          scoreReviewCalibrations,
          and(
            eq(scoreReviewCalibrations.itemId, scoreReviewOperations.itemId),
            eq(
              scoreReviewCalibrations.revision,
              scoreReviewOperations.calibrationRevision,
            ),
            eq(
              scoreReviewCalibrations.actorAccountId,
              scoreReviewOperations.actorAccountId,
            ),
            eq(
              scoreReviewCalibrations.actorPersonId,
              scoreReviewOperations.actorPersonId,
            ),
          ),
        )
        .where(
          and(
            eq(scoreReviewOperations.actorAccountId, accountId),
            eq(scoreReviewOperations.operationId, operationId),
          ),
        );
      if (!row) return null;
      if (
        !hex.safeParse(row.operation.fingerprint).success ||
        row.operation.scopeFingerprint !== row.calibration.scopeFingerprint
      )
        conflict();
      return {
        accountId,
        operationId,
        fingerprint: row.operation.fingerprint,
        scopeFingerprint: row.operation.scopeFingerprint,
        result: decode(row.calibration),
      };
    });
  }
  return {
    calibration,
    operation,
    async lockOperation(
      tx: Transaction,
      accountId: string,
      operationId: string,
    ) {
      // Caller must already hold the shared ledger fence; no fictitious event lock.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['talent.score-review', accountId, operationId])}, 0))`,
      );
    },
    async applyCalibration(
      tx: Transaction,
      input: unknown,
      nativeBindings: unknown,
    ) {
      const write = validateCalibrationWrite(input);
      const bindings = (() => {
        try {
          return bindingsSchema.parse(nativeBindings);
        } catch {
          return conflict();
        }
      })();
      return storage(() =>
        tx.transaction(async (savepoint) => {
          const [review] = await savepoint
            .select()
            .from(scoreReviews)
            .where(eq(scoreReviews.id, write.target.itemId))
            .for('update');
          if (
            !review ||
            review.status !== 'open' ||
            review.withdrawnAt !== null ||
            review.revision !== write.target.revision ||
            review.eventId !== write.target.eventId ||
            review.dimensionId !== write.target.dimensionId ||
            !review.saveId ||
            review.confirmationId !== bindings.confirmationId ||
            review.counterpartConfirmationId !==
              bindings.counterpartConfirmationId ||
            review.reason !==
              (write.result.original.kind === 'rater_gap'
                ? 'score_gap'
                : 'ai_changed_without_reason')
          )
            conflict();

          const [event] = await savepoint
            .select()
            .from(events)
            .where(eq(events.id, review.eventId))
            .for('share');
          if (
            !event ||
            event.withdrawnAt !== null ||
            event.personId !== write.target.personId ||
            event.evaluationNodeId !== write.target.evaluationNodeId ||
            event.ruleVersionId !== write.target.ruleVersion
          )
            conflict();
          const [actor] = await savepoint
            .select()
            .from(accountBindings)
            .where(eq(accountBindings.accountId, write.accountId))
            .for('share');
          if (
            !actor ||
            actor.personId !== write.actorPersonId ||
            actor.isSystemAdmin
          )
            throw new ScoreReviewForbiddenError();

          const ids = [
            bindings.confirmationId,
            bindings.counterpartConfirmationId,
          ].filter((id): id is string => id !== null);
          const rows = await savepoint
            .select()
            .from(confirmations)
            .where(inArray(confirmations.id, ids))
            .orderBy(confirmations.id)
            .for('share');
          const original = write.result.original;
          const humanScores =
            original.kind === 'rater_gap' ? original.sides : [original.human];
          if (
            ids.length !== humanScores.length ||
            new Set(ids).size !== ids.length
          )
            conflict();
          for (let i = 0; i < ids.length; i++) {
            const row = rows.find((value) => value.id === ids[i]);
            const score = humanScores[i]!;
            if (
              !row ||
              !row.active ||
              row.sourceCategory !== 'original' ||
              row.status !== 'scored' ||
              row.eventId !== event.id ||
              row.dimensionId !== review.dimensionId ||
              row.ruleVersionId !== event.ruleVersionId ||
              row.evaluatorId !== score.raterId ||
              row.value !== score.value ||
              row.anchorId !== score.anchor.id ||
              row.confirmedAt?.toISOString() !== score.confirmedAt ||
              !score.citations.some(
                (citation) =>
                  citation.kind === 'source' &&
                  citation.reference.fragmentId === row.fragmentId &&
                  citation.reference.originalVersionId ===
                    row.originalVersionId,
              )
            )
              conflict();
          }
          if (original.kind === 'ai_gap') {
            const human = rows.find(
              (row) => row.id === bindings.confirmationId,
            )!;
            if (
              !bindings.suggestionId ||
              human.suggestionId !== bindings.suggestionId
            )
              conflict();
            const [ai] = await savepoint
              .select()
              .from(aiSuggestions)
              .where(eq(aiSuggestions.id, bindings.suggestionId))
              .for('share');
            if (
              !ai ||
              ai.status !== 'scored' ||
              ai.sourceCategory !== 'original' ||
              ai.eventId !== event.id ||
              ai.dimensionId !== review.dimensionId ||
              ai.ruleVersionId !== event.ruleVersionId ||
              ai.value !== original.ai.value ||
              ai.anchorId !== original.ai.anchor.id ||
              !original.ai.citations.some(
                (citation) =>
                  citation.kind === 'source' &&
                  citation.reference.fragmentId === ai.fragmentId &&
                  citation.reference.originalVersionId === ai.originalVersionId,
              )
            )
              conflict();
          } else if (bindings.suggestionId !== null) conflict();

          const scores = [
            ...humanScores,
            ...(original.kind === 'ai_gap' ? [original.ai] : []),
            write.result.score,
          ];
          const anchorRows = await savepoint
            .select()
            .from(anchors)
            .where(
              inArray(
                anchors.id,
                scores.map((score) => score.anchor.id),
              ),
            )
            .orderBy(anchors.id)
            .for('share');
          for (const score of scores) {
            const anchor = anchorRows.find((row) => row.id === score.anchor.id);
            if (
              !anchor ||
              anchor.dimensionId !== review.dimensionId ||
              anchor.ruleVersionId !== event.ruleVersionId ||
              anchor.value !== score.value ||
              anchor.text !== score.anchor.text
            )
              conflict();
          }

          await savepoint.insert(scoreReviewCalibrations).values({
            itemId: review.id,
            originalRevision: review.revision,
            revision: write.result.revision,
            eventId: event.id,
            personId: event.personId,
            evaluationNodeId: write.target.evaluationNodeId,
            dimensionId: review.dimensionId,
            ruleVersionId: event.ruleVersionId,
            actorAccountId: write.accountId,
            actorPersonId: write.actorPersonId,
            confirmedAt: new Date(write.result.score.confirmedAt),
            value: write.result.score.value,
            anchorId: write.result.score.anchor.id,
            ...bindings,
            originalFingerprint: write.originalFingerprint,
            scopeFingerprint: write.scopeFingerprint,
            payload: write.result,
          });
          const changed = await savepoint
            .update(scoreReviews)
            .set({
              status: 'resolved',
              revision: write.result.revision,
            })
            .where(
              and(
                eq(scoreReviews.id, review.id),
                eq(scoreReviews.revision, write.target.revision),
                eq(scoreReviews.status, 'open'),
                isNull(scoreReviews.withdrawnAt),
              ),
            )
            .returning({ id: scoreReviews.id });
          if (changed.length !== 1) conflict();
          await savepoint.insert(scoreReviewOperations).values({
            actorAccountId: write.accountId,
            operationId: write.operationId,
            actorPersonId: write.actorPersonId,
            fingerprint: write.fingerprint,
            scopeFingerprint: write.scopeFingerprint,
            itemId: review.id,
            calibrationRevision: write.result.revision,
            createdAt: new Date(write.result.score.confirmedAt),
          });
          await recordAudit(savepoint, {
            actorId: write.accountId,
            action: 'score_review.calibrate',
            resourceId: review.id,
          });
          // Current effective projection consumes this immutable row separately.
          // Do not insert a third ordinary rater or rewrite original confirmations.
          return reviewCalibrationSchema.parse(write.result);
        }),
      );
    },
  };
}
