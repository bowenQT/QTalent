import { randomUUID } from 'node:crypto';
import { getTableName, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { DbExecutor } from '../db/client';
import {
  nativeDatabase,
  seedNativeRules,
  seedNativeCase,
  syntheticBatchClient,
  businessAt,
  wallAt,
} from '../../../tests/fixtures/bow-845/native';
import { createRecordArrangeApplication } from './record-arrange-application';
import { ArrangeModelInputBudgetExceeded } from './record-batch-arrange-requests';
import {
  arrangeInputs,
  arrangeOperations,
} from '../modules/records/arrange/input-state/schema';
import { originals, originalVersions, fragments } from '../modules/records';
import { jobSnapshots } from '../jobs/schema';
import { recordArrangeQueue } from '../jobs/record-arrange';
import { auditEvents } from '../platform/audit/schema';

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
  const model = syntheticBatchClient();
  const app = createRecordArrangeApplication({
    db: connection.db,
    boss,
    client: model.client,
    businessNow: () => businessAt,
    now: () => new Date(wallAt),
  });
  return { ...facts, ...model, app };
}

// Inspect every application table and the real producer queue, not a fake
// enqueue counter. pg-boss maintenance tables are outside the intake effects.
async function rowCounts(db: DbExecutor = connection.db) {
  const tables = await db.execute<{ tablename: string }>(sql`
    select tablename from pg_catalog.pg_tables
    where schemaname = 'public' order by tablename
  `);
  const counts: Record<string, number> = {};
  for (const { tablename } of tables.rows) {
    const result = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier('public')}.${sql.identifier(tablename)}`,
    );
    counts[tablename] = result.rows[0]!.n;
  }
  const queued = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from pgboss.job`,
  );
  counts['pgboss.job'] = queued.rows[0]!.n;
  return counts;
}

function expectIntakeDelta(
  before: Record<string, number>,
  after: Record<string, number>,
  staged: number,
  completed: number,
) {
  const expected = { ...before };
  for (const table of [
    originals,
    originalVersions,
    fragments,
    jobSnapshots,
    arrangeInputs,
  ]) {
    const name = getTableName(table);
    expected[name] += staged;
  }
  for (const table of [arrangeOperations, auditEvents]) {
    const name = getTableName(table);
    expected[name] += completed;
  }
  expected['pgboss.job'] += completed;
  expect(after).toEqual(expected);
}

it('keeps intake facts and the real queue in the caller transaction and rolls all of them back on outer failure', async () => {
  const h = await setup();
  const before = await rowCounts();
  const failure = new Error('synthetic caller failure after native intake');
  await expect(
    connection.db.transaction(async (tx) => {
      const created = await h.app.requests.createInTransaction(
        tx,
        h.account,
        h.input,
      );
      expect(created).toMatchObject({ status: 'success', replayed: false });
      expectIntakeDelta(before, await rowCounts(tx), 1, 1);
      expect(await rowCounts()).toEqual(before);
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(await rowCounts()).toEqual(before);
  expect(h.calls()).toBe(0);
});

it.each([
  ['quotes', '"'],
  ['backslashes', '\\'],
  ['newlines', '\n'],
])(
  'throws encoded %s overflow out of the whole transaction, rolling back even an earlier queued intake',
  async (_label, character) => {
    const h = await setup();
    const text = '演示：' + character.repeat(100000);
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(240000);
    const before = await rowCounts();
    await expect(
      connection.db.transaction(async (tx) => {
        const accepted = await h.app.requests.createInTransaction(
          tx,
          h.account,
          h.input,
        );
        expect(accepted).toMatchObject({ status: 'success', replayed: false });
        expectIntakeDelta(before, await rowCounts(tx), 1, 1);
        try {
          await h.app.requests.createInTransaction(tx, h.account, {
            ...h.input,
            operationId: randomUUID(),
            text,
          });
        } catch (error) {
          // Budget validation runs against the staged real source, job and
          // input. It must not return validation_error and permit a commit.
          expect(error).toBeInstanceOf(ArrangeModelInputBudgetExceeded);
          expectIntakeDelta(before, await rowCounts(tx), 2, 1);
          expect(await rowCounts()).toEqual(before);
          throw error;
        }
      }),
    ).rejects.toBeInstanceOf(ArrangeModelInputBudgetExceeded);
    expect(await rowCounts()).toEqual(before);
    // The legacy public boundary alone maps the error after its rollback.
    expect(
      await h.app.requests.create(h.account, { ...h.input, text }),
    ).toMatchObject({
      status: 'validation_error',
      fieldErrors: { text: [expect.any(String)] },
      input: { text },
    });
    expect(await rowCounts()).toEqual(before);
    expect(h.calls()).toBe(0);
  },
);

it('replays one legal intake inside and after commit without another source, audit or queue row', async () => {
  const h = await setup();
  const before = await rowCounts();
  const created = await connection.db.transaction(async (tx) => {
    const first = await h.app.requests.createInTransaction(
      tx,
      h.account,
      h.input,
    );
    expect(first.status).toBe('success');
    if (first.status !== 'success') throw new Error('native intake required');
    const replay = await h.app.requests.createInTransaction(
      tx,
      h.account,
      h.input,
    );
    expect(replay).toEqual({ ...first, replayed: true });
    expectIntakeDelta(before, await rowCounts(tx), 1, 1);
    expect(await rowCounts()).toEqual(before);
    return first;
  });
  const committed = await rowCounts();
  expectIntakeDelta(before, committed, 1, 1);
  expect(await h.app.requests.create(h.account, h.input)).toEqual({
    ...created,
    replayed: true,
  });
  expect(
    await connection.db.transaction((tx) =>
      h.app.requests.createInTransaction(tx, h.account, {
        ...h.input,
        text: h.text + '演示变更',
      }),
    ),
  ).toMatchObject({ status: 'conflict' });
  expect(await rowCounts()).toEqual(committed);
  expect(h.calls()).toBe(0);
});
