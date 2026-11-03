import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  materialReviewCommandSchema,
  materialReviewResolutionReceiptSchema,
  materialReviewUndoCommandSchema,
  materialReviewUndoReceiptSchema,
  type MaterialReviewUndoReceipt,
} from '../../contracts/material-review';
import type { Transaction } from '../db/client';
import { jobSnapshots } from '../jobs/schema';
import { applyJobCommand, advanceJob, type JobRecord } from '../jobs/state';
import { recordSaves } from '../modules/records';
import { arrangeOperationFingerprint } from '../modules/records/arrange/input-state/bind';
import type { MediaReviewState } from '../modules/records/material-review/read';
import {
  mediaReviewItems,
  mediaReviewOperations,
} from '../modules/records/material-review/schema';
import { recordAudit } from '../platform/audit';
import {
  readAttachmentArrangeMetadata,
  parsedAttachmentArrangeKind,
} from './parsed-attachment-state';

export class AttachmentReviewConflict extends Error {}

async function assertUnconfirmed(tx: Transaction, draftIds: string[]) {
  if (!draftIds.length) return;
  const confirmed = await tx
    .select({ id: recordSaves.saveId })
    .from(recordSaves)
    .where(
      and(
        inArray(recordSaves.draftId, draftIds),
        isNull(recordSaves.withdrawnAt),
      ),
    )
    .limit(1);
  if (confirmed.length)
    throw new AttachmentReviewConflict('dependent_draft_confirmed');
}

/** Native mutation only, not an authorization entry or public action. The caller
 * must take the intake WRITE lock first, load this exact state in this same RC
 * transaction, and check the actor's CURRENT material/node/source authority.
 * There is intentionally no bind->model or unknown-scope authorization here. */
