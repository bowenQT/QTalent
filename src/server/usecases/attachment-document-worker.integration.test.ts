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
import {
  attachmentParseQueue,
  sendAttachmentParse,
} from '../jobs/attachment-parse';
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

async function startWorker() {
  logs = '';
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
}
async function stopWorker() {
  if (worker && worker.exitCode === null) {
    worker.kill('SIGTERM');
    await once(worker, 'exit');
  }
}

beforeAll(async () => {
  connection = await nativeDatabase();
  seeded = await seedNativeCase(connection.db);
  boss = new PgBoss({ connectionString: connection.testUrl });
  await boss.start();
  await boss.createQueue(attachmentParseQueue, { retryLimit: 0 });
  await startWorker();
}, 60_000);
afterAll(async () => {
  await stopWorker();
  await boss?.stop();
  await connection?.close();
}, 60_000);

function testStorage() {
  return testKodoFor({
    NODE_ENV: 'test',
    APP_ENV: 'test',
    BETTER_AUTH_URL: authUrl,
    DATABASE_URL: connection.testUrl,
  })!;
}

/** An attachment upload whose completion creates its media job and, unless a
 * case holds it back, sends it in the archive transaction, as the record
 * attachment dispatch does. */
async function deliver(
  filename: string,
  mediaType: string,
  bytes: Buffer,
  { send = true, personId = seeded.target } = {},
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
    if (!send) return { jobId: job.jobId };
    const sent = await sendAttachmentParse(
      boss,
      { jobId: job.jobId, attempt: job.attempt, revision: job.revision },
      { db: fromDrizzle(tx, sql) },
    );
    if (!sent) throw new Error('Attachment parse enqueue was not committed');
    return { jobId: job.jobId };
  });
  const target = { kind: 'people' as const, personIds: [personId] };
  // Upload-side write policy is a boundary double; the worker decides
  // processing on the account's current record write permission.
  const collections = createRecordCollectionService({
    store,
    canWriteTarget: async () => true,
    loadBinding: async () => ({ state: 'draft', externalAttachmentCount: 0 }),
    collectionForEvent: async () => null,
  });
  const collection = await collections.create(seeded.account, {
    operationId: randomUUID(),
    target,
  });
  const kodo = testStorage();
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
  const { jobId, revision } = dispatched(completed);
  return {
    jobId,
    /** Removes the upload from its collection, as the composer's remove does. */
    release: () =>
      collections.release(seeded.account, {
        uploadId: grant.uploadId,
        operationId: randomUUID(),
        expectedRevision: revision,
      }),
    /** Redelivers the first message; a plain send stands in for a redelivery
     * that the message id would otherwise refuse. */
    send: () =>
      boss.send(attachmentParseQueue, { jobId, attempt: 1, revision: 1 }),
  };
}

async function snapshot(jobId: string) {
  const [job] = await connection.db
    .select()
    .from(jobSnapshots)
    .where(eq(jobSnapshots.jobId, jobId));
  return job!;
}

async function parsesOf(jobId: string) {
  return connection.db
    .select()
    .from(materialParses)
    .where(eq(materialParses.jobId, jobId));
}

async function settled(jobId: string) {
  await expect
    .poll(
      async () => {
        if (worker.exitCode !== null) throw new Error(logs);
        return (await snapshot(jobId)).status;
      },
      { timeout: 60_000, interval: 200 },
    )
    .toMatch(/^(completed|failed|cancelled)$/);
  return snapshot(jobId);
}

const docxMime =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const txt =
  '\uFEFF  第一段演示原文。\r\n保留段内换行。\r\n\r\n第二段精确引用。  ';
