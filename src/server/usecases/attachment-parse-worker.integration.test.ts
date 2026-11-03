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
import {
  attachmentParseMessageId,
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
import type { UploadStorage } from '../modules/records/uploads/types';
import { createAttachmentParseWorker } from './attachment-parse-worker';
import { runAttachmentParse } from './attachment-parse';
import {
  entryAccountBindingDigest,
  mcpTokenDigest,
} from '../auth/entry/persistent';
import { mcpCredentials } from '../auth/entry/schema';
import { createJobStore } from '../jobs/repository';
import { createDocumentDecoders } from '../modules/records/attachments/document-decoders';
import { createValidatedAttachmentInput } from '../modules/records/attachments/upload-input';
import { saveAttachmentDocument } from '../modules/records/material-sources/attachment-document-save';
import { readValidatedUploadInTransaction } from '../modules/records/uploads/handoff-transaction';
import { createMcpPostgresTools } from './mcp/postgres';

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
  vi.mocked(getDatabase).mockImplementation(() => connection.db);
  vi.mocked(getAppJobProducer).mockResolvedValue(boss);
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
 * attachment dispatch does; an unassigned upload is only staged. */
async function upload(
  filename: string,
  mediaType: string,
  bytes: Buffer,
  target: MaterialUploadRequest['target'],
  send = true,
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
    const sent = await sendAttachmentParse(boss, job, {
      db: fromDrizzle(tx, sql),
    });
    if (!sent) throw new Error('Attachment parse enqueue was not committed');
    return { jobId: job.jobId };
  });
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
  return {
    uploadId: grant.uploadId,
    completed,
    /** Removes the upload from its collection, as the composer's remove does. */
    release: () =>
      collections.release(seeded.account, {
        uploadId: grant.uploadId,
        operationId: randomUUID(),
        expectedRevision: completed.revision,
      }),
  };
}

async function deliver(
  filename: string,
  mediaType: string,
  bytes: Buffer,
  { send = true, personId = seeded.target } = {},
) {
  const uploaded = await upload(
    filename,
    mediaType,
    bytes,
    { kind: 'people', personIds: [personId] },
    send,
  );
  const { jobId } = dispatched(uploaded.completed);
  return {
    jobId,
    release: uploaded.release,
    send: (options: { startAfter?: number } = {}) =>
      sendAttachmentParse(boss, { jobId, attempt: 1, revision: 1 }, options),
  };
}

/** A runner in this process against the same database and objects, for the
 * cases that must act while a parse is between its claim and its completion. */
