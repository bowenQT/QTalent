import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq } from 'drizzle-orm';
import { createDatabase } from '../../db/client';
import { events } from './schema';
import {
  recordDrafts,
  recordDraftEvents,
  recordSaves,
  recordOperations,
} from './save-state/schema';
import {
  lockRecordCommand,
  commitRecordUndo,
  commitRecordSave,
  recordUndoCancellationFacts,
  readRecordResaveState,
  readRecordConfirmationState,
  readStoredUndoReceipt,
  requireRecordUndoCommit,
  type RecordUndoCommit,
} from './write';
import {
  insertEvaluationWorkItem,
  undoEvaluationWorkCompletion,
  evaluationWorkItems,
} from '../programs';
import { loadEvaluationContext } from '../../usecases/evaluation-context';
import { saveRecordDraft } from '../../usecases/record-save';
import {
  seedRecordCase,
  seedRecordRules,
} from '../../../../tests/fixtures/bow-846/native';
import type { Transaction } from '../../db/client';
let admin: Pool;
let connection: ReturnType<typeof createDatabase>;
const name = 'qtalent_resave_' + randomUUID().replaceAll('-', '') + '_test';
beforeAll(async () => {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) throw new Error('Real isolated TEST_DATABASE_URL required');
  const url = new URL(raw);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test') ||
    url.port === '55432'
  )
    throw new Error('Unsafe test database');
  admin = new Pool({ connectionString: raw });
  await admin.query('CREATE DATABASE "' + name + '"');
  url.pathname = '/' + name;
  connection = createDatabase(url.toString());
  await migrate(connection.db, {
    migrationsFolder: 'src/server/db/migrations',
  });
  await seedRecordRules(connection.db);
});
afterAll(async () => {
  await connection?.pool.end();
  if (admin) {
    await admin.query('DROP DATABASE IF EXISTS "' + name + '"');
    await admin.end();
  }
});

