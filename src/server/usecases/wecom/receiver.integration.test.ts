import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createHash, randomUUID } from 'node:crypto';
import { eq, getTableName, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase, type DbExecutor } from '../../db/client';
import {
  nativeDatabase,
  seedNativeRules,
  seedNativeCase,
  syntheticBatchClient,
  businessAt,
  wallAt,
} from '../../../../tests/fixtures/bow-845/native';
import { createRecordArrangeApplication } from '../record-arrange-application';
import { recordArrangeQueue } from '../../jobs/record-arrange';
import { jobSnapshots } from '../../jobs/schema';
import { originals, originalVersions, fragments } from '../../modules/records';
import {
  arrangeInputs,
  arrangeOperations,
} from '../../modules/records/arrange/input-state/schema';
import { evaluationRelations } from '../../modules/programs';
import { auditEvents } from '../../platform/audit/schema';
import { parseWecomFrame } from '../../integrations/wecom/protocol';
import { prepareWecomTextBatch } from './receiver';

let connection: Awaited<ReturnType<typeof nativeDatabase>>;
let boss: PgBoss;
beforeAll(async () => {
  connection = await nativeDatabase();
  if (process.env.BOW_909_TEST_MIGRATIONS_DIR)
    await migrate(connection.db, {
      migrationsFolder: process.env.BOW_909_TEST_MIGRATIONS_DIR,
    });
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
  const makeApp = (db = connection.db) =>
    createRecordArrangeApplication({
      db,
      boss,
      client: model.client,
      businessNow: () => businessAt,
      now: () => new Date(wallAt),
    });
  const messageId = randomUUID();
  function message(
    text = facts.text,
    sender = 'sender-demo',
    ack = 'ack-demo',
  ) {
    const frame = parseWecomFrame(
      JSON.stringify({
        cmd: 'aibot_msg_callback',
        headers: { req_id: ack },
        body: {
          msgid: messageId,
          aibotid: 'bot-demo',
          from: { userid: sender },
          chattype: 'single',
          msgtype: 'text',
          text: { content: text },
        },
      }),
      { scope: 'scope-demo', botId: 'bot-demo' },
    );
    if (frame.kind !== 'message') throw new Error('Synthetic message required');
    return frame.message;
  }
  // These explicit synthetic directory/node facts are not a production WeCom
  // identity mapping. Actual 899/845 authorization still runs against real PG.
  const target = {
    evaluationNodeId: facts.node,
    personIds: [facts.target],
    projectId: facts.input.projectId,
  };
  function prepared(
    text = facts.text,
    sender = 'sender-demo',
    ack = 'ack-demo',
  ) {
    const plan = prepareWecomTextBatch(message(text, sender, ack), target);
    if (plan.status !== 'ready')
      throw new Error('Synthetic text plan required');
    return plan.input;
  }
  return {
    ...facts,
    ...model,
    makeApp,
    app: makeApp(),
    message,
    target,
    prepared,
  };
}
async function counts(db: DbExecutor = connection.db) {
  const rows: number[] = [];
  for (const table of [
    originals,
    originalVersions,
    fragments,
    arrangeInputs,
    arrangeOperations,
    jobSnapshots,
    auditEvents,
  ]) {
    const result = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(getTableName(table))}`,
    );
    rows.push(result.rows[0]!.n);
  }
  const jobs = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from pgboss.job where name = ${recordArrangeQueue}`,
  );
  return [...rows, jobs.rows[0]!.n];
}

