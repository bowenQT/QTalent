import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { createDatabase, type Transaction } from '../db/client';
import { originals, events } from '../modules/records';
import { createFakeMaas } from '../integrations/maas';
import {
  exampleSnapshot,
  exampleResponse,
} from '../modules/records/arrange/examples';
import { createJobStore, insertJob } from '../jobs/repository';
import { jobSnapshots } from '../jobs/schema';
import { newJob } from '../jobs/state';
import { createJobService } from '../jobs/service';
import { createRecordArrangePolicy } from '../jobs/record-arrange';
import { createRecordArrangeUsecase } from './record-arrange';
import type { DraftPersistence } from '../modules/records/arrange';

let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
const database = `qtalent_bow845_${randomUUID().replaceAll('-', '')}_test`;
const now = () => '2026-10-25T16:00:00.000Z';
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source)
    throw new Error(
      'TEST_DATABASE_URL required for genuine PostgreSQL job/arrange tests; no fake or skip fallback',
    );
  const url = new URL(source);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Only isolated loopback _test databases are allowed');
  admin = new Pool({ connectionString: source, connectionTimeoutMillis: 3000 });
  await admin.query(`CREATE DATABASE "${database}"`);
  url.pathname = `/${database}`;
  connection = createDatabase(url.toString());
  await migrate(connection.db, {
    migrationsFolder: 'src/server/db/migrations',
  });
}, 30000);
afterAll(async () => {
  await connection?.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    await admin.end();
  }
});
async function harness() {
  if (!connection) throw new Error('database not initialized');
  const db = connection.db;
  const id = randomUUID();
  const resourceId = `draft-${id}`;
  const snapshot = exampleSnapshot();
  snapshot.draftId = resourceId;
  const record = newJob(
    {
      jobId: id,
      resourceId,
      kind: 'record_organize',
      inputVersion: 'input-v1',
    },
    now(),
  );
  await db.transaction((tx) => insertJob(tx, record));
  const store = createJobStore(db);
  const client = createFakeMaas(exampleResponse());
  const generate = vi.spyOn(client, 'generateStructured');
  const load = async () => structuredClone(snapshot);
  // This synthetic marker verifies transaction identity/rollback. It is not an
  // implementation of 846's draft table, nor proof of its unpublished writer.
  const persistRecordDraft = vi.fn(
    async (tx: Transaction, value: DraftPersistence) => {
      await tx
        .insert(originals)
        .values({ id: resourceId, title: '演示：845事务端口标记' });
      return { ...value.draft, revision: 1 };
    },
  );
  const policy = createRecordArrangePolicy<Transaction>({
    authorize: async () => true,
    load,
    currentInputVersion: async () => snapshot.inputVersion,
    enqueue: async (tx) => {
      await tx.execute(sql`select 1`);
    },
  });
  const service = createRecordArrangeUsecase({
    store,
    load,
    authorize: async () => true,
    persistRecordDraft,
    client,
    now,
  });
  const controls = createJobService(store, [policy], now);
  async function read() {
    return store.locked(id, async (tx) => tx.record);
  }
  async function markers() {
    return db.select().from(originals).where(eq(originals.id, resourceId));
  }
  return {
    db,
    id,
    resourceId,
    snapshot,
    generate,
    persistRecordDraft,
    service,
    controls,
    policy,
    read,
    markers,
  };
}
it('real PostgreSQL serializes concurrent deliveries and atomically persists a draft port with a durable public result', async () => {
  const h = await harness();
  await Promise.all([h.service.run(h.id, 1), h.service.run(h.id, 1)]);
  expect(h.generate).toHaveBeenCalledOnce();
  expect(h.persistRecordDraft).toHaveBeenCalledOnce();
  expect(await h.markers()).toHaveLength(1);
  expect(await h.read()).toMatchObject({
    status: 'awaiting_manual',
    attempt: 1,
    result: { state: 'draft', promptVersion: 'record-arrange.v1' },
  });
  const publicResult = await h.controls.read('demo-account', h.id);
  expect(publicResult.status).toBe('success');
  if (publicResult.status !== 'success') throw new Error('expected result');
  expect(publicResult.snapshot.result).toMatchObject({
    draftId: h.resourceId,
    revision: 1,
  });
  expect(JSON.stringify(publicResult)).not.toMatch(
    /fingerprint|attributedPersonIds|subjects|modelVersion|promptVersion/,
  );
  expect(await h.db.select().from(events)).toEqual([]);
});
it('a failing real persistence transaction rolls back both its marker and the final job update', async () => {
  const h = await harness();
  h.persistRecordDraft.mockImplementation(async (tx, value) => {
    await tx
      .insert(originals)
      .values({ id: value.id, title: 'rollback marker（演示）' });
    throw new Error('synthetic persistence failure');
  });
  await expect(h.service.run(h.id, 1)).rejects.toThrow(
    'synthetic persistence failure',
  );
  expect(await h.markers()).toEqual([]);
  expect(await h.read()).toMatchObject({
    status: 'running',
    revision: 2,
    result: null,
  });
  // A redelivery after an unknown commit/worker outcome does not call MaaS twice.
  expect(await h.service.run(h.id, 1)).toBe('ignored');
  expect(h.generate).toHaveBeenCalledOnce();
});
it('a committed cancellation during MaaS processing wins the real row-lock fence', async () => {
  const h = await harness();
  const fake = createFakeMaas(exampleResponse());
  h.generate.mockImplementation(async (input) => {
    const current = await h.read();
    if (!current) throw new Error('missing job');
    expect(
      await h.controls.command('demo-account', {
        jobId: h.id,
        operationId: randomUUID(),
        action: 'cancel',
        expectedRevision: current.revision,
      }),
    ).toMatchObject({ status: 'success' });
    return fake.generateStructured(input);
  });
  expect(await h.service.run(h.id, 1)).toBe('cancelled');
  expect(await h.markers()).toEqual([]);
  expect(await h.read()).toMatchObject({ status: 'cancelled' });
  expect(h.persistRecordDraft).not.toHaveBeenCalled();
});
it('explicit safe retry remains durable and bounded across process-service reconstruction', async () => {
  const h = await harness();
  h.generate.mockImplementationOnce(async (input) => ({
    ok: false,
    kind: 'network',
    retryable: true,
    metadata: {
      model: 'deepseek/deepseek-v4.1-flash',
      promptVersion: input.promptVersion,
      attempts: 0,
      elapsedMs: 0,
    },
  }));
  await h.service.run(h.id, 1);
  const failed = await h.read();
  if (!failed) throw new Error('missing job');
  const reconstructedControls = createJobService(
    createJobStore(h.db),
    [h.policy],
    now,
  );
  expect(
    await reconstructedControls.command('demo-account', {
      jobId: h.id,
      operationId: randomUUID(),
      action: 'retry',
      expectedRevision: failed.revision,
    }),
  ).toMatchObject({ status: 'success' });
  expect(await h.service.run(h.id, 2)).toBe('awaiting_manual');
  expect(h.generate).toHaveBeenCalledTimes(2);
  expect(h.persistRecordDraft).toHaveBeenCalledOnce();
  const [stored] = await h.db
    .select()
    .from(jobSnapshots)
    .where(eq(jobSnapshots.jobId, h.id));
  expect(stored).toMatchObject({ attempt: 2, status: 'awaiting_manual' });
});