export async function undoAttachmentPersonReviewInTransaction(
  tx: Transaction,
  state: MediaReviewState,
  actor: { accountId: string; personId: string },
  raw: unknown,
  now: Date,
): Promise<{ receipt: MaterialReviewUndoReceipt; replayed: boolean }> {
  const command = materialReviewUndoCommandSchema.parse(raw);
  if (
    command.kind !== 'unknown_person' ||
    state.availability !== 'current' ||
    command.batchId !== state.input.batchId
  )
    throw new AttachmentReviewConflict('review_not_current');
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['material-review', actor.accountId, command.operationId])}, 0))`,
  );
  const [previous] = await tx
    .select()
    .from(mediaReviewOperations)
    .where(
      and(
        eq(mediaReviewOperations.actorAccountId, actor.accountId),
        eq(mediaReviewOperations.operationId, command.operationId),
      ),
    );
  const fingerprint = arrangeOperationFingerprint(command);
  // Current authorization is owned by the caller even on an accepted replay.
  if (previous) {
    if (
      previous.fingerprint !== fingerprint ||
      previous.action !== 'undo' ||
      previous.materialId !== state.material.id ||
      previous.actorPersonId !== actor.personId
    )
      throw new AttachmentReviewConflict('review_operation_changed');
    const receipt = materialReviewUndoReceiptSchema.parse(previous.receipt);
    await assertUnconfirmed(tx, receipt.invalidatedDraftIds);
    return { receipt, replayed: true };
  }
  const item = state.items.find((row) => row.id === command.itemId);
  const operation = state.operations.find(
    (row) => row.id === item?.currentOperationId,
  );
  const accepted = materialReviewCommandSchema.safeParse(operation?.command);
  const oldReceipt = materialReviewResolutionReceiptSchema.safeParse(
    operation?.receipt,
  );
  if (
    !item ||
    item.kind !== 'unknown_person' ||
    item.state !== 'resolved' ||
    item.revision !== command.expectedRevision ||
    !operation ||
    operation.action !== 'resolve' ||
    operation.sourceOperationId !== null ||
    operation.fingerprint !== arrangeOperationFingerprint(operation.command) ||
    operation.itemId !== item.id ||
    operation.materialId !== state.material.id ||
    !accepted.success ||
    !oldReceipt.success ||
    accepted.data.kind !== 'unknown_person' ||
    oldReceipt.data.kind !== 'unknown_person' ||
    accepted.data.operationId !== operation.operationId ||
    accepted.data.batchId !== state.input.batchId ||
    accepted.data.itemId !== item.id ||
    accepted.data.expectedRevision + 1 !== item.revision ||
    oldReceipt.data.itemId !== item.id ||
    oldReceipt.data.materialId !== state.material.id ||
    oldReceipt.data.batchId !== state.input.batchId ||
    oldReceipt.data.revision !== item.revision ||
    arrangeOperationFingerprint(oldReceipt.data.resolution) !==
      arrangeOperationFingerprint(accepted.data.resolution) ||
    operation.changes.length !== 1 ||
    operation.changes[0]!.itemId !== item.id ||
    operation.changes[0]!.previousRevision !== accepted.data.expectedRevision ||
    operation.changes[0]!.revision !== item.revision ||
    !['bind_people', 'keep_original_only'].includes(
      accepted.data.resolution.action,
    ) ||
    !state.audits.some(
      (audit) =>
        audit.id === operation.auditId &&
        audit.actorId === operation.actorAccountId &&
        audit.action === 'material.review' &&
        audit.resourceId === state.material.id,
    )
  )
    throw new AttachmentReviewConflict('review_revision_changed');
  const invalidatedDraftIds = [
    ...new Set(
      state.dependencies
        .filter(
          (dep) => dep.operationId === operation.id && dep.itemId === item.id,
        )
        .map((dep) => dep.draftId),
    ),
  ].sort();
  await assertUnconfirmed(tx, invalidatedDraftIds);
  const rows = await tx
    .select()
    .from(jobSnapshots)
    .where(
      and(
        eq(jobSnapshots.kind, parsedAttachmentArrangeKind),
        eq(jobSnapshots.resourceId, state.material.id),
        sql`${jobSnapshots.result}->'generation'->>'reviewOperationId' = ${operation.id}`,
      ),
    )
    .for('update');
  for (const row of rows) {
    const job: JobRecord = { ...row, result: row.result ?? null };
    const metadata = readAttachmentArrangeMetadata(job);
    if (
      !metadata ||
      metadata.generation.parentInputId !== state.input.id ||
      metadata.generation.parentInputVersion !== state.input.inputVersion ||
      metadata.generation.reviewItemId !== item.id ||
      metadata.generation.itemRevision !== item.revision ||
      job.status === 'completed'
    )
      throw new AttachmentReviewConflict('review_generation_changed');
    if (job.status === 'cancelled') continue;
    const cancelled = applyJobCommand(
      job,
      { action: 'cancel', expectedRevision: job.revision },
      now.toISOString(),
    );
    const terminal = advanceJob(
      cancelled,
      {
        attempt: cancelled.attempt,
        expectedRevision: cancelled.revision,
        status: 'cancelled',
      },
      now.toISOString(),
    );
    await tx
      .update(jobSnapshots)
      .set(terminal)
      .where(eq(jobSnapshots.jobId, job.jobId));
  }
  const auditId = await recordAudit(tx, {
    actorId: actor.accountId,
    action: 'material.review.undo',
    resourceId: state.material.id,
  });
  const receipt = materialReviewUndoReceiptSchema.parse({
    previousRevision: item.revision,
    item: { ...item.question, revision: item.revision + 1, state: 'pending' },
    invalidatedDraftIds,
    auditId,
    resume: null,
  });
  const operationId = randomUUID();
  await tx.insert(mediaReviewOperations).values({
    id: operationId,
    actorAccountId: actor.accountId,
    actorPersonId: actor.personId,
    operationId: command.operationId,
    fingerprint,
    itemId: item.id,
    materialId: state.material.id,
    action: 'undo',
    sourceOperationId: operation.id,
    command,
    receipt,
    changes: [
      {
        itemId: item.id,
        previousRevision: item.revision,
        revision: item.revision + 1,
      },
    ],
    auditId,
    createdAt: now,
  });
  const changed = await tx
    .update(mediaReviewItems)
    .set({
      revision: item.revision + 1,
      state: 'pending',
      currentOperationId: operationId,
    })
    .where(
      and(
        eq(mediaReviewItems.id, item.id),
        eq(mediaReviewItems.revision, item.revision),
      ),
    )
    .returning({ id: mediaReviewItems.id });
  if (changed.length !== 1)
    throw new AttachmentReviewConflict('review_revision_changed');
  // No sourceContext, captured scope, old operation, dependency or draft row is
  // deleted. Historical privacy restrictions remain in the complete graph.
  return { receipt, replayed: false };
}
