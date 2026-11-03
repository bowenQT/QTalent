import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PgBoss, fromDrizzle } from 'pg-boss';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, type Transaction } from '../../../db/client';
import { createJobStore } from '../../../jobs/repository';
import { jobSnapshots } from '../../../jobs/schema';
import { newJob } from '../../../jobs/state';
import { runAttachmentParse } from '../../../usecases/attachment-parse';
import { createDocumentDecoders } from '../attachments/document-decoders';
import { createValidatedAttachmentInput } from '../attachments/upload-input';
import type { AttachmentParsePorts } from '../attachments/flow';
import { createPostgresUploadStore } from '../uploads/store';
import { createRecordCollectionService } from '../uploads/collections';
import { createUploadService } from '../uploads/service';
import { readValidatedUpload } from '../uploads/handoff';
import { readValidatedUploadInTransaction } from '../uploads/handoff-transaction';
import { dispatched, fixture } from '../../../../../tests/fixtures/upload-fake';
import { materialParses, fragments } from '../schema';
import {
  seedRecordCase,
  seedRecordRules,
} from '../../../../../tests/fixtures/bow-846/native';
import { readMaterialFragment, readMaterialParse } from './store';
import { saveAttachmentDocument } from './attachment-document-save';

const now = '2026-11-01T00:00:00.000Z';
const name =
  'qtalent_document_save_' + randomUUID().replaceAll('-', '') + '_test';
const queue = '866-document-save-validation';
let connection: ReturnType<typeof createDatabase>;
let admin: Pool;
let boss: PgBoss;
beforeAll(async () => {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) throw new Error('TEST_DATABASE_URL required; no fake PG');
  const url = new URL(raw);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test') ||
    url.port === '55432'
  )
    throw new Error('Isolated test database required');
  admin = new Pool({ connectionString: raw, max: 2 });
  await admin.query(`CREATE DATABASE "${name}"`);
  url.pathname = '/' + name;
  connection = createDatabase(url.toString());
  await migrate(connection.db, {
    migrationsFolder:
      process.env.QTALENT_926_TEST_MIGRATIONS ?? 'src/server/db/migrations',
  });
  await seedRecordRules(connection.db);
  boss = new PgBoss({ connectionString: url.toString() });
  await boss.start();
  await boss.createQueue(queue);
}, 30000);
afterAll(async () => {
  await boss?.stop();
  await connection?.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
  }
}, 30000);