function inProcessWorker(openObject: UploadStorage['openObject']) {
  return createAttachmentParseWorker({
    db: connection.db,
    boss,
    storage: { openObject },
    demo: true,
    businessNow: () => new Date().toISOString(),
    now: () => new Date(),
  });
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

const pdf = () => readFile('tests/fixtures/attachments/chinese-pages.pdf');

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

it('a real worker process claims a PDF parse from the queue and saves its page text', async () => {
  const { jobId } = await deliver(
    '演示材料.pdf',
    'application/pdf',
    await pdf(),
  );
  const job = await settled(jobId);
  expect(job.status).toBe('completed');
  expect(job.result).toMatchObject({ stage: 'parsed' });
  const [parse] = await parsesOf(jobId);
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

it.each([
  [
    '演示表格.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    () => readFile('tests/fixtures/attachments/table.docx'),
  ],
  [
    '演示不支持内容.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    () => readFile('tests/fixtures/attachments/unsupported-content.docx'),
  ],
])(
  'ends %s with unsupported document content without saving a parse',
  async (filename, mediaType, bytes) => {
    const { jobId } = await deliver(filename, mediaType, await bytes());
    const job = await settled(jobId);
    expect(job.status).toBe('failed');
    expect(job.errorCode).toBe('processing_failed');
    expect(job.result).toMatchObject({
      stage: 'unsupported',
      failureReason: 'format',
      fragmentIds: [],
    });
    expect(await parsesOf(jobId)).toEqual([]);
  },
  90_000,
);

it('ends a parse the account may no longer write as changed input, without saving', async () => {
  // The account's grant covers the target's cohort, not this person.
  const { jobId } = await deliver(
    '演示材料.pdf',
    'application/pdf',
    await pdf(),
    {
      personId: seeded.other,
    },
  );
  const job = await settled(jobId);
  expect(job).toMatchObject({ status: 'failed', errorCode: 'input_changed' });
  expect(job.result).toMatchObject({
    stage: 'failed',
    failureReason: 'processing_failed',
    fragmentIds: [],
  });
  expect(await parsesOf(jobId)).toEqual([]);
}, 90_000);

it('ends a parse whose upload was removed before the message was consumed', async () => {
  const upload = await deliver('演示材料.pdf', 'application/pdf', await pdf(), {
    send: false,
  });
  await upload.release();
  await upload.send();
  const job = await settled(upload.jobId);
  expect(job).toMatchObject({ status: 'failed', errorCode: 'input_changed' });
  expect(await parsesOf(upload.jobId)).toEqual([]);
}, 90_000);

it('discards a parse whose upload was removed while its bytes were read', async () => {
  const upload = await deliver('演示材料.pdf', 'application/pdf', await pdf(), {
    send: false,
  });
  const storage = testStorage().storage;
  const runner = inProcessWorker(async (input) => {
    await upload.release();
    return storage.openObject(input);
  });
  await runner.run({ jobId: upload.jobId, attempt: 1, revision: 1 });
  const job = await snapshot(upload.jobId);
  expect(job).toMatchObject({ status: 'failed', errorCode: 'input_changed' });
  expect(await parsesOf(upload.jobId)).toEqual([]);
}, 90_000);

it('a fresh worker finishes a parse whose runner died after claiming it', async () => {
  const upload = await deliver('演示材料.pdf', 'application/pdf', await pdf(), {
    send: false,
  });
  // The claim commits, then the runner never returns: what a killed process
  // leaves behind.
  let reading!: () => void;
  const read = new Promise<void>((resolve) => (reading = resolve));
  void inProcessWorker(async () => {
    reading();
    return new Promise<never>(() => {});
  }).run({ jobId: upload.jobId, attempt: 1, revision: 1 });
  await read;
  expect(await snapshot(upload.jobId)).toMatchObject({
    status: 'running',
    result: { stage: 'parsing' },
  });
  await stopWorker();
  await connection.db
    .update(jobSnapshots)
    .set({ updatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString() })
    .where(eq(jobSnapshots.jobId, upload.jobId));
  await startWorker();
  const job = await settled(upload.jobId);
  expect(job.status).toBe('completed');
  expect(job.result).toMatchObject({ stage: 'parsed' });
  expect(await parsesOf(upload.jobId)).toHaveLength(1);
}, 120_000);

/** Moves a job's last change back past every recovery window. */
async function age(jobId: string) {
  await connection.db
    .update(jobSnapshots)
    .set({ updatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString() })
    .where(eq(jobSnapshots.jobId, jobId));
}

const recovery = () =>
  inProcessWorker(() => {
    throw new Error('Recovery never reads bytes');
  });

it('resends a job left queued without a message, and the worker parses it', async () => {
  const upload = await deliver('演示材料.pdf', 'application/pdf', await pdf(), {
    send: false,
  });
  await age(upload.jobId);
  // The worker process scans on its own timer too, so either scan may resend.
  await recovery().recover();
  const job = await settled(upload.jobId);
  expect(job.status).toBe('completed');
  expect(job.result).toMatchObject({ stage: 'parsed' });
  expect(await parsesOf(upload.jobId)).toHaveLength(1);
  // The resend went out for revision 2; the claim took 3, completion 4.
  expect(
    await boss.getJobById(
      attachmentParseQueue,
      attachmentParseMessageId(upload.jobId, 2),
    ),
  ).toMatchObject({ data: { jobId: upload.jobId, revision: 2 } });
  expect(job.revision).toBe(4);
}, 90_000);

it('leaves a queued job alone while it is recent or its message still waits', async () => {
  const recent = await deliver('演示材料.pdf', 'application/pdf', await pdf(), {
    send: false,
  });
  const waiting = await deliver(
    '演示材料.pdf',
    'application/pdf',
    await pdf(),
    {
      send: false,
    },
  );
  // A message that is due later stays queued on pg-boss's side.
  expect(await waiting.send({ startAfter: 3600 })).not.toBeNull();
  await age(waiting.jobId);
  await recovery().recover();
  for (const jobId of [recent.jobId, waiting.jobId]) {
    expect(await snapshot(jobId)).toMatchObject({
      status: 'queued',
      revision: 1,
    });
    expect(
      await boss.getJobById(
        attachmentParseQueue,
        attachmentParseMessageId(jobId, 2),
      ),
    ).toBeNull();
  }
  // A second send of the same revision is refused by the message id.
  expect(await waiting.send()).toBeNull();
  expect(await parsesOf(waiting.jobId)).toEqual([]);
}, 90_000);

it('settles a queued job that keeps losing its message once it reaches the revision bound', async () => {
  const upload = await deliver('演示材料.pdf', 'application/pdf', await pdf(), {
    send: false,
  });
  await connection.db
    .update(jobSnapshots)
    .set({
      revision: 4,
      updatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    })
    .where(eq(jobSnapshots.jobId, upload.jobId));
  await recovery().recover();
  const job = await settled(upload.jobId);
  expect(job).toMatchObject({
    status: 'failed',
    errorCode: 'processing_failed',
  });
  expect(job.result).toMatchObject({
    stage: 'failed',
    failureReason: 'processing_failed',
  });
  expect(await parsesOf(upload.jobId)).toEqual([]);
}, 90_000);

it('skips a stale queued job while another transaction holds its row', async () => {
  const upload = await deliver('演示材料.pdf', 'application/pdf', await pdf(), {
    send: false,
  });
  await age(upload.jobId);
  await connection.db.transaction(async (tx) => {
    await tx
      .select({ jobId: jobSnapshots.jobId })
      .from(jobSnapshots)
      .where(eq(jobSnapshots.jobId, upload.jobId))
      .for('update');
    await recovery().recover();
    expect(
      await boss.getJobById(
        attachmentParseQueue,
        attachmentParseMessageId(upload.jobId, 2),
      ),
    ).toBeNull();
    expect(await snapshot(upload.jobId)).toMatchObject({
      status: 'queued',
      revision: 1,
    });
  });
  // Once the row is free, the next scan resends it.
  await recovery().recover();
  const job = await settled(upload.jobId);
  expect(job.status).toBe('completed');
  expect(await parsesOf(upload.jobId)).toHaveLength(1);
}, 90_000);

it('parses a staged PDF once a batch takes it from the real entry, and the batch reads it as parsed', async () => {
  const staged = await upload('演示汇报.pdf', 'application/pdf', await pdf(), {
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
  const [parse] = await parsesOf(job.jobId);
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

const docxMime =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const documentOf = async (format: 'txt' | 'docx') =>
  format === 'txt'
    ? Buffer.from('第一段演示原文。\r\n\r\n第二段精确引用。')
    : readFile('tests/fixtures/attachments/chinese-pages.docx');

/** MCP tools on the seeded account's own persisted credential. */
async function mcp() {
  const proof = 'synthetic-mcp-proof-' + randomUUID();
  await connection.db.insert(mcpCredentials).values({
    id: seeded.prefix + '-credential-' + randomUUID(),
    accountId: seeded.account,
    accountBindingDigest: entryAccountBindingDigest(
      seeded.account,
      seeded.evaluator,
      1,
    ),
    tokenDigest: mcpTokenDigest(proof),
    revision: 1,
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    revokedAt: null,
  });
  const tools = createMcpPostgresTools({ db: connection.db, boss });
  const identity = await tools.authenticate(proof);
  return (name: string, args: unknown) => tools.call(identity, name, args);
}

it.each(['txt', 'docx'] as const)(
  'parses a staged %s sent through MCP record_moment, and the batch reads it as parsed',
  async (format) => {
    const staged = await upload(
      `演示周记.${format}`,
      format === 'txt' ? 'text/plain' : docxMime,
      await documentOf(format),
      { kind: 'unassigned', evaluationNodeId: seeded.node },
    );
    expect(staged.completed).toMatchObject({ status: 'staged' });
    const call = await mcp();
    const sent = await call('record_moment', {
      operationId: randomUUID(),
      personIds: [],
      projectId: null,
      text: '',
      files: [{ clientFileId: randomUUID(), uploadId: staged.uploadId }],
    });
    const receipt = sent.structuredContent as {
      status: string;
      payload: { batchId: string; files: { jobId: string }[] };
    };
    expect(receipt).toMatchObject({
      status: 'success',
      payload: { files: [{ status: 'processing' }] },
    });
    const job = await settled(receipt.payload.files[0]!.jobId);
    expect(job.status).toBe('completed');
    const [parse] = await parsesOf(job.jobId);
    expect(parse).toMatchObject({ projectionVersion: 'document-paragraph-v1' });
    vi.mocked(requireSession).mockResolvedValue({
      user: { id: seeded.account },
    } as Awaited<ReturnType<typeof requireSession>>);
    const read = await readRecordBatchAction({
      batchId: receipt.payload.batchId,
    });
    expect(read.status).toBe('success');
    if (read.status !== 'success') return;
    expect(read.result.files).toEqual([
      expect.objectContaining({
        filename: `演示周记.${format}`,
        status: 'parsed',
        parseVersionId: parse!.id,
      }),
    ]);
  },
  90_000,
);

it('refuses to save a staged document under a job its batch did not create', async () => {
  const staged = await upload(
    '演示周记.txt',
    'text/plain',
    await documentOf('txt'),
    { kind: 'unassigned', evaluationNodeId: seeded.node },
  );
  const stray = newJob(
    {
      jobId: randomUUID(),
      kind: 'media',
      resourceId: staged.uploadId,
      inputVersion: (staged.completed as { originalVersionId: string })
        .originalVersionId,
    },
    new Date().toISOString(),
  );
  await connection.db.insert(jobSnapshots).values(stray);
  const kodo = testStorage();
  // The claim double accepts the stray job, so only the save's own binding
  // check stands between it and the parse.
  const input = createValidatedAttachmentInput({
    readValidatedUploadInContext: readValidatedUploadInTransaction,
    readValidatedUpload: (reference) =>
      connection.db.transaction((tx) =>
        readValidatedUploadInTransaction(tx, reference),
      ),
    stagedJob: async () => stray.jobId,
    canProcess: async () => true,
    openObject: async (objectKey) => {
      const object = await kodo.storage.openObject({ objectKey });
      return (async function* () {
        const reader = object.body.getReader();
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            yield next.value;
          }
        } finally {
          reader.releaseLock();
          object.close();
        }
      })();
    },
  });
  await expect(
    runAttachmentParse(
      createJobStore(connection.db),
      {
        ...input,
        saveParse: (tx, binding, parsed) =>
          saveAttachmentDocument(tx, binding, parsed, {
            sourceCategory: 'original',
            demo: true,
          }),
        enqueueArrange: async () => {},
      },
      { jobId: stray.jobId, attempt: 1, revision: stray.revision },
      {
        now: () => new Date().toISOString(),
        limits: {
          maxBytes: 1000000,
          maxFragments: 100,
          maxFragmentChars: 1000,
        },
        decoders: createDocumentDecoders(),
      },
    ),
  ).rejects.toThrow('material_conflict');
  expect(await parsesOf(stray.jobId)).toEqual([]);
}, 30_000);
