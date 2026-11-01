import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
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
// Legacy JSON is parsed without inventing a historical draft revision. Internal
// cancellation facts never enter the strict public receipt projection.
const legacyUndoReceiptSchema = recordUndoReceiptSchema.options[0].omit({
  inputRestoration: true,
  draftRestoration: true,
});
export function readStoredUndoReceipt(value: unknown): UndoReceipt {
  if (typeof value !== 'object' || value === null)
    throw new RecordWriteError('unavailable', 'undo_receipt_invalid');
  const { cancelledConfirmationWork: _facts, ...publicValue } = value as Record<
    string,
    unknown
  >;
  void _facts;
  const normalized = {
    ...publicValue,
    draftRestoration:
      'draftRestoration' in publicValue
        ? publicValue.draftRestoration
        : { status: 'refresh_required' },
  };
  if (!('inputRestoration' in publicValue)) {
    const { draftRestoration: _restoration, ...legacy } = publicValue;
    void _restoration;
    const old = legacyUndoReceiptSchema.parse(legacy);
    return recordUndoReceiptSchema.parse({
      ...old,
      draftRestoration: normalized.draftRestoration,
      inputRestoration: 'unavailable',
      originalInput: null,
    });
  }
  const receipt = recordUndoReceiptSchema.parse(normalized);
  return { ...receipt, inputRestoration: 'unavailable', originalInput: null };
}
const cancelledWorkSchema = z
  .array(
    z.strictObject({
      id: z.string().min(1),
      personId: z.string().min(1),
      evaluationNodeId: z.string().min(1),
      assignedRelationId: z.string().min(1),
      assignedEvaluatorId: z.string().min(1),
      cancelledRevision: z.number().int().positive(),
    }),
  )
  .refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length);
export type RecordCancelledConfirmationWorkFact = z.infer<
  typeof cancelledWorkSchema
>[number];
export interface RecordResaveState {
  saveId: string;
  draftRevision: number;
  withdrawnEvents: { personId: string; eventId: string }[];
  cancelledConfirmationWork: RecordCancelledConfirmationWorkFact[];
}
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

/** Issued only after this transaction has written the real undo ledger.
 * The opaque token never leaves the server or works with another transaction. */
declare const recordUndoCommitBrand: unique symbol;
export interface RecordUndoCommit {
  readonly [recordUndoCommitBrand]: true;
}
interface RecordUndoCommitScope {
  accountId: string;
  actorPersonId: string;
  saveId: string;
  operationId: string;
  fingerprint: string;
  batchId: string;
  draftId: string;
  evaluationNodeId: string;
  draftRevision: number;
  withdrawnAt: string;
  withdrawnEvents: { personId: string; eventId: string }[];
}
const undoCommits = new WeakMap<
  RecordUndoCommit,
  { transaction: Transaction; scope: RecordUndoCommitScope }