it('persists exact protocol text once and replays across a fresh database pool and ACK id without new jobs', async () => {
  const h = await setup();
  const before = await counts();
  const first = await connection.db.transaction((tx) =>
    h.app.requests.createInTransaction(tx, h.account, h.prepared()),
  );
  expect(first).toMatchObject({ status: 'success', replayed: false });
  expect(await counts()).toEqual(before.map((n) => n + 1));
  const stored = await connection.db
    .select()
    .from(arrangeInputs)
    .where(eq(arrangeInputs.creatorAccountId, h.account));
  expect(stored).toHaveLength(1);
  // Final 897 canonical RecordInput trims display text; the original fragment
  // and digest, not that DTO, are the authoritative exact protocol bytes.
  expect(stored[0]!.originalInput.text).toBe(h.text.trim());
  const source = stored[0]!.inputSource;
  if (!source) throw new Error('Native source required');
  const [fragment] = await connection.db
    .select()
    .from(fragments)
    .where(eq(fragments.id, source.fragmentId));
  const [version] = await connection.db
    .select()
    .from(originalVersions)
    .where(eq(originalVersions.id, source.originalVersionId));
  expect(fragment?.excerpt).toBe(h.text);
  expect(fragment?.originalVersionId).toBe(source.originalVersionId);
  expect(version?.contentDigest).toBe(
    createHash('sha256').update(h.text).digest('hex'),
  );
  const fresh = createDatabase(connection.testUrl);
  try {
    const again = await fresh.db.transaction((tx) =>
      h
        .makeApp(fresh.db)
        .requests.createInTransaction(
          tx,
          h.account,
          h.prepared(h.text, 'sender-demo', 'new-ack'),
        ),
    );
    expect(again).toEqual({ ...first, replayed: true });
  } finally {
    await fresh.pool.end();
  }
  expect(await counts()).toEqual(before.map((n) => n + 1));
  expect(h.calls()).toBe(0);
});
it('serializes simultaneous duplicate text delivery through the real operation lock', async () => {
  const h = await setup();
  const before = await counts();
  const results = await Promise.all(
    [0, 1].map(() =>
      connection.db.transaction((tx) =>
        h.app.requests.createInTransaction(tx, h.account, h.prepared()),
      ),
    ),
  );
  expect(results.map((r) => r.status)).toEqual(['success', 'success']);
  expect(
    results.filter((r) => r.status === 'success' && !r.replayed),
  ).toHaveLength(1);
  expect(await counts()).toEqual(before.map((n) => n + 1));
  expect(h.calls()).toBe(0);
});
it('changed text under the same message conflicts, while another sender gets a distinct native operation', async () => {
  const h = await setup();
  expect((await h.app.requests.create(h.account, h.prepared())).status).toBe(
    'success',
  );
  const before = await counts();
  expect(
    (
      await h.app.requests.create(
        h.account,
        h.prepared(h.text + '变更（演示）'),
      )
    ).status,
  ).toBe('conflict');
  expect(await counts()).toEqual(before);
  expect(
    (await h.app.requests.create(h.account, h.prepared(h.text, 'other-sender')))
      .status,
  ).toBe('success');
  expect(await counts()).toEqual(before.map((n) => n + 1));
  expect(h.calls()).toBe(0);
});
it('rolls native source, intake, audit and queue back when the caller transaction fails after submission', async () => {
  const h = await setup();
  const before = await counts();
  const cancelled = new Error('synthetic receiver cancelled');
  await expect(
    connection.db.transaction(async (tx) => {
      expect(
        (await h.app.requests.createInTransaction(tx, h.account, h.prepared()))
          .status,
      ).toBe('success');
      expect(await counts(tx)).toEqual(before.map((n) => n + 1));
      expect(await counts()).toEqual(before);
      throw cancelled;
    }),
  ).rejects.toBe(cancelled);
  expect(await counts()).toEqual(before);
  expect(h.calls()).toBe(0);
});
it('rechecks the actual current node relation on replay and prevents another write after expiry', async () => {
  const h = await setup();
  expect((await h.app.requests.create(h.account, h.prepared())).status).toBe(
    'success',
  );
  const before = await counts();
  await connection.db
    .update(evaluationRelations)
    .set({ validTo: businessAt })
    .where(eq(evaluationRelations.id, h.relation));
  expect((await h.app.requests.create(h.account, h.prepared())).status).toBe(
    'not_found',
  );
  expect(
    (
      await h.app.requests.create(h.account, {
        ...h.prepared(),
        operationId: randomUUID(),
      })
    ).status,
  ).toBe('forbidden');
  expect(await counts()).toEqual(before);
  expect(h.calls()).toBe(0);
});
it('does not submit missing-target or media messages as text and makes no native side effect', async () => {
  const h = await setup();
  const before = await counts();
  expect(prepareWecomTextBatch(h.message(), null)).toMatchObject({
    status: 'unavailable',
  });
  expect(
    prepareWecomTextBatch(
      {
        ...h.message(),
        parts: [
          {
            kind: 'file',
            url: 'https://media.example.invalid/item',
            aesKey: 'synthetic',
          },
        ],
      },
      h.target,
    ),
  ).toEqual({ status: 'unavailable', reason: 'archive_required' });
  expect(await counts()).toEqual(before);
  expect(h.calls()).toBe(0);
});
