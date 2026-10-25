import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PgBoss, fromDrizzle } from 'pg-boss';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { createDatabase, type Transaction } from '../db/client';
import { createJobStore, insertJob, commitJobUpdate } from './repository';
import { createJobService, type JobPolicy } from './service';
import { advanceJob, newJob, type JobRecord } from './state';
import { jobSnapshots, jobOperations } from './schema';
import { exampleResultSchema } from './progress-example';
import {
  progressExampleQueue,
  runProgressExample,
  registerProgressExample,
} from './progress-worker';
import { GET, POST } from '../../app/api/jobs/[jobId]/route';
const runtime = vi.hoisted(() => ({ service: vi.fn(), session: vi.fn() }));
vi.mock('./runtime', () => ({ jobService: runtime.service }));
vi.mock('../auth', () => ({ getSession: runtime.session }));
vi.mock('../access', () => ({ verifyAccessRequest: async () => undefined }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase>;
let connectionUrl: string;
let boss: PgBoss;
const database = `qtalent_snapshots_${randomUUID().replaceAll('-', '')}_test`;
const now = '2026-10-25T00:00:00.000Z';
let allowed = true;
const policy: JobPolicy<Transaction> = {
  kind: 'test-job',
  resultSchema: exampleResultSchema,
  can: async (_tx, account) => allowed && account === 'synthetic-reader',
  inputVersion: async () => 'v1',
  canResume: async () => true,
  project: async (_tx, _account, job) => ({
    result: job.result === null ? null : exampleResultSchema.parse(job.result),
    progress: null,
  }),
  enqueue: async (tx, job) => {
    await boss.send(
      progressExampleQueue,
      { jobId: job.jobId, attempt: job.attempt },
      { db: fromDrizzle(tx, sql) },
    );
  },
};
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source)
    throw new Error(
      'TEST_DATABASE_URL required for real job snapshot PostgreSQL integration; no mock or skip fallback',
    );
  const url = new URL(source);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Only isolated loopback test databases are allowed');
  admin = new Pool({ connectionString: source, connectionTimeoutMillis: 3000 });
  await admin.query(`CREATE DATABASE "${database}"`);
  url.pathname = `/${database}`;
  connectionUrl = url.toString();
  connection = createDatabase(connectionUrl);
  await migrate(connection.db, {
    migrationsFolder: 'src/server/db/migrations',
  });
  boss = new PgBoss({ connectionString: connectionUrl });
  await boss.start();
  await boss.createQueue(progressExampleQueue);
  runtime.service.mockImplementation(() =>
    createJobService(createJobStore(connection.db), [policy], () => now),
  );
  runtime.session.mockResolvedValue({ user: { id: 'synthetic-reader' } });
}, 30000);
afterAll(async () => {
  if (boss) await boss.stop();
  if (connection) await connection.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    await admin.end();
  }
});
async function create(
  status: 'queued' | 'running' | 'failed' | 'awaiting_manual' = 'queued',
) {
  let record = newJob(
    {
      jobId: randomUUID(),
      kind: 'test-job',
      resourceId: 'synthetic-project',
      inputVersion: 'v1',
    },
    now,
  );
  if (status !== 'queued')
    record = advanceJob(
      record,
      { status: 'running', attempt: 1, expectedRevision: 1 },
      now,
    );
  if (status === 'failed' || status === 'awaiting_manual')
    record = advanceJob(
      record,
      { status, attempt: 1, expectedRevision: 2 },
      now,
    );
  await connection.db.transaction(async (tx) => {
    await insertJob(tx, record);
  });
  return record;
}
const context = (jobId: string) => ({ params: Promise.resolve({ jobId }) });
const get = (jobId: string) =>
  GET(new Request(`https://app.test/api/jobs/${jobId}`), context(jobId));