>();
export function requireRecordUndoCommit(
  tx: Transaction,
  commit: RecordUndoCommit,
): Readonly<RecordUndoCommitScope> {
  const issued = undoCommits.get(commit);
  if (!issued || issued.transaction !== tx)
    throw new RecordWriteError('conflict', 'record_undo_commit_required');
  return structuredClone(issued.scope);
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

/** Internal generation=revise persistence only. The caller revalidates current
 * source authority and the job attempt/revision/cancellation in this transaction.
 * This is not a user action or an authorization grant. */
export async function reviseTrustedRecordDraftBatch(
  tx: Transaction,
  value: {
    expectedBatchRevision: number;
    expectedDrafts: { draftId: string; revision: number }[];
    draftSet: RecordBatchDraftSet;
  },
) {
  const set = recordBatchDraftSetSchema.parse(value.draftSet);
  const conflict = (reason: string): never => {
    throw new RecordWriteError('conflict', reason);
  };
  const expected = new Map(
    value.expectedDrafts.map((row) => [row.draftId, row.revision]),
  );
  if (
    !Number.isSafeInteger(value.expectedBatchRevision) ||
    value.expectedBatchRevision < 1 ||
    expected.size !== value.expectedDrafts.length ||
    value.expectedDrafts.some(
      (row) => !Number.isSafeInteger(row.revision) || row.revision < 1,
    ) ||
    set.revision !== value.expectedBatchRevision + 1
  )
    conflict('batch_revision_changed');
  // Match save/undo's batch -> all draft rows lock order.
  const [batch] = await tx
    .select()
    .from(recordDraftBatches)
    .where(eq(recordDraftBatches.batchId, set.batchId))
    .for('update');
  if (!batch) throw new RecordWriteError('not_found', 'draft_batch_missing');
  if (batch.revision !== value.expectedBatchRevision)
    conflict('batch_revision_changed');
  const rows = await tx
    .select()
    .from(recordDrafts)
    .where(eq(recordDrafts.batchId, set.batchId))
    .orderBy(recordDrafts.draftId)
    .for('update');
  if (
    rows.length !== expected.size ||
    rows.length !== set.drafts.length ||
    rows.some(
      (row) =>
        expected.get(row.draftId) !== row.revision ||
        !set.drafts.some((next) => next.draftId === row.draftId),
    )
  )
    conflict('draft_revision_changed');
  const saved = await tx
    .select({ id: recordSaves.saveId })
    .from(recordSaves)
    .where(eq(recordSaves.batchId, set.batchId))
    .limit(1);
  const mapped = await tx
    .select({ id: recordDraftEvents.eventId })
    .from(recordDraftEvents)
    .where(eq(recordDraftEvents.batchId, set.batchId))
    .limit(1);
  if (saved.length || mapped.length) conflict('human_confirmation_exists');
  const current = recordBatchDraftSetSchema.parse({
    batchId: batch.batchId,
    revision: batch.revision,
    duplicateCandidates: batch.duplicateCandidates,
    drafts: rows.map((row) => row.draft),
  });
  for (const next of set.drafts) {
    const previous = current.drafts.find(
      (draft) => draft.draftId === next.draftId,
    )!;
    if (previous.revision !== expected.get(previous.draftId))
      conflict('draft_revision_changed');
    if (
      previous.evaluationNodeId !== next.evaluationNodeId ||
      previous.projectId !== next.projectId ||
      previous.origin !== next.origin ||
      previous.dimensionVersionId !== next.dimensionVersionId ||
      previous.anchorVersionId !== next.anchorVersionId ||
      previous.sourceReferences.some(
        (reference) =>
          !next.sourceReferences.some((candidate) =>
            isDeepStrictEqual(reference, candidate),
          ),
      )
    )
      conflict('draft_identity_changed');
    const { revision: previousRevision, ...previousBody } = previous;
    const { revision: nextRevision, ...nextBody } = next;
    const changed = !isDeepStrictEqual(previousBody, nextBody);
    if (nextRevision !== previousRevision + (changed ? 1 : 0))
      conflict('draft_revision_changed');
  }
  // Validate the whole set before any mutation. Never update original input,
  // creation binding, source date, model identity or confirmation history.
  for (const next of set.drafts) {
    await tx
      .update(recordDrafts)
      .set({ draft: next, revision: next.revision })
      .where(
        and(
          eq(recordDrafts.draftId, next.draftId),
          eq(recordDrafts.batchId, set.batchId),
        ),
      );
  }
  await tx
    .update(recordDraftBatches)
    .set({
      revision: set.revision,
      duplicateCandidates: set.duplicateCandidates,
    })
    .where(eq(recordDraftBatches.batchId, set.batchId));
  return set;
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
              receipt: readStoredUndoReceipt(row.receipt),
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
  const resave = await readRecordResaveState(tx, lock);
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
      const previous = resave?.withdrawnEvents.find(
        (row) => row.personId === mapping.personId,
      );
      if (previous) {
        const replaced = await tx
          .update(recordDraftEvents)
          .set({ eventId: mapping.eventId })
          .where(
            and(
              eq(recordDraftEvents.batchId, lock.batchId),
              eq(recordDraftEvents.draftId, lock.draftId),
              eq(recordDraftEvents.personId, mapping.personId),
              eq(recordDraftEvents.eventId, previous.eventId),
            ),
          )
          .returning({ eventId: recordDraftEvents.eventId });
        if (replaced.length !== 1)
          throw new RecordWriteError('conflict', 'withdrawn_mapping_changed');
      } else {
        await tx
          .insert(recordDraftEvents)
          .values({ batchId: lock.batchId, draftId: lock.draftId, ...mapping });
      }
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
        eq(recordSaves.batchId, lock.batchId),
        eq(recordSaves.draftId, lock.draftId),
        isNull(recordSaves.withdrawnAt),
      ),
    )
    .returning();
  if (changed.length !== 1)
    throw new RecordWriteError('conflict', 'save_already_withdrawn');
  const saved = changed[0];
  const ids = plan.receipt.withdrawnEvents.map((row) => row.eventId);
  if (
    input.saveId !== saved.saveId ||
    plan.draft.batchId !== saved.batchId ||
    plan.draft.draftId !== saved.draftId ||
    plan.draft.evaluationNodeId !== saved.draftSnapshot.evaluationNodeId ||
    ids.length !== saved.createdEventIds.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !saved.createdEventIds.includes(id)) ||
    plan.receipt.withdrawnEvents.some(
      (row) =>
        !saved.receipt.events.some(
          (event) =>
            event.eventId === row.eventId && event.personId === row.personId,
        ),
    )
  )
    throw new RecordWriteError('conflict', 'withdrawn_resource_changed');
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
  const receipt = recordUndoReceiptSchema.parse({
    ...plan.receipt,
    draftRestoration: {
      status: 'available',
      draftId: lock.draftId,
      draftRevision: plan.expectedDraftRevision + 1,
    },
    inputRestoration: 'unavailable',
    originalInput: null,
  });
  await tx.insert(recordOperations).values({
    actorAccountId: lock.accountId,
    action: 'undo',
    operationId: input.operation_id,
    fingerprint,
    saveId: plan.receipt.saveId,
    draftSnapshot: plan.draft,
    receipt,
    createdAt: new Date(wallNow),
  });

  const commit = Object.freeze({}) as RecordUndoCommit;
  undoCommits.set(commit, {
    transaction: tx,
    scope: {
      accountId: lock.accountId,
      actorPersonId,
      saveId: saved.saveId,
      operationId: input.operation_id,
      fingerprint,
      batchId: saved.batchId,
      draftId: saved.draftId,
      evaluationNodeId: saved.draftSnapshot.evaluationNodeId,
      draftRevision: plan.expectedDraftRevision + 1,
      withdrawnAt: wallNow,
      withdrawnEvents: structuredClone(plan.receipt.withdrawnEvents),
    },
  });
  return commit;
}

