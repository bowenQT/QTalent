import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import {
  recordBatchDraftSetSchema,
  recordInputSchema,
  recordSaveReceiptSchema,
  recordUndoReceiptSchema,
  type RecordBatchDraft,
  type RecordBatchDraftSet,
  type RecordInput,
  type RecordSaveInput,
  type RecordSaveResult,
  type RecordUndoInput,
  type RecordUndoResult,
} from '../../../contracts/record';
import { events, eventSources, eventParticipants } from './schema';
import {
  recordDraftBatches,
  recordDrafts,
  recordDraftEvents,
  recordSaves,
  recordOperations,
} from './save-state/schema';

type SaveReceipt = Extract<RecordSaveResult, { status: 'success' }>['result'];
type UndoReceipt = Extract<RecordUndoResult, { status: 'success' }>['result'];
export type RecordCommand =
  | { action: 'save'; input: RecordSaveInput }
  | { action: 'undo'; input: RecordUndoInput };
export class RecordWriteError extends Error {
  constructor(
    readonly status: 'conflict' | 'not_found' | 'unavailable',
    readonly reason: string,
  ) {
    super(reason);
  }
}
export interface RecordConfirmationWorkFact {
  id: string;
  assignedRelationId: string;
  assignedEvaluatorId: string;
  completedRevision: number;
}
export interface RecordSaveLock {
  accountId: string;
  batchId: string;
  draftId: string;
  retainedSave: typeof recordSaves.$inferSelect | null;
}

/** Internal trusted-producer entry, never an action accepting client snapshots.
 * The caller owns the transaction and producer/source authorization. */
export async function storeTrustedRecordDraftBatch(
  tx: Transaction,
  value: {
    draftSet: RecordBatchDraftSet;
    originalInput: RecordInput;
    occurredOn: string;
    modelVersion: string;
    createdByAccountId: string;
    createdAt: Date;
  },
) {
  const set = recordBatchDraftSetSchema.parse(value.draftSet);
  recordInputSchema.parse(value.originalInput);
  if (
    !value.modelVersion.trim() ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.occurredOn)
  )
    throw new RecordWriteError(
      'unavailable',
      'trusted_producer_facts_required',
    );
  await tx.insert(recordDraftBatches).values({
    batchId: set.batchId,
    revision: set.revision,
    duplicateCandidates: set.duplicateCandidates,
    originalInput: structuredClone(value.originalInput),
    occurredOn: value.occurredOn,
    modelVersion: value.modelVersion,
    createdByAccountId: value.createdByAccountId,
    createdAt: value.createdAt,
  });
  await tx.insert(recordDrafts).values(
    set.drafts.map((draft) => ({
      draftId: draft.draftId,
      batchId: set.batchId,
      revision: draft.revision,
      draft,
    })),
  );
}

/** Account/operation, batch, then all draft rows. All evaluators and undo use
 * this order. Source/event row locks are acquired by the transaction usecase
 * before reading scoring state, including the second evaluator's writes. */