it.each(['txt', 'docx'] as const)(
  'the deployed worker consumes %s and persists original paragraph provenance',
  async (format) => {
    const upload = await deliver(
      `演示材料.${format}`,
      format === 'txt' ? 'text/plain' : docxMime,
      format === 'txt'
        ? Buffer.from(txt)
        : await readFile('tests/fixtures/attachments/chinese-pages.docx'),
    );
    const job = await settled(upload.jobId);
    expect(job.status).toBe('completed');
    expect(job.result).toMatchObject({ stage: 'parsed' });
    const parses = await parsesOf(job.jobId);
    expect(parses).toHaveLength(1);
    expect(parses[0]).toMatchObject({
      projectionVersion: 'document-paragraph-v1',
      originalVersionId: job.inputVersion,
    });
    const saved = await connection.db
      .select()
      .from(fragments)
      .where(eq(fragments.parseVersionId, parses[0].id));
    expect(saved).toHaveLength(2);
    expect(
      (job.result as { fragmentIds: string[] }).fragmentIds.slice().sort(),
    ).toEqual(saved.map((f) => f.id).sort());
    for (const fragment of saved) {
      expect(fragment).toMatchObject({
        sourceCategory: 'original',
        demo: true,
        originalVersionId: job.inputVersion,
      });
      if (fragment.location.kind !== 'document')
        throw new Error('Expected document paragraph');
      expect(fragment.location).not.toHaveProperty('page');
      if (format === 'txt') {
        const [start, end] = fragment.location.paragraph
          .split(':u16:')[1]
          .split('-')
          .map(Number);
        expect(txt.slice(1).slice(start, end)).toBe(fragment.excerpt);
      }
    }
    if (format === 'docx')
      expect(
        saved
          .map((f) => f.location)
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      ).toEqual([
        { kind: 'document', paragraph: 'docx:body:p1:u16:2-10' },
        { kind: 'document', paragraph: 'docx:body:p4:u16:0-8' },
      ]);
    // A duplicated pg-boss message is acknowledged without republishing facts.
    const messageId = await upload.send();
    expect(messageId).toBeTruthy();
    await expect
      .poll(
        async () =>
          (await boss.getJobById(attachmentParseQueue, messageId!))?.state,
        { timeout: 15000, interval: 100 },
      )
      .toBe('completed');
    expect(await parsesOf(upload.jobId)).toHaveLength(1);
    expect(await snapshot(upload.jobId)).toEqual(job);
  },
  90000,
);

async function corruptDocx() {
  const bytes = await readFile('tests/fixtures/attachments/chinese-pages.docx');
  // Preserve the upload verifier's ZIP envelope; corrupt actual compressed content.
  const payload = 30 + bytes.readUInt16LE(26) + bytes.readUInt16LE(28);
  bytes[payload] ^= 1;
  return bytes;
}
it('invalid UTF-8 is rejected by upload verification before a parse job exists', async () => {
  const before = await connection.db
    .select({ jobId: jobSnapshots.jobId })
    .from(jobSnapshots);
  await expect(
    deliver('坏编码.txt', 'text/plain', Buffer.from([0xff, 0xfe, 0xff])),
  ).rejects.toMatchObject({
    status: 'validation_error',
    reason: 'invalid_content',
  });
  expect(
    await connection.db
      .select({ jobId: jobSnapshots.jobId })
      .from(jobSnapshots),
  ).toEqual(before);
});

it.each([
  [
    '空白.txt',
    'text/plain',
    () => Promise.resolve(Buffer.from(' \r\n\r\n ')),
    'failed',
    'empty',
  ],
  ['损坏.docx', docxMime, corruptDocx, 'failed', 'invalid_content'],
  [
    '表格.docx',
    docxMime,
    () => readFile('tests/fixtures/attachments/table.docx'),
    'unsupported',
    'format',
  ],
] as const)(
  'settles %s without saving incomplete sources',
  async (filename, mediaType, bytes, stage, reason) => {
    const { jobId } = await deliver(filename, mediaType, await bytes());
    const job = await settled(jobId);
    expect(job.status).toBe('failed');
    expect(job.result).toMatchObject({
      stage,
      failureReason: reason,
      source: null,
      fragmentIds: [],
    });
    expect(await parsesOf(jobId)).toEqual([]);
    expect(
      await connection.db
        .select()
        .from(fragments)
        .where(eq(fragments.originalVersionId, job.inputVersion)),
    ).toEqual([]);
  },
  90000,
);

it('a TXT upload outside current record write permission ends failed without publishing', async () => {
  const { jobId } = await deliver(
    '无权材料.txt',
    'text/plain',
    Buffer.from('演示：不可发布。'),
    { personId: seeded.other },
  );
  const job = await settled(jobId);
  expect(job).toMatchObject({
    status: 'failed',
    errorCode: 'input_changed',
    result: { stage: 'failed', fragmentIds: [] },
  });
  expect(await parsesOf(jobId)).toEqual([]);
}, 90000);