/** The record usecase calls this only after its real cancellation CAS results,
 * including completed-to-cancelled work, are collected in the same transaction.
 * It is not an action, work cancellation command or permission to restore work.
 * Its issuer proof limits it to the fresh undo; replay cannot edit old ledgers. */
export async function recordUndoCancellationFacts(
  tx: Transaction,
  commit: RecordUndoCommit,
  cancelled: readonly RecordCancelledConfirmationWorkFact[],
): Promise<UndoReceipt> {
  const scope = requireRecordUndoCommit(tx, commit);
  const facts = cancelledWorkSchema.parse(cancelled);
  if (
    facts.some(
      (fact) =>
        fact.evaluationNodeId !== scope.evaluationNodeId ||
        !scope.withdrawnEvents.some(
          (event) => event.personId === fact.personId,
        ),
    )
  )
    throw new RecordWriteError('conflict', 'cancelled_work_scope_changed');
  const [operation] = await tx
    .select()
    .from(recordOperations)
    .where(
      and(
        eq(recordOperations.actorAccountId, scope.accountId),
        eq(recordOperations.action, 'undo'),
        eq(recordOperations.operationId, scope.operationId),
      ),
    )
    .for('update');
  if (
    !operation ||
    operation.saveId !== scope.saveId ||
    operation.fingerprint !== scope.fingerprint ||
    operation.createdAt.toISOString() !==
      new Date(scope.withdrawnAt).toISOString() ||
    'cancelledConfirmationWork' in operation.receipt
  )
    throw new RecordWriteError(
      'conflict',
      'undo_cancellation_already_recorded',
    );
  const receipt = readStoredUndoReceipt(operation.receipt);
  if (
    receipt.saveId !== scope.saveId ||
    receipt.draftRestoration.status !== 'available' ||
    receipt.draftRestoration.draftId !== scope.draftId ||
    receipt.draftRestoration.draftRevision !== scope.draftRevision ||
    !isDeepStrictEqual(receipt.withdrawnEvents, scope.withdrawnEvents)
  )
    throw new RecordWriteError('conflict', 'undo_ledger_changed');
  await tx
    .update(recordOperations)
    .set({
      receipt: { ...receipt, cancelledConfirmationWork: facts },
    })
    .where(
      and(
        eq(recordOperations.actorAccountId, scope.accountId),
        eq(recordOperations.action, 'undo'),
        eq(recordOperations.operationId, scope.operationId),
      ),
    );
  return receipt;
}