async function savedCase() {
  const f = await seedRecordCase(connection.db);
  const saved = await saveRecordDraft(
    connection.db,
    f.account.one,
    f.input,
    f.clock,
  );
  return { f, saved: saved.result };
}
async function undoLedger(
  h: Awaited<ReturnType<typeof savedCase>>,
  tx: Transaction,
  finalize = true,
) {
  const input = {
    operation_id: h.f.id + '-undo-ledger',
    saveId: h.saved.saveId,
  };
  const lock = await lockRecordCommand(tx, h.f.account.one, {
    action: 'undo',
    input,
  });
  const receipt = {
    saveId: h.saved.saveId,
    withdrawnEvents: h.saved.events,
    withdrawnConfirmationIds: h.saved.confirmationIds,
    withdrawnReviewItemIds: h.saved.reviewItemIds,
    inputRestoration: 'unavailable' as const,
    originalInput: null,
    draftRestoration: {
      status: 'available' as const,
      draftId: h.f.draft.draftId,
      draftRevision: h.saved.revision + 1,
    },
  };
  const proof = await commitRecordUndo(
    tx,
    lock,
    { draft: h.f.draft, expectedDraftRevision: h.saved.revision, receipt },
    input,
    h.f.person['rater-one'],
    'a'.repeat(64),
    h.f.clock.wallNow(),
  );
  if (finalize) await recordUndoCancellationFacts(tx, proof, []);
  return { proof, lock, receipt, input };
}
async function readResave(h: Awaited<ReturnType<typeof savedCase>>) {
  return connection.db.transaction(async (tx) => {
    const lock = await lockRecordCommand(tx, h.f.account.one, {
      action: 'save',
      input: {
        ...h.f.input,
        operation_id: h.f.id + '-resave',
        expected_revision: h.saved.revision + 1,
      },
    });
    return readRecordResaveState(tx, lock);
  });
}
it('persists one exact undo draft revision and exposes no internal cancellation facts', async () => {
  const h = await savedCase();
  await connection.db.transaction(async (tx) => {
    const u = await undoLedger(h, tx);
    const state = await readRecordConfirmationState(tx, u.lock);
    expect(state.draftSet.drafts[0].revision).toBe(h.saved.revision + 1);
    const operation = state.operations.find((row) => row.action === 'undo');
    expect(operation?.receipt).toEqual(u.receipt);
    expect(operation?.receipt).not.toHaveProperty('cancelledConfirmationWork');
    expect(await readRecordResaveState(tx, u.lock)).toEqual({
      saveId: h.saved.saveId,
      draftRevision: h.saved.revision + 1,
      withdrawnEvents: h.saved.events,
      cancelledConfirmationWork: [],
    });
    await expect(recordUndoCancellationFacts(tx, u.proof, [])).rejects.toThrow(
      'undo_cancellation_already_recorded',
    );
  });
});
it('a copied or cross-transaction undo token cannot finalize any historical operation', async () => {
  const h = await savedCase();
  let proof: RecordUndoCommit | undefined;
  await connection.db.transaction(async (tx) => {
    proof = (await undoLedger(h, tx)).proof;
  });
  await connection.db.transaction(async (tx) => {
    expect(() => requireRecordUndoCommit(tx, proof!)).toThrow(
      'record_undo_commit_required',
    );
    await expect(
      recordUndoCancellationFacts(tx, {} as RecordUndoCommit, []),
    ).rejects.toThrow('record_undo_commit_required');
  });
});
it('does not infer restoration for a legacy receipt or missing cancellation provenance', async () => {
  const h = await savedCase();
  await connection.db.transaction((tx) => undoLedger(h, tx, false));
  expect(await readResave(h)).toBeNull();
  const [op] = await connection.db
    .select()
    .from(recordOperations)
    .where(
      and(
        eq(recordOperations.saveId, h.saved.saveId),
        eq(recordOperations.action, 'undo'),
      ),
    );
  const old = structuredClone(op.receipt) as Record<string, unknown>;
  delete old.draftRestoration;
  expect(readStoredUndoReceipt(old)).toMatchObject({
    draftRestoration: { status: 'refresh_required' },
    inputRestoration: 'unavailable',
    originalInput: null,
  });
  expect(old).not.toHaveProperty('draftRestoration');
});
it('rejects foreign cancellation identity without accepting a partial receipt', async () => {
  const h = await savedCase();
  await connection.db.transaction(async (tx) => {
    const u = await undoLedger(h, tx, false);
    await expect(
      recordUndoCancellationFacts(tx, u.proof, [
        {
          id: 'foreign',
          personId: 'foreign',
          evaluationNodeId: h.f.draft.evaluationNodeId,
          assignedRelationId: 'foreign',
          assignedEvaluatorId: h.f.person['rater-one'],
          cancelledRevision: 2,
        },
      ]),
    ).rejects.toThrow('cancelled_work_scope_changed');
    expect(await readRecordResaveState(tx, u.lock)).toBeNull();
  });
});
it('replaces only the current mapping and preserves old event, save and undo history', async () => {
  const h = await savedCase();
  let oldReceipt: unknown;
  await connection.db.transaction(async (tx) => {
    oldReceipt = (await undoLedger(h, tx)).receipt;
  });
  const before = await connection.db
    .select()
    .from(recordSaves)
    .where(eq(recordSaves.saveId, h.saved.saveId));
  const newEvent = h.f.id + '-resaved-event';
  await connection.db.transaction(async (tx) => {
    const input = {
      ...h.f.input,
      operation_id: h.f.id + '-resave',
      expected_revision: h.saved.revision + 1,
    };
    const lock = await lockRecordCommand(tx, h.f.account.one, {
      action: 'save',
      input,
    });
    expect(await readRecordResaveState(tx, lock)).not.toBeNull();
    const receipt = {
      ...h.saved,
      saveId: h.f.id + '-resaved',
      revision: input.expected_revision + 1,
      events: [{ personId: h.saved.events[0].personId, eventId: newEvent }],
      confirmationIds: [],
      reviewItemIds: [],
    };
    await commitRecordSave(
      tx,
      lock,
      {
        draft: { ...h.f.draft, revision: input.expected_revision },
        expectedDraftRevision: input.expected_revision,
        input,
        receipt,
        createdEvents: receipt.events,
      },
      h.f.person['rater-one'],
      'b'.repeat(64),
      [],
    );
    expect(await readRecordResaveState(tx, lock)).toBeNull();
  });
  const maps = await connection.db
    .select()
    .from(recordDraftEvents)
    .where(eq(recordDraftEvents.draftId, h.f.draft.draftId));
  expect(maps[0].eventId).toBe(newEvent);
  const [oldEvent] = await connection.db
    .select()
    .from(events)
    .where(eq(events.id, h.saved.events[0].eventId));
  expect(oldEvent.withdrawnAt).not.toBeNull();
  expect(
    await connection.db
      .select()
      .from(recordSaves)
      .where(eq(recordSaves.saveId, h.saved.saveId)),
  ).toEqual(before);
  const [op] = await connection.db
    .select()
    .from(recordOperations)
    .where(
      and(
        eq(recordOperations.saveId, h.saved.saveId),
        eq(recordOperations.action, 'undo'),
      ),
    );
  expect(readStoredUndoReceipt(op.receipt)).toEqual(oldReceipt);
});
it('a later draft revision is not silently replaced with the old undo revision', async () => {
  const h = await savedCase();
  await connection.db.transaction((tx) => undoLedger(h, tx));
  await connection.db
    .update(recordDrafts)
    .set({ revision: 100, draft: { ...h.f.draft, revision: 100 } })
    .where(eq(recordDrafts.draftId, h.f.draft.draftId));
  expect(await readResave(h)).toBeNull();
});
it('an audit failure after the ledger transaction rolls back withdrawals, revision and operation', async () => {
  const h = await savedCase();
  await expect(
    connection.db.transaction(async (tx) => {
      await undoLedger(h, tx);
      throw new Error('audit failure');
    }),
  ).rejects.toThrow('audit failure');
  const [saved] = await connection.db
    .select()
    .from(recordSaves)
    .where(eq(recordSaves.saveId, h.saved.saveId));
  const [draft] = await connection.db
    .select()
    .from(recordDrafts)
    .where(eq(recordDrafts.draftId, h.f.draft.draftId));
  expect(saved.withdrawnAt).toBeNull();
  expect(draft.revision).toBe(h.saved.revision);
  expect(
    await connection.db
      .select()
      .from(recordOperations)
      .where(
        and(
          eq(recordOperations.saveId, h.saved.saveId),
          eq(recordOperations.action, 'undo'),
        ),
      ),
  ).toHaveLength(0);
});

