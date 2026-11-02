import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { MaterialBatchReadResult } from '../../contracts/materials';
import {
  nativeDatabase,
  seedNativeRules,
  seedNativeCase,
  syntheticBatchClient,
  businessAt,
  wallAt,
} from '../../../tests/fixtures/bow-845/native';
import { accountBindings } from '../modules/directory';
import { evaluationRelations } from '../modules/programs';
import { arrangeInputs } from '../modules/records/arrange/input-state/schema';
import { recordArrangeQueue } from '../jobs/record-arrange';
import { createRecordArrangeApplication } from './record-arrange-application';
import { readArrangeJobRecord } from './record-batch-arrange-requests';
import { lockIntakeTable } from './talent-source-projection';
let connection: Awaited<ReturnType<typeof nativeDatabase>>;
let boss: PgBoss;
beforeAll(async () => {
  connection = await nativeDatabase();
  await connection.db.select().from(arrangeInputs).limit(1);
  await seedNativeRules(connection.db);
  boss = new PgBoss({ connectionString: connection.testUrl });
  boss.on('error', () => undefined);
  await boss.start();
  await boss.createQueue(recordArrangeQueue, { retryLimit: 0 });
}, 30000);
afterAll(async () => {
  await boss?.stop();
  await connection?.close();
});
async function setup() {
  const facts = await seedNativeCase(connection.db);
  const model = syntheticBatchClient({ twoEvents: true });
  const app = createRecordArrangeApplication({
    db: connection.db,
    boss,
    client: model.client,
    businessNow: () => businessAt,
    now: () => new Date(wallAt),
  });
  return { ...facts, ...model, app };
}
const notFound = { status: 'not_found', message: '批次不存在或当前不可见' };
it('reads an uncommitted text batch in its caller transaction, hides it outside and preserves rollback', async () => {
  const h = await setup();
  const failure = new Error('synthetic caller rollback');
  let batchId = '';
  await expect(
    connection.db.transaction(async (tx) => {
      const created = await h.app.requests.createInTransaction(
        tx,
        h.account,
        h.input,
      );
      expect(created.status).toBe('success');
      if (created.status !== 'success')
        throw new Error('native intake required');
      batchId = created.result.batchId;
      expect(
        await h.app.requests.readBatchInTransaction(tx, h.account, { batchId }),
      ).toEqual(created);
      // readBatch takes intake SHARE and would wait for this writer, so prove
      // isolation with a plain external SELECT instead.
      expect(
        await connection.db
          .select()
          .from(arrangeInputs)
          .where(eq(arrangeInputs.batchId, batchId)),
      ).toEqual([]);
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(await h.app.requests.readBatch(h.account, { batchId })).toEqual(
    notFound,
  );
  expect(
    await connection.db
      .select()
      .from(arrangeInputs)
      .where(eq(arrangeInputs.batchId, batchId)),
  ).toEqual([]);
  expect(h.calls()).toBe(0);
});
it.each([false, true])(
  'preserves the existing text receipt and wrapper output after commit (unknown person: %s)',
  async (unknownPerson) => {
    const h = await setup();
    const created = await connection.db.transaction(async (tx) => {
      const result = await h.app.requests.createInTransaction(tx, h.account, {
        ...h.input,
        personIds: unknownPerson ? [] : h.input.personIds,
      });
      expect(result.status).toBe('success');
      if (result.status !== 'success')
        throw new Error('native intake required');
      expect(
        await h.app.requests.readBatchInTransaction(tx, h.account, {
          batchId: result.result.batchId,
        }),
      ).toEqual(result);
      return result;
    });
    const raw = { batchId: created.result.batchId };
    expect(created.result.status).toBe(
      unknownPerson ? 'needs_review' : 'processing',
    );
    expect(await h.app.requests.readBatch(h.account, raw)).toEqual(created);
    expect(
      await connection.db.transaction((tx) =>
        h.app.requests.readBatchInTransaction(tx, h.account, raw),
      ),
    ).toEqual(created);
    expect(await h.app.requests.readBatch(h.outsiderAccount, raw)).toEqual(
      notFound,
    );
    expect(h.calls()).toBe(0);
  },
);
it('uses the native draft receipt after processing, without reading or executing a cached receipt', async () => {
  const h = await setup();
  const created = await h.app.requests.create(h.account, h.input);
  if (created.status !== 'success' || !created.result.jobId)
    throw new Error('queued native intake required');
  expect(await h.app.runner.run(created.result.jobId, 1)).toBe(
    'awaiting_manual',
  );
  const raw = { batchId: created.result.batchId };
  const wrapped = await h.app.requests.readBatch(h.account, raw);
  expect(wrapped).toMatchObject({
    status: 'success',
    replayed: false,
    result: {
      status: 'awaiting_confirmation',
      jobId: null,
      counts: { events: { total: 2, awaiting_confirmation: 2, confirmed: 0 } },
    },
  });
  expect(
    await connection.db.transaction((tx) =>
      h.app.requests.readBatchInTransaction(tx, h.account, raw),
    ),
  ).toEqual(wrapped);
  expect(h.calls()).toBe(1);
});
it('sees the caller current account binding, refuses transfer even with a valid new relation, and restores access on rollback', async () => {
  const h = await setup();
  const created = await h.app.requests.create(h.account, h.input);
  if (created.status !== 'success') throw new Error('native intake required');
  const raw = { batchId: created.result.batchId };
  const failure = new Error('synthetic binding rollback');
  await expect(
    connection.db.transaction(async (tx) => {
      await tx.insert(evaluationRelations).values({
        id: h.prefix + '-new-evaluator',
        evaluationNodeId: h.node,
        personId: h.target,
        evaluatorId: h.other,
        kind: 'evaluator',
        validFrom: '2026-01-01T00:00:00Z',
      });
      await tx
        .update(accountBindings)
        .set({ personId: h.other })
        .where(eq(accountBindings.accountId, h.account));
      // The public reader deliberately locks current authority; a plain external
      // SELECT proves isolation without waiting on our uncommitted binding write.
      const [outsideBinding] = await connection.db
        .select()
        .from(accountBindings)
        .where(eq(accountBindings.accountId, h.account));
      expect(outsideBinding?.personId).toBe(h.evaluator);
      expect(
        await h.app.requests.readBatchInTransaction(tx, h.account, raw),
      ).toEqual(notFound);
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(await h.app.requests.readBatch(h.account, raw)).toEqual(created);
  expect(h.calls()).toBe(0);
});
it.each([
  null,
  { batchId: '' },
  { batchId: 'batch', actor: { accountId: 'cached' } },
  { batchId: 'batch', receipt: { status: 'completed' } },
])(
  'retains strict raw input validation without accepting cached authority: %j',
  async (raw) => {
    const h = await setup();
    const expected = {
      status: 'validation_error',
      fieldErrors: { batchId: ['请提供有效批次'] },
      input: raw,
    };
    expect(await h.app.requests.readBatch(h.account, raw)).toEqual(expected);
    expect(
      await connection.db.transaction((tx) =>
        h.app.requests.readBatchInTransaction(tx, h.account, raw),
      ),
    ).toEqual(expected);
    expect(h.calls()).toBe(0);
  },
);
it.each(['superseded', 'moved', 'ambiguous'] as const)(
  'reads the current batch after a proven wait on an intake writer (%s)',
  async (change) => {
    const h = await setup();
    const created = await h.app.requests.create(h.account, h.input);
    const replacement = await h.app.requests.create(h.account, {
      ...h.input,
      operationId: randomUUID(),
    });
    if (
      created.status !== 'success' ||
      replacement.status !== 'success' ||
      !created.result.jobId
    )
      throw new Error('native intakes required');
    const [first] = await connection.db
      .select()
      .from(arrangeInputs)
      .where(eq(arrangeInputs.batchId, created.result.batchId));
    const [next] = await connection.db
      .select()
      .from(arrangeInputs)
      .where(eq(arrangeInputs.batchId, replacement.result.batchId));
    if (!first || !next) throw new Error('native inputs required');
    const raw = { batchId: created.result.batchId };
    let reading: Promise<MaterialBatchReadResult> | undefined;
    let signalReader: (pid: number) => void = () => undefined;
    let rejectReader: (error: unknown) => void = () => undefined;
    const readerReady = new Promise<number>((resolve, reject) => {
      signalReader = resolve;
      rejectReader = reject;
    });
    try {
      await connection.db.transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout = '10s'`);
        const blocker = await tx.execute<{ pid: number }>(
          sql`select pg_backend_pid() as pid`,
        );
        // An intake writer follows the global order: intake lock, then job row.
        await lockIntakeTable(tx, 'locked-for-write');
        expect(
          await readArrangeJobRecord(tx, first.jobId, true),
        ).not.toBeNull();
        reading = connection.db.transaction(
          async (readerTx) => {
            await readerTx.execute(sql`set local statement_timeout = '10s'`);
            const reader = await readerTx.execute<{ pid: number }>(
              sql`select pg_backend_pid() as pid`,
            );
            signalReader(reader.rows[0]!.pid);
            return h.app.requests.readBatchInTransaction(
              readerTx,
              h.account,
              raw,
            );
          },
          { isolationLevel: 'read committed' },
        );
        // Handle startup/query rejection as well as releasing the blocker on any assertion failure.
        void reading.catch(rejectReader);
        const readerPid = await readerReady;
        await expect
          .poll(
            async () => {
              const waiting = await connection.db.execute<{
                blocked: boolean;
              }>(sql`
          select ${blocker.rows[0]!.pid}::int = any(pg_blocking_pids(${readerPid}::int)) as blocked
        `);
              return waiting.rows[0]!.blocked;
            },
            { timeout: 5000 },
          )
          .toBe(true);
        // No sleep-based race: PostgreSQL confirms the reader is blocked by this
        // writer before locating anything, so it must see the committed change.
        if (change === 'superseded') {
          await tx
            .update(arrangeInputs)
            .set({ supersededByInputId: next.id })
            .where(eq(arrangeInputs.id, first.id));
        } else if (change === 'moved') {
          await tx
            .update(arrangeInputs)
            .set({ batchId: randomUUID() })
            .where(eq(arrangeInputs.id, first.id));
        } else {
          await tx
            .update(arrangeInputs)
            .set({ batchId: first.batchId })
            .where(eq(arrangeInputs.id, next.id));
        }
      });
      expect(await reading).toEqual(notFound);
      expect(await h.app.requests.readBatch(h.account, raw)).toEqual(notFound);
    } finally {
      if (reading) await Promise.allSettled([reading]);
    }
    expect(h.calls()).toBe(0);
  },
  20000,
);
it.each(['runner first', 'runner during entry'] as const)(
  'create then read in one entry transaction does not deadlock with a concurrent runner (%s)',
  async (order) => {
    const h = await setup();
    const existing = await h.app.requests.create(h.account, h.input);
    if (existing.status !== 'success' || !existing.result.jobId)
      throw new Error('queued native intake required');
    const jobId = existing.result.jobId;
    const raw = { batchId: existing.result.batchId };
    const pidOf = async (tx: { execute: typeof connection.db.execute }) =>
      (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`))
        .rows[0]!.pid;
    const blockedBy = (waiter: number, holder: number) =>
      expect
        .poll(
          async () =>
            (
              await connection.db.execute<{ blocked: boolean }>(
                sql`select ${holder}::int = any(pg_blocking_pids(${waiter}::int)) as blocked`,
              )
            ).rows[0]!.blocked,
          { timeout: 5000 },
        )
        .toBe(true);
    let releaseRunner: () => void = () => undefined;
    const runnerGate = new Promise<void>((resolve) => {
      releaseRunner = resolve;
    });
    let releaseEntry: () => void = () => undefined;
    const entryGate = new Promise<void>((resolve) => {
      releaseEntry = resolve;
    });
    let runnerPid: (pid: number) => void = () => undefined;
    const runnerStarted = new Promise<number>((resolve) => {
      runnerPid = resolve;
    });
    let entryPid: (pid: number) => void = () => undefined;
    const entryStarted = new Promise<number>((resolve) => {
      entryPid = resolve;
    });
    let entryCreated: () => void = () => undefined;
    const created = new Promise<void>((resolve) => {
      entryCreated = resolve;
    });
    // The runner's own lock path: intake SHARE, then the job row.
    const runner = () =>
      h.app.requests.native.store.locked(jobId, async (locked) => {
        await locked.context.execute(sql`set local statement_timeout = '10s'`);
        runnerPid(await pidOf(locked.context));
        if (order === 'runner first') await runnerGate;
        return locked.record?.jobId ?? null;
      });
    const entry = () =>
      connection.db.transaction(
        async (tx) => {
          await tx.execute(sql`set local statement_timeout = '10s'`);
          entryPid(await pidOf(tx));
          const result = await h.app.requests.createInTransaction(
            tx,
            h.account,
            { ...h.input, operationId: randomUUID() },
          );
          entryCreated();
          if (order === 'runner during entry') await entryGate;
          return {
            created: result,
            read: await h.app.requests.readBatchInTransaction(
              tx,
              h.account,
              raw,
            ),
          };
        },
        { isolationLevel: 'read committed' },
      );
    let running: Promise<string | null> | undefined;
    let entering: ReturnType<typeof entry> | undefined;
    try {
      if (order === 'runner first') {
        running = runner();
        const holder = await runnerStarted;
        entering = entry();
        // The entry waits for the intake writer lock behind the runner.
        await blockedBy(await entryStarted, holder);
        releaseRunner();
      } else {
        entering = entry();
        const holder = await entryStarted;
        await created;
        running = runner();
        // The runner waits for intake SHARE behind the entry's writer lock and
        // has not taken the job row, so the entry's read does not wait on it.
        await expect
          .poll(
            async () =>
              (
                await connection.db.execute<{ blocked: boolean }>(sql`
                  select exists (
                    select 1 from pg_stat_activity
                    where ${holder}::int = any(pg_blocking_pids(pid))
                  ) as blocked`)
              ).rows[0]!.blocked,
            { timeout: 5000 },
          )
          .toBe(true);
        releaseEntry();
      }
      const result = await entering;
      expect(result.created.status).toBe('success');
      expect(result.read).toMatchObject({
        status: 'success',
        result: { batchId: existing.result.batchId },
      });
      expect(await running).toBe(jobId);
      expect(await h.app.requests.readBatch(h.account, raw)).toEqual(
        result.read,
      );
    } finally {
      releaseRunner();
      releaseEntry();
      await Promise.allSettled([running, entering]);
    }
    expect(h.calls()).toBe(0);
  },
  20000,
);
