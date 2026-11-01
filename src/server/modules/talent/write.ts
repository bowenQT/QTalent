import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import type { RecordUndoResult } from '../../../contracts/record';
import { aiSuggestions, confirmations, scoreReviews } from './schema';
import {
  ConfirmationError,
  type ConfirmationPlan,
} from './record-confirmation';

type SavePlan = Extract<ConfirmationPlan, { action: 'save'; replayed: false }>;
type UndoReceipt = Extract<RecordUndoResult, { status: 'success' }>['result'];

/** Keep original model output and human confirmations in separate native rows.
 * The caller has locked the canonical events and owns the transaction. */
export async function writeRecordConfirmations(
  tx: Transaction,
  plan: SavePlan,
  actorPersonId: string,
  modelVersion: string,
) {
  if (!modelVersion.trim())
    throw new ConfirmationError('unavailable', 'model_version_required');
  for (const event of plan.createdEvents) {
    for (const score of plan.draft.scores.filter(
      (row) => row.personId === event.personId,
    )) {
      const reference =
        score.state === 'suggested'
          ? score.citations[0].reference
          : plan.draft.sourceReferences[0];
      await tx.insert(aiSuggestions).values({
        id: randomUUID(),
        eventId: event.eventId,
        dimensionId: score.dimensionId,
        ruleVersionId: plan.draft.anchorVersionId,
        modelVersion,
        sourceCategory: 'original',
        status: score.state === 'suggested' ? 'scored' : 'unknown',
        value: score.state === 'suggested' ? score.value : null,
        anchorId: score.state === 'suggested' ? score.anchor.id : null,
        fragmentId: reference.fragmentId,
        originalVersionId: reference.originalVersionId,
        rationale:
          score.state === 'suggested'
            ? score.citations.map((citation) => citation.quote).join('\n')
            : score.reason,
      });
    }
  }
  for (const row of plan.confirmations) {
    if (row.evaluatorId !== actorPersonId)
      throw new ConfirmationError('forbidden', 'confirmation_owner_required');
    const matches = await tx
      .select()
      .from(aiSuggestions)
      .where(
        and(
          eq(aiSuggestions.eventId, row.eventId),
          eq(aiSuggestions.dimensionId, row.dimensionId),
          eq(aiSuggestions.ruleVersionId, plan.draft.anchorVersionId),
        ),
      );
    const suggestion = plan.draft.scores.find(
      (score) =>
        score.personId === row.personId &&
        score.dimensionId === row.dimensionId,
    )!;
    const original = matches[0];
    if (
      matches.length !== 1 ||
      original.modelVersion !== modelVersion ||
      original.sourceCategory !== 'original'
    )
      throw new ConfirmationError(
        'unavailable',
        'canonical_suggestion_missing',
      );
    if (
      suggestion.state === 'suggested'
        ? original.status !== 'scored' ||
          original.value !== suggestion.value ||
          original.anchorId !== suggestion.anchor.id
        : original.status !== 'unknown' || original.value !== null
    )
      throw new ConfirmationError('conflict', 'canonical_suggestion_changed');
    const reference =
      suggestion.state === 'suggested'
        ? suggestion.citations[0].reference
        : row.references[0];
    await tx.insert(confirmations).values({
      id: row.id,
      eventId: row.eventId,
      dimensionId: row.dimensionId,
      evaluatorId: actorPersonId,
      modifiedBy: actorPersonId,
      sourceCategory: 'original',
      confirmedAt: new Date(row.confirmedAt),
      ruleVersionId: row.anchorVersionId,
      status: row.value === null ? 'unknown' : 'scored',
      value: row.value,
      anchorId: row.anchor?.id ?? null,
      fragmentId: reference.fragmentId,
      originalVersionId: reference.originalVersionId,
      revision: row.revision,
      active: true,
      reason: row.reason,
      previousId: null,
      previousRevision: null,
      suggestionId: original.id,
    });
  }
  for (const review of plan.reviews) {
    const confirmation = plan.confirmations.find(
      (row) => row.id === review.confirmationId,
    )!;
    await tx.insert(scoreReviews).values({
      id: review.id,
      eventId: confirmation.eventId,
      dimensionId: confirmation.dimensionId,
      reason:
        review.kind === 'ai_gap' ? 'ai_changed_without_reason' : 'score_gap',
      status: 'open',
      saveId: plan.receipt.saveId,
      confirmationId: review.confirmationId,
      counterpartConfirmationId: review.counterpartConfirmationId,
    });
  }
}

/** Deactivate only this accepted save's human rows; never delete evidence or
 * edit the AI snapshot, earlier confirmations, or HR's review history. */
export async function withdrawRecordConfirmations(
  tx: Transaction,
  receipt: UndoReceipt,
  actorPersonId: string,
  at: string,
) {
  if (receipt.withdrawnConfirmationIds.length) {
    const changed = await tx
      .update(confirmations)
      .set({ active: false })
      .where(
        and(
          inArray(confirmations.id, receipt.withdrawnConfirmationIds),
          eq(confirmations.evaluatorId, actorPersonId),
          eq(confirmations.modifiedBy, actorPersonId),
          eq(confirmations.active, true),
        ),
      )
      .returning({ id: confirmations.id });
    if (changed.length !== receipt.withdrawnConfirmationIds.length)
      throw new ConfirmationError('conflict', 'confirmation_changed');
  }
  if (receipt.withdrawnReviewItemIds.length) {
    const changed = await tx
      .update(scoreReviews)
      .set({ withdrawnAt: new Date(at) })
      .where(
        and(
          inArray(scoreReviews.id, receipt.withdrawnReviewItemIds),
          eq(scoreReviews.saveId, receipt.saveId),
          eq(scoreReviews.status, 'open'),
          isNull(scoreReviews.withdrawnAt),
        ),
      )
      .returning({ id: scoreReviews.id });
    if (changed.length !== receipt.withdrawnReviewItemIds.length)
      throw new ConfirmationError('conflict', 'review_changed');
  }
}
