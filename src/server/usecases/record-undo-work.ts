import { and, eq, inArray } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import { RECORD_UNDO_WINDOW_MS } from '../../contracts/record';
import { accountBindings } from '../modules/directory';
import {
  evaluationWorkItems,
  type EvaluationWorkItem,
} from '../modules/programs';
import {
  events,
  recordDrafts,
  recordDraftEvents,
  recordSaves,
  recordOperations,
  requireRecordUndoCommit,
  RecordWriteError,
  type RecordUndoCommit,
  type RecordCancelledConfirmationWorkFact,
} from '../modules/records';
import { canEvaluateNode } from '../authz/evaluation-node';
import { loadEvaluationContext } from './evaluation-context';
import { recordAudit } from '../platform/audit';

function conflict(): never {
  throw new RecordWriteError('conflict', 'withdrawn_record_work_changed');
}

/**
 * A cross-domain part of the existing record undo transaction, after
 * commitRecordUndo and before its audit/commit. No request accepts this proof.
 * The records issuer binds it to this Transaction and the actually withdrawn
 * resource. The pre-undo work snapshots fence revisions and assignments.
 */
export async function cancelWithdrawnRecordConfirmationWork(
  tx: Transaction,
  commit: RecordUndoCommit,
  expectedWork: readonly EvaluationWorkItem[],
  clock: { businessNow(): string; wallNow(): string },
): Promise<RecordCancelledConfirmationWorkFact[]> {
  const scope = requireRecordUndoCommit(tx, commit);
  // A second evaluator may withdraw scores without withdrawing the event.
  if (!scope.withdrawnEvents.length) return [];
  const personIds = scope.withdrawnEvents.map((event) => event.personId);
  const expected = expectedWork.filter(
    (item) =>
      item.state === 'pending' &&
      item.kind === 'confirmation' &&
      item.resourceId === scope.draftId &&
      item.evaluationNodeId === scope.evaluationNodeId &&
      personIds.includes(item.personId),
  );
  // The outer record usecase already takes batch/draft -> work -> event locks.
  // Re-lock here in its work order; never start a second transaction.
  const current = await tx
    .select()
    .from(evaluationWorkItems)
    .where(
      and(
        eq(evaluationWorkItems.kind, 'confirmation'),
        eq(evaluationWorkItems.resourceId, scope.draftId),
        eq(evaluationWorkItems.evaluationNodeId, scope.evaluationNodeId),
        inArray(evaluationWorkItems.personId, personIds),
      ),
    )
    .orderBy(evaluationWorkItems.id)
    .for('update');
  if (
    current.some(
      (item) =>
        item.state === 'pending' && !expected.some((old) => old.id === item.id),
    )
  )
    conflict();
  for (const old of expected) {
    const item = current.find((row) => row.id === old.id);
    if (
      !item ||
      item.state !== 'pending' ||
      item.revision !== old.revision ||
      item.personId !== old.personId ||
      item.assignedRelationId !== old.assignedRelationId ||
      item.assignedEvaluatorId !== old.assignedEvaluatorId
    )
      conflict();
  }

  const [binding] = await tx
    .select()
    .from(accountBindings)
    .where(eq(accountBindings.accountId, scope.accountId))
    .for('share');
  const [saved] = await tx
    .select()
    .from(recordSaves)
    .where(eq(recordSaves.saveId, scope.saveId))
    .for('update');
  const [draft] = await tx
    .select()
    .from(recordDrafts)
    .where(eq(recordDrafts.draftId, scope.draftId))
    .for('update');
  const [operation] = await tx
    .select()
    .from(recordOperations)
    .where(
      and(
        eq(recordOperations.actorAccountId, scope.accountId),
        eq(recordOperations.action, 'undo'),
        eq(recordOperations.operationId, scope.operationId),
      ),
    );
  const receipt =
    operation && 'withdrawnEvents' in operation.receipt
      ? operation.receipt
      : null;
  const withdrawnAt = new Date(scope.withdrawnAt).toISOString();
  if (
    !binding ||
    binding.personId !== scope.actorPersonId ||
    !saved ||
    saved.actorAccountId !== scope.accountId ||
    saved.actorPersonId !== scope.actorPersonId ||
    saved.batchId !== scope.batchId ||
    saved.draftId !== scope.draftId ||
    saved.draftSnapshot.evaluationNodeId !== scope.evaluationNodeId ||
    saved.withdrawnAt?.toISOString() !== withdrawnAt ||
    !draft ||
    draft.batchId !== scope.batchId ||
    draft.revision !== scope.draftRevision ||
    draft.draft.evaluationNodeId !== scope.evaluationNodeId ||
    !operation ||
    operation.saveId !== scope.saveId ||
    operation.fingerprint !== scope.fingerprint ||
    operation.createdAt.toISOString() !== withdrawnAt ||
    operation.draftSnapshot.batchId !== scope.batchId ||
    operation.draftSnapshot.draftId !== scope.draftId ||
    operation.draftSnapshot.evaluationNodeId !== scope.evaluationNodeId ||
    !receipt ||
    receipt.withdrawnEvents.length !== scope.withdrawnEvents.length ||
    scope.withdrawnEvents.some(
      (event) =>
        !receipt.withdrawnEvents.some(
          (stored) =>
            stored.eventId === event.eventId &&
            stored.personId === event.personId,
        ),
    ) ||
    saved.createdEventIds.length !== scope.withdrawnEvents.length ||
    scope.withdrawnEvents.some(
      (event) => !saved.createdEventIds.includes(event.eventId),
    )
  )
    conflict();
  const mappings = await tx
    .select()
    .from(recordDraftEvents)
    .where(
      and(
        eq(recordDraftEvents.batchId, scope.batchId),
        eq(recordDraftEvents.draftId, scope.draftId),
        inArray(recordDraftEvents.personId, personIds),
      ),
    );
  const withdrawn = await tx
    .select()
    .from(events)
    .where(
      inArray(
        events.id,
        scope.withdrawnEvents.map((event) => event.eventId),
      ),
    )
    .orderBy(events.id)
    .for('update');
  for (const fact of scope.withdrawnEvents) {
    const event = withdrawn.find((row) => row.id === fact.eventId);
    if (
      !mappings.some(
        (row) => row.personId === fact.personId && row.eventId === fact.eventId,
      ) ||
      !event ||
      event.personId !== fact.personId ||
      event.recorderId !== scope.actorPersonId ||
      event.evaluationNodeId !== scope.evaluationNodeId ||
      event.withdrawnAt?.toISOString() !== withdrawnAt
    )
      conflict();
  }
  // Time and actor scope are reloaded after every possible lock wait. The outer
  // record command retains its existing authority locks until this tx commits.
  const { context } = await loadEvaluationContext(
    tx,
    scope.accountId,
    clock.businessNow(),
  );
  if (
    context.account.personId !== scope.actorPersonId ||
    personIds.some(
      (personId) => !canEvaluateNode(context, scope.evaluationNodeId, personId),
    )
  )
    throw new RecordWriteError('conflict', 'record_undo_authorization_changed');
  const elapsed = Date.parse(clock.wallNow()) - saved.savedAt.getTime();
  if (
    !Number.isFinite(elapsed) ||
    elapsed < 0 ||
    elapsed >= RECORD_UNDO_WINDOW_MS
  )
    throw new RecordWriteError('conflict', 'undo_window_closed');

  const facts: RecordCancelledConfirmationWorkFact[] = [];
  for (const item of expected) {
    const updated = await tx
      .update(evaluationWorkItems)
      .set({
        state: 'cancelled',
        revision: item.revision + 1,
        updatedAt: context.now,
      })
      .where(
        and(
          eq(evaluationWorkItems.id, item.id),
          eq(evaluationWorkItems.state, 'pending'),
          eq(evaluationWorkItems.revision, item.revision),
          eq(evaluationWorkItems.assignedRelationId, item.assignedRelationId),
          eq(evaluationWorkItems.assignedEvaluatorId, item.assignedEvaluatorId),
          eq(evaluationWorkItems.evaluationNodeId, scope.evaluationNodeId),
          eq(evaluationWorkItems.personId, item.personId),
          eq(evaluationWorkItems.kind, 'confirmation'),
          eq(evaluationWorkItems.resourceId, scope.draftId),
        ),
      )
      .returning();
    if (updated.length !== 1) conflict();
    const actual = updated[0];
    facts.push({
      id: actual.id,
      personId: actual.personId,
      evaluationNodeId: actual.evaluationNodeId,
      assignedRelationId: actual.assignedRelationId,
      assignedEvaluatorId: actual.assignedEvaluatorId,
      cancelledRevision: actual.revision,
    });
    await recordAudit(tx, {
      actorId: scope.accountId,
      action: 'evaluation_work.record_withdrawn',
      resourceId: item.id,
    });
  }
  return facts;
}