it('stores exact real cancellation CAS output and leaves cancelled work unchanged on reading', async () => {
  const f = await seedRecordCase(connection.db);
  const task = await connection.db.transaction((tx) =>
    insertEvaluationWorkItem(
      tx,
      {
        id: f.id + '-task',
        kind: 'confirmation',
        resourceId: f.draft.draftId,
        evaluationNodeId: f.node,
        personId: f.person.one,
        assignedRelationId: f.relationOne,
        assignedEvaluatorId: f.person['rater-one'],
      },
      f.clock.businessNow(),
    ),
  );
  const saved = (
    await saveRecordDraft(connection.db, f.account.one, f.input, f.clock)
  ).result;
  await connection.db.transaction(async (tx) => {
    const [completed] = await tx
      .select()
      .from(evaluationWorkItems)
      .where(eq(evaluationWorkItems.id, task.id))
      .for('update');
    const cancelled = await undoEvaluationWorkCompletion(
      tx,
      {
        id: completed.id,
        expectedRevision: completed.revision,
        assignedRelationId: completed.assignedRelationId,
        assignedEvaluatorId: completed.assignedEvaluatorId,
        nextState: 'cancelled',
      },
      async (inner) =>
        (
          await loadEvaluationContext(
            inner,
            f.account.one,
            f.clock.businessNow(),
          )
        ).context,
    );
    const u = await undoLedger({ f, saved }, tx, false);
    const fact = {
      id: cancelled.id,
      personId: cancelled.personId,
      evaluationNodeId: cancelled.evaluationNodeId,
      assignedRelationId: cancelled.assignedRelationId,
      assignedEvaluatorId: cancelled.assignedEvaluatorId,
      cancelledRevision: cancelled.revision,
    };
    const receipt = await recordUndoCancellationFacts(tx, u.proof, [fact]);
    expect(receipt).not.toHaveProperty('cancelledConfirmationWork');
    expect(
      (await readRecordResaveState(tx, u.lock))?.cancelledConfirmationWork,
    ).toEqual([fact]);
    expect(
      (
        await tx
          .select()
          .from(evaluationWorkItems)
          .where(eq(evaluationWorkItems.id, task.id))
      )[0],
    ).toEqual(cancelled);
  });
});
