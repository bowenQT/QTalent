import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { eq, sql } from 'drizzle-orm';
import { PgBoss, fromDrizzle } from 'pg-boss';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { getDatabase } from '../db/client';
import { requireSession } from '../auth/next';
import { startRecordArrangeAction } from '../actions/record-arrange';
import { readRecordBatchAction } from '../actions/record-batch';
import { getAppJobProducer } from '../platform/jobs/app-runtime';
import type { MaterialUploadRequest } from '../../contracts/media';
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

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../auth/next', () => ({ requireSession: vi.fn() }));
vi.mock('../db/client', async (original) => ({
  ...(await original<typeof import('../db/client')>()),
  getDatabase: vi.fn(),
}));
vi.mock('../env', () => ({ getEnv: () => ({ APP_ENV: 'test' }) }));
vi.mock('../platform/jobs/app-runtime', () => ({
  getAppJobProducer: vi.fn(),
}));

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
  vi.mocked(getDatabase).mockImplementation(() => connection.db);
  vi.mocked(getAppJobProducer).mockResolvedValue(boss);
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
 * in the archive transaction, as the record attachment dispatch does; an
 * unassigned upload is only staged. */
async function upload(
  filename: string,
  mediaType: string,
  bytes: Buffer,
  target: MaterialUploadRequest['target'],
) {
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
  const request = {
    ...fake.request,
    operationId: randomUUID(),
    target,
    filename,
    declaredMediaType: mediaType,
    declaredBytes: bytes.length,
  };
  // Staging goes through the material intake endpoint's request.
  const grant =
    target.kind === 'unassigned'
      ? await service.requestMaterial(seeded.account, request).then((r) => {
          if (r.status !== 'success') throw new Error(r.status);
          return r.upload;
        })
      : await service.request(seeded.account, request);
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
  return { uploadId: grant.uploadId, completed };
}

async function deliver(filename: string, mediaType: string, bytes: Buffer) {
  const { completed } = await upload(filename, mediaType, bytes, {
    kind: 'people',
    personIds: [seeded.target],
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

it('parses a staged PDF once a batch takes it from the real entry, and the batch reads it as parsed', async () => {
  const bytes = await readFile('tests/fixtures/attachments/chinese-pages.pdf');
  const staged = await upload('演示汇报.pdf', 'application/pdf', bytes, {
    kind: 'unassigned',
    evaluationNodeId: seeded.node,
  });
  expect(staged.completed).toMatchObject({ status: 'staged' });
  vi.mocked(requireSession).mockResolvedValue({
    user: { id: seeded.account },
  } as Awaited<ReturnType<typeof requireSession>>);
  const created = await startRecordArrangeAction({
    operationId: randomUUID(),
    personIds: [],
    projectId: null,
    text: '',
    files: [{ clientFileId: randomUUID(), uploadId: staged.uploadId }],
  });
  expect(created.status).toBe('success');
  if (created.status !== 'success') return;
  const [file] = created.result.files;
  expect(file).toMatchObject({ status: 'processing' });
  const job = await settled((file as { jobId: string }).jobId);
  expect(job.status).toBe('completed');
  const [parse] = await connection.db
    .select()
    .from(materialParses)
    .where(eq(materialParses.jobId, job.jobId));
  const read = await readRecordBatchAction({
    batchId: created.result.batchId,
  });
  expect(read.status).toBe('success');
  if (read.status !== 'success') return;
  expect(read.result.files).toEqual([
    expect.objectContaining({
      filename: '演示汇报.pdf',
      status: 'parsed',
      parseVersionId: parse!.id,
    }),
  ]);
}, 90_000);
