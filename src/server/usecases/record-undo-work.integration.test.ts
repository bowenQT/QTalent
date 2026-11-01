import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createDatabase, type Transaction } from '../db/client';
import { accountBindings } from '../modules/directory';
import {
  evaluationRelations,
  evaluationWorkItems,
  insertEvaluationWorkItem,
  type EvaluationWorkItem,
} from '../modules/programs';
import {
  events,
  recordDrafts,
  recordSaves,
  recordOperations,
  commitRecordUndo,
  lockRecordCommand,
  readRecordConfirmationState,
  type RecordUndoCommit,
} from '../modules/records';
import * as audit from '../platform/audit';
import { saveRecordDraft } from './record-save';
import { cancelWithdrawnRecordConfirmationWork } from './record-undo-work';
import {
  seedRecordCase,
  seedRecordRules,
  businessNow,
} from '../../../tests/fixtures/bow-846/native';

let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
const databaseName =
  'qtalent_withdraw_work_' + randomUUID().replaceAll('-', '') + '_test';
const db = () => connection!.db;
type Fixture = Awaited<ReturnType<typeof seedRecordCase>>;
type Saved = Awaited<ReturnType<typeof saveRecordDraft>>;
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source) throw new Error('Real loopback test database required');
  const url = new URL(source);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Isolated loopback _test database required');
  admin = new Pool({ connectionString: source });
  await admin.query('CREATE DATABASE "' + databaseName + '"');
  url.pathname = '/' + databaseName;
  connection = createDatabase(url.toString());
  await migrate(db(), { migrationsFolder: 'src/server/db/migrations' });
  await seedRecordRules(db());
}, 30_000);
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await connection?.pool.end();
  if (admin) {
    await admin.query('DROP DATABASE IF EXISTS "' + databaseName + '"');
    await admin.end();
  }
});

async function task(f: Fixture, change: Partial<EvaluationWorkItem> = {}) {
  return db().transaction((tx) =>
    insertEvaluationWorkItem(
      tx,
      {
        id: f.id + '-pending',
        evaluationNodeId: f.node,
        personId: f.person.one,
        assignedRelationId: f.relationOne,
        assignedEvaluatorId: f.person['rater-one'],
        kind: 'confirmation',
        resourceId: f.draft.draftId,
        ...change,
      },
      businessNow,
    ),
  );
}
async function setup() {
  const f = await seedRecordCase(db(), { secondDraft: true });
  const item = await task(f);
  const saved = await saveRecordDraft(db(), f.account.two, f.input, f.clock);
  return { f, item, saved };
}
async function issue(tx: Transaction, f: Fixture, saved: Saved) {
  const input = {
    operation_id: f.id + '-undo-work',
    saveId: saved.result.saveId,
  };
  const lock = await lockRecordCommand(tx, f.account.two, {
    action: 'undo',
    input,
  });
  // Test the persistence/proof boundary directly; the full save/undo command
  // and its confirmation policy remain covered by the author's native suite.
  return commitRecordUndo(
    tx,
    lock,
    {
      draft: f.draft,
      expectedDraftRevision: saved.result.revision,
      receipt: {
        saveId: saved.result.saveId,
        draftRestoration: {
          status: 'available',
          draftId: f.draft.draftId,
          draftRevision: saved.result.revision + 1,
        },
        withdrawnEvents: saved.result.events.filter((event) =>
          lock.retainedSave!.createdEventIds.includes(event.eventId),
        ),
        withdrawnConfirmationIds: saved.result.confirmationIds,
        withdrawnReviewItemIds: saved.result.reviewItemIds,
        inputRestoration: 'unavailable',
        originalInput: null,
      },
    },
    input,
    f.person['rater-two'],
    'f'.repeat(64),
    f.clock.wallNow(),
  );
}
async function readItem(id: string) {
  const [item] = await db()
    .select()
    .from(evaluationWorkItems)
    .where(eq(evaluationWorkItems.id, id));
  return item;
}
async function expectRolledBack(saved: Saved, item: EvaluationWorkItem) {
  const [row] = await db()
    .select()
    .from(recordSaves)
    .where(eq(recordSaves.saveId, saved.result.saveId));
  expect(row.withdrawnAt).toBeNull();
  expect(await readItem(item.id)).toEqual(item);
}