async function setup(format: 'txt' | 'docx' = 'txt') {
  const bytes =
    format === 'txt'
      ? Buffer.from('第一段演示原文。\r\n\r\n第二段精确引用。')
      : await readFile('tests/fixtures/attachments/chinese-pages.docx');
  const mediaType =
    format === 'txt'
      ? 'text/plain'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const db = connection.db;
  const record = await seedRecordCase(db);
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
    return { jobId: job.jobId };
  });
  // Upload/write policy remains an EXPLICIT boundary double. These tests prove
  // native facts/worker/transaction composition, never production authorization.
  const collections = createRecordCollectionService({
    store,
    now: () => Date.parse(now),
    canWriteTarget: async () => true,
    loadBinding: async () => ({ state: 'draft', externalAttachmentCount: 0 }),
    collectionForEvent: async () => null,
  });
  const collection = await collections.create(record.account.one, {
    operationId: randomUUID(),
    target: { kind: 'people', personIds: [record.person.one] },
  });
  const fake = fixture(collection.id);
  const service = createUploadService({
    ...fake.options,
    store,
    policy: {
      ...fake.options.policy,
      resolveWriteTarget: collections.resolveWriteTarget,
    },
  });
  const grant = await service.request(record.account.one, {
    ...fake.request,
    operationId: randomUUID(),
    target: { kind: 'people', personIds: [record.person.one] },
    filename: `demo.${format}`,
    declaredMediaType: mediaType,
    declaredBytes: bytes.length,
  });
  await fake.put(grant.objectKey, new Uint8Array(bytes), mediaType);
  const completed = await service.complete(record.account.one, {
    uploadId: grant.uploadId,
    operationId: 'complete',
    receiptRef: 'synthetic',
    expectedRevision: 1,
  });
  let permitted = true;
  let failEnqueue = false;
  let beforeOpen: (() => Promise<void>) | undefined;
  let saveCalls = 0;
  let openCalls = 0;
  const queueIds: string[] = [];
  const input = createValidatedAttachmentInput<Transaction>({
    readValidatedUploadInContext: readValidatedUploadInTransaction,
    readValidatedUpload: (reference) => readValidatedUpload(store, reference),
    stagedJob: async () => null,
    canProcess: async () => permitted,
    openObject: async (objectKey) => {
      openCalls++;
      await beforeOpen?.();
      const object = await fake.options.storage.openObject({ objectKey });
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
  const ports: AttachmentParsePorts<Transaction> = {
    ...input,
    saveParse: async (tx, binding, parsed) => {
      saveCalls++;
      return saveAttachmentDocument(tx, binding, parsed, {
        sourceCategory: 'original',
        demo: true,
      });
    },
    enqueueArrange: async (tx, request) => {
      // This validation queue proves the atomic port, not c902's arrangement business.
      const stored = await readMaterialParse(tx, request.parseVersionId);
      expect(stored?.binding.originalVersionId).toBe(request.originalVersionId);
      expect(
        stored?.fragments.every((s) => s.location.kind === 'document'),
      ).toBe(true);
      const id = await boss.send(
        queue,
        { parseVersionId: request.parseVersionId },
        { db: fromDrizzle(tx, sql) },
      );
      if (!id) throw new Error('validation queue refused');
      queueIds.push(id);
      if (failEnqueue) throw new Error('synthetic failure after enqueue');
    },
  };
  const run = () =>
    runAttachmentParse(
      createJobStore(db),
      ports,
      { jobId: dispatched(completed).jobId, attempt: 1 },
      {
        now: () => now,
        limits: {
          maxBytes: 1000000,
          maxFragments: 100,
          maxFragmentChars: 1000,
        },
        decoders: createDocumentDecoders(),
      },
    );
  return {
    db,
    record,
    store,
    completed,
    input,
    ports,
    run,
    queueIds,
    calls: () => ({ openCalls, saveCalls }),
    deny: () => {
      permitted = false;
    },
    fail: () => {
      failEnqueue = true;
    },
    onOpen: (fn: () => Promise<void>) => {
      beforeOpen = fn;
    },
    job: async () =>
      (
        await db
          .select()
          .from(jobSnapshots)
          .where(eq(jobSnapshots.jobId, dispatched(completed).jobId))
      )[0],
    parses: () =>
      db
        .select()
        .from(materialParses)
        .where(
          eq(materialParses.originalVersionId, completed.originalVersionId),
        ),
  };
}

it.each(['txt', 'docx'] as const)(
  'actual upload → %s decoder → native parse/source/job/enqueue commits once',
  async (format) => {
    const f = await setup(format);
    expect(await f.run()).toEqual({ status: 'parsed' });
    const job = await f.job();
    expect(job.status).toBe('completed');
    const [parse] = await f.parses();
    const stored = await readMaterialParse(f.db, parse.id);
    expect(stored?.pages).toEqual([]);
    expect(stored?.binding.projectionVersion).toBe('document-paragraph-v1');
    expect(stored?.fragments).toHaveLength(2);
    expect(
      (job.result as { fragmentIds: string[] }).fragmentIds.sort(),
    ).toEqual(stored!.fragments.map((f) => f.fragmentId).sort());
    for (const source of stored!.fragments) {
      expect(source).toMatchObject({
        sourceCategory: 'original',
        demo: true,
        originalVersionId: f.completed.originalVersionId,
        location: { kind: 'document' },
      });
      expect(source.location).not.toHaveProperty('page');
      expect(
        (
          await readMaterialFragment(
            f.db,
            source.fragmentId,
            source.originalVersionId,
          )
        )?.source,
      ).toEqual(source);
    }
    expect(f.queueIds).toHaveLength(1);
    expect(await boss.getJobById(queue, f.queueIds[0])).not.toBeNull();
    expect(await f.run()).toEqual({ status: 'ignored' });
    expect(await f.parses()).toHaveLength(1);
    expect(f.calls()).toEqual({ openCalls: 1, saveCalls: 1 });
  },
  30000,
);

it('enqueue failure rolls back document fragments, parse and terminal job together', async () => {
  const f = await setup();
  f.fail();
  await expect(f.run()).rejects.toThrow('synthetic failure after enqueue');
  expect(await f.parses()).toEqual([]);
  expect(
    await f.db
      .select()
      .from(fragments)
      .where(eq(fragments.originalVersionId, f.completed.originalVersionId)),
  ).toEqual([]);
  expect(await f.job()).toMatchObject({ status: 'running' });
  expect(await boss.getJobById(queue, f.queueIds[0])).toBeNull();
});
it.each(['account', 'digest', 'parser'] as const)(
  'rejects changed %s at native save without partial persistence',
  async (mode) => {
    const f = await setup();
    f.ports.saveParse = (tx, binding, parsed) =>
      saveAttachmentDocument(
        tx,
        mode === 'account'
          ? { ...binding, accountId: 'other-demo-account' }
          : binding,
        mode === 'digest'
          ? { ...parsed, sha256: 'a'.repeat(64) }
          : mode === 'parser'
            ? { ...parsed, parserVersion: 'other:v1' }
            : parsed,
        { sourceCategory: 'original', demo: true },
      );
    await expect(f.run()).rejects.toThrow(
      mode === 'account' ? 'material_conflict' : 'invalid_material_parse',
    );
    expect(await f.parses()).toEqual([]);
    expect(f.queueIds).toEqual([]);
  },
);
it('cancellation before the save leaves no document facts or arrange message', async () => {
  const f = await setup('docx');
  f.onOpen(async () => {
    await f.db
      .update(jobSnapshots)
      .set({ cancelRequestedAt: now })
      .where(eq(jobSnapshots.jobId, dispatched(f.completed).jobId));
  });
  expect(await f.run()).toEqual({ status: 'cancelled' });
  expect(await f.parses()).toEqual([]);
  expect(f.queueIds).toEqual([]);
});