function post(
  job: JobRecord,
  action: 'retry' | 'resume' | 'cancel',
  operationId = randomUUID(),
) {
  return POST(
    new Request(`https://app.test/api/jobs/${job.jobId}`, {
      method: 'POST',
      headers: {
        origin: 'https://app.test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jobId: job.jobId,
        action,
        expectedRevision: job.revision,
        operationId,
      }),
    }),
    context(job.jobId),
  );
}
it('HTTP read, refresh, persisted worker progress and connection restart use the same PostgreSQL snapshot', async () => {
  const job = await create();
  expect((await get(job.jobId)).status).toBe(200);
  await runProgressExample(
    connection.db,
    { jobId: job.jobId, attempt: 1 },
    () => now,
  );
  const result = await (await get(job.jobId)).json();
  expect(result).toMatchObject({ status: 'completed', revision: 4 });
  expect(JSON.stringify(result)).not.toMatch(
    /inputVersion|resourceId|confidence|objectKey/,
  );
  await connection.pool.end();
  connection = createDatabase(connectionUrl);
  expect(await (await get(job.jobId)).json()).toEqual(result);
  allowed = false;
  expect((await get(job.jobId)).status).toBe(403);
  allowed = true;
  runtime.session.mockResolvedValueOnce(null);
  expect((await get(job.jobId)).status).toBe(401);
});
it('concurrent HTTP retries enqueue exactly once on the same transaction and replays still check authorization', async () => {
  const job = await create('failed');
  const operation = randomUUID();
  const responses = await Promise.all([
    post(job, 'retry', operation),
    post(job, 'retry', operation),
  ]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  expect(await responses[0].json()).toEqual(await responses[1].json());
  const jobs = await boss.findJobs<{ jobId: string }>(progressExampleQueue);
  expect(jobs.filter((j) => j.data.jobId === job.jobId)).toHaveLength(1);
  expect(
    await connection.db
      .select()
      .from(jobOperations)
      .where(eq(jobOperations.jobId, job.jobId)),
  ).toHaveLength(1);
  allowed = false;
  expect((await post(job, 'retry', operation)).status).toBe(403);
  allowed = true;
  expect((await post(job, 'resume', operation)).status).toBe(409);
  await expect(
    commitJobUpdate(
      connection.db,
      job.jobId,
      { status: 'completed', attempt: 1, expectedRevision: 4 },
      now,
      exampleResultSchema,
    ),
  ).rejects.toThrow();
});
it('enqueue failure rolls back snapshot, command ledger and queue insertion together', async () => {
  const job = await create('failed');
  const service = createJobService(
    createJobStore(connection.db),
    [
      {
        ...policy,
        enqueue: async (tx, row, action) => {
          await policy.enqueue(tx, row, action);
          throw new Error('synthetic failure after queue insertion');
        },
      },
    ],
    () => now,
  );
  await expect(
    service.command('synthetic-reader', {
      jobId: job.jobId,
      action: 'retry',
      operationId: randomUUID(),
      expectedRevision: job.revision,
    }),
  ).rejects.toThrow('synthetic failure');
  const snapshot = await runtime.service().read('synthetic-reader', job.jobId);
  expect(snapshot).toMatchObject({
    snapshot: { status: 'failed', attempt: 1, revision: 3 },
  });
  expect(
    await connection.db
      .select()
      .from(jobOperations)
      .where(eq(jobOperations.jobId, job.jobId)),
  ).toHaveLength(0);
  expect(
    (await boss.findJobs<{ jobId: string }>(progressExampleQueue)).filter(
      (j) => j.data.jobId === job.jobId,
    ),
  ).toHaveLength(0);
});
it('cancel-first fences business commit, while complete-first makes cancel conflict', async () => {
  const first = await create('running');
  expect((await post(first, 'cancel')).status).toBe(200);
  const write = vi.fn();
  await expect(
    commitJobUpdate(
      connection.db,
      first.jobId,
      { status: 'completed', attempt: 1, expectedRevision: 3 },
      now,
      exampleResultSchema,
      write,
    ),
  ).rejects.toThrow();
  expect(write).not.toHaveBeenCalled();
  await runProgressExample(
    connection.db,
    { jobId: first.jobId, attempt: 1 },
    () => now,
  );
  expect(await (await get(first.jobId)).json()).toMatchObject({
    status: 'cancelled',
  });
  expect((await post(first, 'cancel')).status).toBe(200);
  const second = await create('running');
  await commitJobUpdate(
    connection.db,
    second.jobId,
    {
      status: 'completed',
      attempt: 1,
      expectedRevision: 2,
      result: { units: [] },
    },
    now,
    exampleResultSchema,
    write,
  );
  expect(write).toHaveBeenCalledTimes(1);
  expect((await post(second, 'cancel')).status).toBe(409);
});
it('validates worker result before atomically committing any business effect', async () => {
  const job = await create('running');
  const write = vi.fn();
  await expect(
    commitJobUpdate(
      connection.db,
      job.jobId,
      {
        status: 'partial',
        attempt: 1,
        expectedRevision: 2,
        result: { units: [], confidence: 1 },
      },
      now,
      exampleResultSchema,
      write,
    ),
  ).rejects.toThrow();
  expect(write).not.toHaveBeenCalled();
  expect(
    await commitJobUpdate(
      connection.db,
      'missing',
      { status: 'running', attempt: 1, expectedRevision: 1 },
      now,
      exampleResultSchema,
    ),
  ).toBeNull();
  const waiting = await create('awaiting_manual');
  expect((await post(waiting, 'resume')).status).toBe(200);
  expect(await (await get(waiting.jobId)).json()).toMatchObject({
    status: 'running',
    attempt: 1,
    revision: 4,
  });
});
it('executes the real pg-boss synthetic worker without repeated snapshot side effects', async () => {
  await registerProgressExample(boss, connection.db);
  const job = await create();
  await boss.send(progressExampleQueue, { jobId: job.jobId, attempt: 1 });
  await expect
    .poll(async () => (await (await get(job.jobId)).json()).status, {
      timeout: 15000,
      interval: 200,
    })
    .toBe('completed');
  await runProgressExample(connection.db, { jobId: job.jobId, attempt: 1 });
  expect(await (await get(job.jobId)).json()).toMatchObject({ revision: 4 });
}, 20000);
it('database constraints reject malformed state without relying on TypeScript', async () => {
  const job = newJob(
    {
      jobId: randomUUID(),
      kind: 'test-job',
      resourceId: 'p',
      inputVersion: 'v1',
    },
    now,
  );
  for (const patch of [
    { attempt: 0 },
    { revision: 0 },
    { status: 'invalid' },
    { status: 'cancelled' },
    { errorCode: 'raw-provider-error' },
  ]) {
    await expect(
      connection.db
        .insert(jobSnapshots)
        .values({ ...job, ...patch } as JobRecord),
    ).rejects.toThrow();
  }
});

it('wakes stopped failed/manual attempts to acknowledge cancellation, without duplicate queue messages', async () => {
  for (const status of ['failed', 'awaiting_manual'] as const) {
    const job = await create(status);
    const operationId = randomUUID();
    const first = await post(job, 'cancel', operationId);
    const replay = await post(job, 'cancel', operationId);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(await first.json()).toEqual(await replay.json());
    await expect
      .poll(async () => (await (await get(job.jobId)).json()).status, {
        timeout: 15000,
        interval: 200,
      })
      .toBe('cancelled');
    expect(
      (await boss.findJobs<{ jobId: string }>(progressExampleQueue)).filter(
        (queued) => queued.data.jobId === job.jobId,
      ),
    ).toHaveLength(1);
    expect(
      await connection.db
        .select()
        .from(jobOperations)
        .where(eq(jobOperations.jobId, job.jobId)),
    ).toHaveLength(1);
  }
}, 35000);

it('serializes concurrent completion and cancellation at one revision with exactly one winning mutation', async () => {
  const job = await create('running');
  const businessWrite = vi.fn();
  const [completion, cancellation] = await Promise.allSettled([
    commitJobUpdate(
      connection.db,
      job.jobId,
      {
        status: 'completed',
        attempt: 1,
        expectedRevision: job.revision,
        result: { units: [] },
      },
      now,
      exampleResultSchema,
      businessWrite,
    ),
    post(job, 'cancel'),
  ]);
  expect(cancellation.status).toBe('fulfilled');
  if (cancellation.status !== 'fulfilled') throw cancellation.reason;
  if (completion.status === 'fulfilled') {
    expect(cancellation.value.status).toBe(409);
    expect(businessWrite).toHaveBeenCalledTimes(1);
  } else {
    expect(cancellation.value.status).toBe(200);
    expect(businessWrite).not.toHaveBeenCalled();
  }
});