it('cancels only pending confirmation work for the genuinely withdrawn resource and audits the original actor', async () => {
  const { f, item, saved } = await setup();
  const otherDraft = await task(f, {
    id: f.id + '-other-draft',
    resourceId: f.otherDraft.draftId,
  });
  const otherKind = await task(f, { id: f.id + '-speaker', kind: 'speaker' });
  await db().transaction(
    async (tx) => {
      const proof = await issue(tx, f, saved);
      await cancelWithdrawnRecordConfirmationWork(
        tx,
        proof,
        [item, otherDraft, otherKind],
        f.clock,
      );
    },
    { isolationLevel: 'read committed' },
  );
  expect(await readItem(item.id)).toMatchObject({
    state: 'cancelled',
    revision: item.revision + 1,
    assignedRelationId: item.assignedRelationId,
    assignedEvaluatorId: item.assignedEvaluatorId,
  });
  expect(await readItem(otherDraft.id)).toEqual(otherDraft);
  expect(await readItem(otherKind.id)).toEqual(otherKind);
  const result = await db().execute<{
    actor_id: string;
    resource_id: string;
  }>(sql`select actor_id, resource_id from audit_events
    where action = 'evaluation_work.record_withdrawn' and resource_id = ${item.id}`);
  expect(result.rows).toEqual([
    { actor_id: f.account.two, resource_id: item.id },
  ]);
});
it('rejects a genuine token when used with another transaction', async () => {
  const { f, item, saved } = await setup();
  let proof: RecordUndoCommit | undefined;
  await db().transaction(async (tx) => {
    proof = await issue(tx, f, saved);
  });
  await expect(
    db().transaction((tx) =>
      cancelWithdrawnRecordConfirmationWork(tx, proof!, [item], f.clock),
    ),
  ).rejects.toMatchObject({ reason: 'record_undo_commit_required' });
  expect(await readItem(item.id)).toEqual(item);
});
it('rolls back the source withdrawal, work update and audit together', async () => {
  const { f, item, saved } = await setup();
  vi.spyOn(audit, 'recordAudit').mockRejectedValue(
    new Error('synthetic audit failure'),
  );
  await expect(
    db().transaction(async (tx) => {
      const proof = await issue(tx, f, saved);
      await cancelWithdrawnRecordConfirmationWork(tx, proof, [item], f.clock);
    }),
  ).rejects.toThrow('synthetic audit failure');
  await expectRolledBack(saved, item);
});
it.each(['revision', 'assignment', 'completed'] as const)(
  'does not overwrite %s changes after the original work snapshot',
  async (change) => {
    const { f, item, saved } = await setup();
    await expect(
      db().transaction(async (tx) => {
        const proof = await issue(tx, f, saved);
        await tx
          .update(evaluationWorkItems)
          .set(
            change === 'revision'
              ? { revision: item.revision + 1 }
              : change === 'assignment'
                ? {
                    assignedEvaluatorId: f.person['rater-two'],
                    assignedRelationId: f.relationTwo,
                  }
                : { state: 'completed' },
          )
          .where(eq(evaluationWorkItems.id, item.id));
        await cancelWithdrawnRecordConfirmationWork(tx, proof, [item], f.clock);
      }),
    ).rejects.toMatchObject({ reason: 'withdrawn_record_work_changed' });
    await expectRolledBack(saved, item);
  },
);
it('does not infer a later pending task from an empty pre-undo work snapshot', async () => {
  const { f, item, saved } = await setup();
  await expect(
    db().transaction(async (tx) => {
      const proof = await issue(tx, f, saved);
      await cancelWithdrawnRecordConfirmationWork(tx, proof, [], f.clock);
    }),
  ).rejects.toMatchObject({ reason: 'withdrawn_record_work_changed' });
  await expectRolledBack(saved, item);
});
it('does not cancel an already completed task', async () => {
  const { f, item, saved } = await setup();
  const [completed] = await db()
    .update(evaluationWorkItems)
    .set({ state: 'completed', revision: 2 })
    .where(eq(evaluationWorkItems.id, item.id))
    .returning();
  await db().transaction(async (tx) => {
    const proof = await issue(tx, f, saved);
    await cancelWithdrawnRecordConfirmationWork(
      tx,
      proof,
      [completed],
      f.clock,
    );
  });
  expect(await readItem(item.id)).toEqual(completed);
});
it.each(['account', 'draft', 'event', 'operation'] as const)(
  'rechecks actual %s identity and version facts before touching another evaluator task',
  async (change) => {
    const { f, item, saved } = await setup();
    await expect(
      db().transaction(async (tx) => {
        const proof = await issue(tx, f, saved);
        if (change === 'account')
          await tx
            .update(accountBindings)
            .set({ personId: f.person.outsider })
            .where(eq(accountBindings.accountId, f.account.two));
        if (change === 'draft')
          await tx.execute(
            sql`update ${recordDrafts} set revision=revision+1, draft=jsonb_set(draft,'{revision}',to_jsonb(revision+1)) where draft_id=${f.draft.draftId}`,
          );
        if (change === 'event')
          await tx
            .update(events)
            .set({ withdrawnAt: null })
            .where(eq(events.id, saved.result.events[0].eventId));
        if (change === 'operation')
          await tx
            .delete(recordOperations)
            .where(
              and(
                eq(recordOperations.actorAccountId, f.account.two),
                eq(recordOperations.action, 'undo'),
              ),
            );
        await cancelWithdrawnRecordConfirmationWork(tx, proof, [item], f.clock);
      }),
    ).rejects.toMatchObject({ reason: 'withdrawn_record_work_changed' });
    await expectRolledBack(saved, item);
  },
);
it('rechecks the original actor current node permission', async () => {
  const { f, item, saved } = await setup();
  await expect(
    db().transaction(async (tx) => {
      const proof = await issue(tx, f, saved);
      await tx
        .update(evaluationRelations)
        .set({ validTo: businessNow })
        .where(eq(evaluationRelations.id, f.relationTwo));
      await cancelWithdrawnRecordConfirmationWork(tx, proof, [item], f.clock);
    }),
  ).rejects.toMatchObject({ reason: 'record_undo_authorization_changed' });
  await expectRolledBack(saved, item);
});
it('does not extend the five second undo deadline for the pending-task side effect', async () => {
  const { f, item, saved } = await setup();
  await expect(
    db().transaction(async (tx) => {
      const proof = await issue(tx, f, saved);
      f.setWall(5000);
      await cancelWithdrawnRecordConfirmationWork(tx, proof, [item], f.clock);
    }),
  ).rejects.toMatchObject({ reason: 'undo_window_closed' });
  await expectRolledBack(saved, item);
});
it('does not cancel pending work when a second evaluator only withdraws their scores', async () => {
  const f = await seedRecordCase(db());
  const first = await saveRecordDraft(db(), f.account.one, f.input, f.clock);
  const item = await task(f);
  const saved = await saveRecordDraft(
    db(),
    f.account.two,
    {
      ...f.input,
      operation_id: f.id + '-second',
      expected_revision: first.result.revision,
    },
    f.clock,
  );
  await db().transaction(async (tx) => {
    const proof = await issue(tx, f, saved);
    await cancelWithdrawnRecordConfirmationWork(tx, proof, [item], f.clock);
  });
  expect(await readItem(item.id)).toEqual(item);
});