export async function lockRecordCommand(
  tx: Transaction,
  accountId: string,
  command: RecordCommand,
): Promise<RecordSaveLock> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['record', accountId, command.action, command.input.operation_id])},0))`,
  );
  const [operation] = await tx
    .select()
    .from(recordOperations)
    .where(
      and(
        eq(recordOperations.actorAccountId, accountId),
        eq(recordOperations.action, command.action),
        eq(recordOperations.operationId, command.input.operation_id),
      ),
    );
  const saveId =
    operation?.saveId ??
    (command.action === 'undo' ? command.input.saveId : null);
  const retainedSave = saveId
    ? ((
        await tx
          .select()
          .from(recordSaves)
          .where(eq(recordSaves.saveId, saveId))
      )[0] ?? null)
    : null;
  if (saveId && !retainedSave)
    throw new RecordWriteError('not_found', 'save_not_found');
  const draftId =
    retainedSave?.draftId ??
    (command.action === 'save' ? command.input.draftId : '');
  const [draft] = await tx
    .select()
    .from(recordDrafts)
    .where(eq(recordDrafts.draftId, draftId));
  if (!draft) throw new RecordWriteError('not_found', 'draft_not_found');
  const [batch] = await tx
    .select()
    .from(recordDraftBatches)
    .where(eq(recordDraftBatches.batchId, draft.batchId))
    .for('update');
  if (!batch) throw new RecordWriteError('unavailable', 'draft_batch_missing');
  await tx
    .select()
    .from(recordDrafts)
    .where(eq(recordDrafts.batchId, batch.batchId))
    .orderBy(recordDrafts.draftId)
    .for('update');
  return { accountId, batchId: batch.batchId, draftId, retainedSave };
}

export async function readRecordConfirmationState(
  tx: Transaction,
  lock: RecordSaveLock,
) {
  const [batch] = await tx
    .select()
    .from(recordDraftBatches)
    .where(eq(recordDraftBatches.batchId, lock.batchId));
  if (!batch) throw new RecordWriteError('unavailable', 'draft_batch_missing');
  const drafts = await tx
    .select()
    .from(recordDrafts)
    .where(eq(recordDrafts.batchId, lock.batchId))
    .orderBy(recordDrafts.draftId);
  const parsed = recordBatchDraftSetSchema.safeParse({
    batchId: batch.batchId,
    revision: batch.revision,
    duplicateCandidates: batch.duplicateCandidates,
    drafts: drafts.map((row) => row.draft),
  });
  if (
    !parsed.success ||
    drafts.some((row) => row.draft.revision !== row.revision)
  )
    throw new RecordWriteError('unavailable', 'draft_state_invalid');
  const current = parsed.data.drafts.find(
    (row) => row.draftId === lock.draftId,
  );
  if (!current)
    throw new RecordWriteError('unavailable', 'draft_state_invalid');
  const mappings = await tx
    .select()
    .from(recordDraftEvents)
    .where(eq(recordDraftEvents.batchId, lock.batchId));
  for (const mapping of mappings) {
    const draft = parsed.data.drafts.find(
      (row) => row.draftId === mapping.draftId,
    );
    if (!draft?.personIds.includes(mapping.personId))
      throw new RecordWriteError('unavailable', 'event_mapping_invalid');
  }
  const saves = await tx
    .select()
    .from(recordSaves)
    .where(eq(recordSaves.batchId, lock.batchId));
  const operations = await tx
    .select()
    .from(recordOperations)
    .where(eq(recordOperations.actorAccountId, lock.accountId));
  return {
    batch,
    draftSet: parsed.data,
    projectId: lock.retainedSave
      ? lock.retainedSave.draftSnapshot.projectId
      : current.projectId,
    mappings: mappings.map(({ draftId, personId, eventId }) => ({
      draftId,
      personId,
      eventId,
    })),
    withdrawnDraftIds: saves
      .filter(
        (row) => row.withdrawnAt !== null && row.createdEventIds.length > 0,
      )
      .map((row) => row.draftId),
    saves: saves.map((row) => ({
      receipt: recordSaveReceiptSchema.parse(row.receipt),
      draft: row.draftSnapshot,
      originalInput: structuredClone(row.originalInput),
      createdEventIds: row.createdEventIds,
      withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
    })),
    operations: operations
      .filter((row) => saves.some((saved) => saved.saveId === row.saveId))
      .map((row) => {
        const common = {
          actorAccountId: row.actorAccountId,
          operationId: row.operationId,
          fingerprint: row.fingerprint,
          draft: row.draftSnapshot,
        };
        return row.action === 'save'
          ? {
              ...common,
              action: 'save' as const,
              receipt: recordSaveReceiptSchema.parse(row.receipt),
            }
          : {
              ...common,
              action: 'undo' as const,
              receipt: {
                ...recordUndoReceiptSchema.parse(row.receipt),
                originalInput: structuredClone(
                  (row.receipt as UndoReceipt).originalInput,
                ),
              },
            };
      }),
  };
}

async function advanceDraft(
  tx: Transaction,
  lock: RecordSaveLock,
  expected: number,
) {
  const [row] = await tx
    .select()
    .from(recordDrafts)
    .where(eq(recordDrafts.draftId, lock.draftId));
  if (!row || row.revision !== expected)
    throw new RecordWriteError('conflict', 'draft_revision_changed');
  const updated = await tx
    .update(recordDrafts)
    .set({
      revision: expected + 1,
      draft: { ...row.draft, revision: expected + 1 },
    })
    .where(
      and(
        eq(recordDrafts.draftId, lock.draftId),
        eq(recordDrafts.revision, expected),
      ),
    )
    .returning({ id: recordDrafts.draftId });
  if (updated.length !== 1)
    throw new RecordWriteError('conflict', 'draft_revision_changed');
  await tx
    .update(recordDraftBatches)
    .set({ revision: sql`${recordDraftBatches.revision} + 1` })
    .where(eq(recordDraftBatches.batchId, lock.batchId));
}

export async function commitRecordSave(
  tx: Transaction,
  lock: RecordSaveLock,
  plan: {
    draft: RecordBatchDraft;
    expectedDraftRevision: number;
    input: RecordSaveInput;
    receipt: SaveReceipt;
    createdEvents: { personId: string; eventId: string }[];
  },
  actorPersonId: string,
  fingerprint: string,
  confirmationWork: RecordConfirmationWorkFact[],
) {
  const { batch } = await readRecordConfirmationState(tx, lock);
  await tx.insert(recordSaves).values({
    saveId: plan.receipt.saveId,
    batchId: lock.batchId,
    draftId: lock.draftId,
    actorAccountId: lock.accountId,
    actorPersonId,
    confirmationWork,
    draftSnapshot: plan.draft,
    input: plan.input,
    originalInput: structuredClone(batch.originalInput),
    receipt: plan.receipt,
    createdEventIds: plan.createdEvents.map((row) => row.eventId),
    savedAt: new Date(plan.receipt.savedAt),
  });
  for (const mapping of plan.receipt.events) {
    const created = plan.createdEvents.some(
      (row) => row.eventId === mapping.eventId,
    );
    if (created) {
      await tx.insert(events).values({
        id: mapping.eventId,
        personId: mapping.personId,
        recorderId: actorPersonId,
        evaluationNodeId: plan.draft.evaluationNodeId,
        projectId: plan.input.projectId,
        occurredOn: batch.occurredOn,
        ...plan.input.sbi,
        ruleVersionId: plan.draft.anchorVersionId,
        demo: false,
      });
      await tx.insert(eventSources).values(
        plan.draft.sourceReferences.map((ref) => ({
          eventId: mapping.eventId,
          fragmentId: ref.fragmentId,
          originalVersionId: ref.originalVersionId,
        })),
      );
      const participants = plan.draft.personIds.filter(
        (id) => id !== mapping.personId,
      );
      if (participants.length)
        await tx.insert(eventParticipants).values(
          participants.map((personId) => ({
            eventId: mapping.eventId,
            personId,
          })),
        );
      await tx
        .insert(recordDraftEvents)
        .values({ batchId: lock.batchId, draftId: lock.draftId, ...mapping });
    } else {
      const [event] = await tx
        .select()
        .from(events)
        .where(eq(events.id, mapping.eventId));
      if (
        !event ||
        event.withdrawnAt !== null ||
        event.personId !== mapping.personId ||
        event.evaluationNodeId !== plan.draft.evaluationNodeId ||
        event.projectId !== plan.input.projectId ||
        event.ruleVersionId !== plan.draft.anchorVersionId
      )
        throw new RecordWriteError('unavailable', 'event_identity_invalid');
      if (
        Object.entries(plan.input.sbi).some(
          ([key, value]) => event[key as keyof typeof plan.input.sbi] !== value,
        )
      )
        throw new RecordWriteError('conflict', 'event_content_changed');
    }
  }
  await advanceDraft(tx, lock, plan.expectedDraftRevision);
  await tx.insert(recordOperations).values({
    actorAccountId: lock.accountId,
    action: 'save',
    operationId: plan.input.operation_id,
    fingerprint,
    saveId: plan.receipt.saveId,
    draftSnapshot: plan.draft,
    receipt: plan.receipt,
    createdAt: new Date(plan.receipt.savedAt),
  });
}

export async function commitRecordUndo(
  tx: Transaction,
  lock: RecordSaveLock,
  plan: {
    draft: RecordBatchDraft;
    expectedDraftRevision: number;
    receipt: UndoReceipt;
  },
  input: RecordUndoInput,
  actorPersonId: string,
  fingerprint: string,
  wallNow: string,
) {
  const changed = await tx
    .update(recordSaves)
    .set({ withdrawnAt: new Date(wallNow) })
    .where(
      and(
        eq(recordSaves.saveId, plan.receipt.saveId),
        eq(recordSaves.actorAccountId, lock.accountId),
        eq(recordSaves.actorPersonId, actorPersonId),
        isNull(recordSaves.withdrawnAt),
      ),
    )
    .returning({ id: recordSaves.saveId });
  if (changed.length !== 1)
    throw new RecordWriteError('conflict', 'save_already_withdrawn');
  const ids = plan.receipt.withdrawnEvents.map((row) => row.eventId);
  if (ids.length) {
    const withdrawn = await tx
      .update(events)
      .set({ withdrawnAt: new Date(wallNow) })
      .where(
        and(
          inArray(events.id, ids),
          eq(events.recorderId, actorPersonId),
          isNull(events.withdrawnAt),
        ),
      )
      .returning({ id: events.id });
    if (withdrawn.length !== ids.length)
      throw new RecordWriteError('conflict', 'event_changed');
  }
  await advanceDraft(tx, lock, plan.expectedDraftRevision);
  await tx.insert(recordOperations).values({
    actorAccountId: lock.accountId,
    action: 'undo',
    operationId: input.operation_id,
    fingerprint,
    saveId: plan.receipt.saveId,
    draftSnapshot: plan.draft,
    receipt: plan.receipt,
    createdAt: new Date(wallNow),
  });
}