/** Read under lockRecordCommand's batch/draft locks. This verifies ONLY records
 * facts; the usecase must compare every cancelled-work fact with locked current
 * programs rows and reauthorize all actors/sources before planning a new save.
 * No legacy inference, work state mutation or historical event revival occurs. */
export async function readRecordResaveState(
  tx: Transaction,
  lock: RecordSaveLock,
): Promise<RecordResaveState | null> {
  const [draft] = await tx
    .select()
    .from(recordDrafts)
    .where(
      and(
        eq(recordDrafts.draftId, lock.draftId),
        eq(recordDrafts.batchId, lock.batchId),
      ),
    );
  if (!draft) return null;
  const mappings = await tx
    .select()
    .from(recordDraftEvents)
    .where(
      and(
        eq(recordDraftEvents.batchId, lock.batchId),
        eq(recordDraftEvents.draftId, lock.draftId),
      ),
    );
  if (!mappings.length) return null;
  const oldEvents = await tx
    .select()
    .from(events)
    .where(
      inArray(
        events.id,
        mappings.map((row) => row.eventId),
      ),
    );
  if (
    oldEvents.length !== mappings.length ||
    oldEvents.some((event) => !event.withdrawnAt)
  )
    return null;
  const saves = await tx
    .select()
    .from(recordSaves)
    .where(
      and(
        eq(recordSaves.batchId, lock.batchId),
        eq(recordSaves.draftId, lock.draftId),
      ),
    );
  const saved = saves.find(
    (row) =>
      row.withdrawnAt &&
      row.createdEventIds.length === mappings.length &&
      mappings.every(
        (mapping) =>
          row.createdEventIds.includes(mapping.eventId) &&
          row.receipt.events.some(
            (event) =>
              event.eventId === mapping.eventId &&
              event.personId === mapping.personId,
          ),
      ),
  );
  if (!saved?.withdrawnAt) return null;
  if (
    oldEvents.some(
      (event) =>
        event.recorderId !== saved.actorPersonId ||
        event.evaluationNodeId !== draft.draft.evaluationNodeId ||
        event.withdrawnAt?.getTime() !== saved.withdrawnAt?.getTime() ||
        !mappings.some(
          (mapping) =>
            mapping.eventId === event.id && mapping.personId === event.personId,
        ),
    )
  )
    return null;
  const operations = await tx
    .select()
    .from(recordOperations)
    .where(
      and(
        eq(recordOperations.saveId, saved.saveId),
        eq(recordOperations.action, 'undo'),
        eq(recordOperations.actorAccountId, saved.actorAccountId),
      ),
    );
  if (operations.length !== 1) return null;
  const operation = operations[0];
  if (
    !('cancelledConfirmationWork' in operation.receipt) ||
    operation.createdAt.getTime() !== saved.withdrawnAt.getTime() ||
    operation.draftSnapshot.draftId !== draft.draftId ||
    operation.draftSnapshot.batchId !== lock.batchId ||
    operation.draftSnapshot.evaluationNodeId !== draft.draft.evaluationNodeId
  )
    return null;
  const receipt = readStoredUndoReceipt(operation.receipt);
  if (
    receipt.saveId !== saved.saveId ||
    receipt.draftRestoration.status !== 'available' ||
    receipt.draftRestoration.draftId !== draft.draftId ||
    receipt.draftRestoration.draftRevision !== draft.revision ||
    receipt.withdrawnEvents.length !== mappings.length ||
    !mappings.every((mapping) =>
      receipt.withdrawnEvents.some(
        (event) =>
          event.eventId === mapping.eventId &&
          event.personId === mapping.personId,
      ),
    )
  )
    return null;
  const facts = cancelledWorkSchema.safeParse(
    operation.receipt.cancelledConfirmationWork,
  );
  if (
    !facts.success ||
    facts.data.some(
      (fact) =>
        fact.evaluationNodeId !== draft.draft.evaluationNodeId ||
        !mappings.some((mapping) => mapping.personId === fact.personId),
    )
  )
    return null;
  return {
    saveId: saved.saveId,
    draftRevision: draft.revision,
    withdrawnEvents: receipt.withdrawnEvents,
    cancelledConfirmationWork: facts.data,
  };
}
