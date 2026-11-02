import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { eq, sql } from 'drizzle-orm';
import { PgBoss, fromDrizzle } from 'pg-boss';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  nativeDatabase,
  seedNativeCase,
} from '../../../tests/fixtures/bow-845/native';
import { dispatched, fixture } from '../../../tests/fixtures/upload-fake';
import { attachmentParseQueue } from '../jobs/attachment-parse';
import { jobSnapshots } from '../jobs/schema';
import { newJob } from '../jobs/state';
import { testKodoFor } from '../integrations/kodo/test-kodo';
import { fragments, materialParses } from '../modules/records';
import { createRecordCollectionService } from '../modules/records/uploads/collections';
import { createUploadService } from '../modules/records/uploads/service';
import { createPostgresUploadStore } from '../modules/records/uploads/store';

const authUrl = 'http://127.0.0.1:3000';
let connection: Awaited<ReturnType<typeof nativeDatabase>>;
let seeded: Awaited<ReturnType<typeof seedNativeCase>>;
let boss: PgBoss;
let worker: ChildProcess;
let logs = '';

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Port required');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

beforeAll(async () => {
  connection = await nativeDatabase();
  seeded = await seedNativeCase(connection.db);
  boss = new PgBoss({ connectionString: connection.testUrl });
  await boss.start();
  await boss.createQueue(attachmentParseQueue, { retryLimit: 0 });
  // The deployed command: `pnpm start:worker` runs this same source entry.
  worker = spawn(process.execPath, ['--import', 'tsx', 'src/worker/index.ts'], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      APP_ENV: 'test',
      DATABASE_URL: connection.testUrl,
      BETTER_AUTH_URL: authUrl,
      BETTER_AUTH_SECRET: 'isolated-worker-test-secret-at-least-32-chars',
      ACCESS_ENFORCED: 'false',
      WORKER_PORT: String(await freePort()),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  worker.stdout?.on('data', (chunk) => (logs += String(chunk)));
  worker.stderr?.on('data', (chunk) => (logs += String(chunk)));
}, 60_000);
afterAll(async () => {
  if (worker && worker.exitCode === null) {
    worker.kill('SIGTERM');
    await once(worker, 'exit');
  }
  await boss?.stop();
  await connection?.close();
}, 60_000);

/** An attachment upload whose completion creates its media job and sends it
 * in the archive transaction, as the record attachment dispatch does. */
async function deliver(filename: string, mediaType: string, bytes: Buffer) {
  const db = connection.db;
  const now = new Date().toISOString();
  const store = createPostgresUploadStore(db, async (tx, input) => {
    const job = newJob(
      {
        jobId: randomUUID(),
        kind: 'media',
        resourceId: input.uploadId,
        inputVersion: input.originalVersionId,
      },
      now,
    );
    await tx.insert(jobSnapshots).values(job);
    const sent = await boss.send(
      attachmentParseQueue,
      { jobId: job.jobId, attempt: job.attempt },
      { db: fromDrizzle(tx, sql) },
    );
    if (!sent) throw new Error('Attachment parse enqueue was not committed');
    return { jobId: job.jobId };
  });
  const target = { kind: 'people' as const, personIds: [seeded.target] };
  // Upload-side write policy is a boundary double; the worker decides
  // processing on the account's current record write permission.
  const collection = await createRecordCollectionService({
    store,
    canWriteTarget: async () => true,
    loadBinding: async () => ({ state: 'draft', externalAttachmentCount: 0 }),
    collectionForEvent: async () => null,
  }).create(seeded.account, { operationId: randomUUID(), target });
  const kodo = testKodoFor({
    NODE_ENV: 'test',
    APP_ENV: 'test',
    BETTER_AUTH_URL: authUrl,
    DATABASE_URL: connection.testUrl,
  })!;
  const fake = fixture(collection.id);
  const service = createUploadService({
    ...fake.options,
    storage: kodo.storage,
    store,
    now: () => Date.now(),
  });
  const grant = await service.request(seeded.account, {
    ...fake.request,
    operationId: randomUUID(),
    target,
    filename,
    declaredMediaType: mediaType,
    declaredBytes: bytes.length,
  });
  const path = [
    'buckets',
    'test-bucket',
    'objects',
    Buffer.from(grant.objectKey)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_'),
    'uploads',
  ];
  const headers = { authorization: `UpToken ${grant.uploadToken}` };
  const endpoint = `${authUrl}/api/test/kodo`;
  const init = await kodo.handle(
    new Request(endpoint, { method: 'POST', headers }),
    path,
  );
  const { uploadId } = (await init.json()) as { uploadId: string };
  const part = await kodo.handle(
    new Request(endpoint, {
      method: 'PUT',
      headers,
      body: new Uint8Array(bytes),
    }),
    [...path, uploadId, '1'],
  );
  const { etag } = (await part.json()) as { etag: string };
  const done = await kodo.handle(
    new Request(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        parts: [{ partNumber: 1, etag }],
        mimeType: mediaType,
      }),
    }),
    [...path, uploadId],
  );
  expect(done.status).toBe(200);
  const completed = await service.complete(seeded.account, {
    uploadId: grant.uploadId,
    operationId: randomUUID(),
    receiptRef: 'synthetic-receipt',
    expectedRevision: grant.revision,
  });
  return dispatched(completed).jobId;
}

async function settled(jobId: string) {
  await expect
    .poll(
      async () => {
        if (worker.exitCode !== null) throw new Error(logs);
        const [job] = await connection.db
          .select({ status: jobSnapshots.status })
          .from(jobSnapshots)
          .where(eq(jobSnapshots.jobId, jobId));
        return job?.status;
      },
      { timeout: 60_000, interval: 200 },
    )
    .toMatch(/^(completed|failed|cancelled)$/);
  const [job] = await connection.db
    .select()
    .from(jobSnapshots)
    .where(eq(jobSnapshots.jobId, jobId));
  return job!;
}

it('a real worker process claims a PDF parse from the queue and saves its page text', async () => {
  const bytes = await readFile('tests/fixtures/attachments/chinese-pages.pdf');
  const jobId = await deliver('演示材料.pdf', 'application/pdf', bytes);
  const job = await settled(jobId);
  expect(job.status).toBe('completed');
  expect(job.result).toMatchObject({ stage: 'parsed' });
  const [parse] = await connection.db
    .select()
    .from(materialParses)
    .where(eq(materialParses.jobId, jobId));
  expect(parse).toBeDefined();
  const saved = await connection.db
    .select()
    .from(fragments)
    .where(eq(fragments.parseVersionId, parse!.id));
  expect(saved.length).toBeGreaterThan(0);
  expect(saved.every((fragment) => fragment.demo === true)).toBe(true);
  expect((job.result as { fragmentIds: string[] }).fragmentIds.sort()).toEqual(
    saved.map((fragment) => fragment.id).sort(),
  );
}, 90_000);

it('ends a format without a canonical store as unsupported, never parsing', async () => {
  const jobId = await deliver(
    '演示说明.txt',
    'text/plain',
    Buffer.from('演示材料：补齐回滚步骤。\n'),
  );
  const job = await settled(jobId);
  expect(job.status).toBe('failed');
  expect(job.result).toMatchObject({
    stage: 'unsupported',
    failureReason: 'format',
    fragmentIds: [],
  });
  const parses = await connection.db
    .select()
    .from(materialParses)
    .where(eq(materialParses.jobId, jobId));
  expect(parses).toEqual([]);
}, 90_000);