it.each(['legacy', 'previously_available'] as const)(
  'does not replay %s stored input as current authorization',
  async (mode) => {
    const { f, saved } = await setup();
    await db().transaction(async (tx) => {
      await issue(tx, f, saved);
      const retained = {
        saveId: saved.result.saveId,
        draftRestoration: {
          status: 'available',
          draftId: f.draft.draftId,
          draftRevision: saved.result.revision + 1,
        },
        withdrawnEvents: saved.result.events,
        withdrawnConfirmationIds: saved.result.confirmationIds,
        withdrawnReviewItemIds: saved.result.reviewItemIds,
        originalInput: {
          ...f.originalInput,
          text: '演示旧保留全文',
          attachmentIds: ['demo-private-attachment'],
        },
        ...(mode === 'previously_available'
          ? { inputRestoration: 'available' }
          : {}),
      };
      await tx
        .update(recordOperations)
        .set({ receipt: sql`${JSON.stringify(retained)}::jsonb` })
        .where(
          and(
            eq(recordOperations.actorAccountId, f.account.two),
            eq(recordOperations.action, 'undo'),
          ),
        );
      const lock = await lockRecordCommand(tx, f.account.two, {
        action: 'undo',
        input: {
          operation_id: f.id + '-undo-work',
          saveId: saved.result.saveId,
        },
      });
      const state = await readRecordConfirmationState(tx, lock);
      const operation = state.operations.find((row) => row.action === 'undo');
      expect(operation?.receipt).toMatchObject({
        inputRestoration: 'unavailable',
        originalInput: null,
      });
      expect(JSON.stringify(operation?.receipt)).not.toContain(
        '演示旧保留全文',
      );
      expect(JSON.stringify(operation?.receipt)).not.toContain(
        'demo-private-attachment',
      );
    });
  },
);

it('rechecks a committed revision after a real work-row lock wait and rolls back the withdrawal', async () => {
  const { f, item, saved } = await setup();
  let release!: () => void;
  let locked!: () => void;
  let attempting!: () => void;
  const held = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const started = new Promise<void>((resolve) => {
    attempting = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const blocker = db().transaction(async (tx) => {
    await tx
      .update(evaluationWorkItems)
      .set({ revision: item.revision + 1 })
      .where(eq(evaluationWorkItems.id, item.id));
    locked();
    await gate;
  });
  await held;
  const result = db()
    .transaction(async (tx) => {
      const proof = await issue(tx, f, saved);
      attempting();
      await cancelWithdrawnRecordConfirmationWork(tx, proof, [item], f.clock);
    })
    .then(
      () => null,
      (error) => error as Error & { reason: string },
    );
  try {
    await started;
    let waiting = false;
    for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
      const found = await admin!.query<{ waiting: boolean }>(
        "select exists(select 1 from pg_stat_activity where datname=$1 and wait_event_type='Lock' and query like '%programs_evaluation_work_items%') as waiting",
        [databaseName],
      );
      waiting = found.rows[0].waiting;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
  } finally {
    release();
    await blocker;
  }
  expect(await result).toMatchObject({
    reason: 'withdrawn_record_work_changed',
  });
  expect(await readItem(item.id)).toMatchObject({
    state: 'pending',
    revision: item.revision + 1,
  });
  const [row] = await db()
    .select()
    .from(recordSaves)
    .where(eq(recordSaves.saveId, saved.result.saveId));
  expect(row.withdrawnAt).toBeNull();
});
