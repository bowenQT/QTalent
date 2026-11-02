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
import { createMaterialPdfDecoder } from '../attachments/document-decoders';
import { createValidatedAttachmentInput } from '../attachments/upload-input';
import type { AttachmentParsePorts } from '../attachments/flow';
import { createPostgresUploadStore } from '../uploads/store';
import { createRecordCollectionService } from '../uploads/collections';
import { createUploadService } from '../uploads/service';
import { readValidatedUpload } from '../uploads/handoff';
import { readValidatedUploadInTransaction } from '../uploads/handoff-transaction';
import { uploadObjects } from '../uploads/schema';
import { fixture } from '../../../../../tests/fixtures/upload-fake';
import {
  materialParses,
  fragments,
  eventSources,
  eventParticipants,
} from '../schema';
import { readMaterialSource } from '../../../usecases/read-material-source';
import {
  seedRecordCase,
  seedRecordRules,
  businessNow,
} from '../../../../../tests/fixtures/bow-846/native';
import { readMaterialParse } from './store';
import { saveAttachmentPdf } from './attachment-save';

const now = '2026-11-01T00:00:00.000Z';
const name =
  'qtalent_attachment_save_' + randomUUID().replaceAll('-', '') + '_test';
const queue = '926-attachment-save-validation';
let connection: ReturnType<typeof createDatabase>;
let admin: Pool;
let boss: PgBoss;
let bytes: Buffer;
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
  bytes = await readFile(
    new URL(
      '../../../../../tests/fixtures/attachments/chinese-pages.pdf',
      import.meta.url,
    ),
  );
}, 30000);
afterAll(async () => {
  await boss?.stop();
  await connection?.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
  }
}, 30000);

async function setup() {
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
    filename: 'demo.pdf',
    declaredMediaType: 'application/pdf',
    declaredBytes: bytes.length,
  });
  await fake.put(grant.objectKey, new Uint8Array(bytes), 'application/pdf');
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
      return saveAttachmentPdf(tx, binding, parsed, {
        sourceCategory: 'original',
        demo: true,
      });
    },
    enqueueArrange: async (tx, request) => {
      // Resolve canonical locations; the old 866 items-v2 request locator is NOT
      // the PDF UTF-16 locator. This validation queue is not845's intake producer.
      const stored = await readMaterialParse(tx, request.parseVersionId);
      expect(stored?.binding.originalVersionId).toBe(request.originalVersionId);
      expect(stored?.fragments.every((s) => s.location.kind === 'pdf')).toBe(
        true,
      );
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
      { jobId: completed.jobId, attempt: 1 },
      {
        now: () => now,
        limits: {
          maxBytes: 1000000,
          maxFragments: 100,
          maxFragmentChars: 1000,
        },
        decoders: { pdf: createMaterialPdfDecoder() },
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
          .where(eq(jobSnapshots.jobId, completed.jobId))
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

it('actual873 archive → real PDF worker → canonical save/job/queue commit and replay once', async () => {
  const f = await setup();
  expect(await f.run()).toEqual({ status: 'parsed' });
  expect(await f.job()).toMatchObject({ status: 'completed' });
  const [parse] = await f.parses();
  const actual = await readMaterialParse(f.db, parse.id);
  expect(actual?.pages.map((p) => p.text)).toEqual([
    '第一页演示原文。\n同页第二行。',
    '第二页精确引用。',
  ]);
  expect(actual?.fragments).toHaveLength(3);
  for (const source of actual!.fragments) {
    expect(source.location.kind).toBe('pdf');
    if (source.location.kind !== 'pdf') throw new Error('expected PDF');
    const range = source.location.textRange;
    expect(
      actual!.pages[source.location.page - 1].text.slice(
        range.start,
        range.end,
      ),
    ).toBe(source.excerpt);
  }
  // The association is an explicit formal-event fixture, not a claim that
  // the missing845 attachment-intake producer created it automatically.
  for (const source of actual!.fragments) {
    const reference = {
      fragmentId: source.fragmentId,
      originalVersionId: source.originalVersionId,
    };
    await f.db
      .insert(eventSources)
      .values({ eventId: f.record.sourceEventId, ...reference });
    expect(
      await readMaterialSource(
        f.db,
        f.record.account.one,
        reference,
        () => businessNow,
      ),
    ).toEqual({ status: 'success', source });
  }
  await f.db
    .insert(eventParticipants)
    .values({ eventId: f.record.sourceEventId, personId: f.record.person.two });
  expect(
    (
      await readMaterialSource(
        f.db,
        f.record.account.one,
        actual!.fragments[0],
        () => businessNow,
      )
    ).status,
  ).toBe('validation_error');
  const first = actual!.fragments[0];
  expect(
    (
      await readMaterialSource(
        f.db,
        f.record.account.one,
        {
          fragmentId: first.fragmentId,
          originalVersionId: first.originalVersionId,
        },
        () => businessNow,
      )
    ).status,
  ).toBe('not_found');
  expect(f.queueIds).toHaveLength(1);
  expect(await boss.getJobById(queue, f.queueIds[0])).not.toBeNull();
  expect(await f.run()).toEqual({ status: 'ignored' });
  expect(f.calls()).toEqual({ openCalls: 1, saveCalls: 1 });
  expect(await f.parses()).toHaveLength(1);
}, 30000);

it('unknown/unclassified processing scope never opens bytes, saves or queues', async () => {
  const f = await setup();
  f.deny();
  expect(await f.run()).toEqual({ status: 'forbidden' });
  expect(f.calls()).toEqual({ openCalls: 0, saveCalls: 0 });
  expect(await f.parses()).toHaveLength(0);
  expect(f.queueIds).toHaveLength(0);
});
it.each(['revoked', 'binding', 'cancelled', 'attempt'] as const)(
  'real completion recheck rejects %s during parsing',
  async (mode) => {
    const f = await setup();
    f.onOpen(async () => {
      if (mode === 'revoked') f.deny();
      if (mode === 'binding')
        await f.db
          .update(uploadObjects)
          .set({ sha256: 'a'.repeat(64) })
          .where(
            eq(uploadObjects.originalVersionId, f.completed.originalVersionId),
          );
      if (mode === 'cancelled')
        await f.db
          .update(jobSnapshots)
          .set({ cancelRequestedAt: now })
          .where(eq(jobSnapshots.jobId, f.completed.jobId));
      if (mode === 'attempt')
        await f.db
          .update(jobSnapshots)
          .set({ attempt: 2 })
          .where(eq(jobSnapshots.jobId, f.completed.jobId));
    });
    expect((await f.run()).status).toBe(
      mode === 'revoked'
        ? 'forbidden'
        : mode === 'cancelled'
          ? 'cancelled'
          : 'ignored',
    );
    expect(f.calls().saveCalls).toBe(0);
    expect(await f.parses()).toHaveLength(0);
    expect(f.queueIds).toHaveLength(0);
  },
  30000,
);
it('failure after actual enqueue rolls back parse/pages/fragments/queue and completion', async () => {
  const f = await setup();
  f.fail();
  await expect(f.run()).rejects.toThrow('synthetic failure after enqueue');
  expect(await f.parses()).toHaveLength(0);
  expect(
    await f.db
      .select()
      .from(fragments)
      .where(eq(fragments.originalVersionId, f.completed.originalVersionId)),
  ).toHaveLength(0);
  expect(await f.job()).toMatchObject({ status: 'running' });
  expect(f.queueIds).toHaveLength(1);
  expect(await boss.getJobById(queue, f.queueIds[0])).toBeNull();
}, 30000);

it.each([
  'account',
  'target',
  'job',
  'version',
  'digest',
  'parser',
  'range',
  'classification',
] as const)(
  'native save rejects altered %s without partial persistence',
  async (mode) => {
    const f = await setup();
    f.ports.saveParse = (tx, binding, parsed) => {
      let changedBinding: unknown = binding;
      let changedParse: unknown = parsed;
      let provenance: unknown = { sourceCategory: 'original', demo: true };
      if (mode === 'account')
        changedBinding = { ...binding, accountId: 'other-demo-account' };
      if (mode === 'target')
        changedBinding = {
          ...binding,
          target: { kind: 'people', personIds: ['other-demo-person'] },
        };
      if (mode === 'job')
        changedBinding = { ...binding, completedJobId: 'unknown-demo-job' };
      if (mode === 'version')
        changedParse = { ...parsed, originalVersionId: 'wrong-version' };
      if (mode === 'digest')
        changedParse = { ...parsed, sha256: 'b'.repeat(64) };
      if (mode === 'parser')
        changedParse = { ...parsed, parserVersion: 'pdf:legacy-items-v2' };
      if (mode === 'range')
        changedParse = {
          ...parsed,
          pdfText: {
            ...parsed.pdfText,
            ranges: parsed.pdfText!.ranges.map((r) => ({
              ...r,
              textRange: { ...r.textRange, start: r.textRange.start + 1 },
            })),
          },
        };
      if (mode === 'classification')
        provenance = { sourceCategory: 'unknown', demo: true };
      return saveAttachmentPdf(tx, changedBinding, changedParse, provenance);
    };
    await expect(f.run()).rejects.toMatchObject({ name: 'MaterialStoreError' });
    expect(await f.parses()).toHaveLength(0);
    expect(await f.job()).toMatchObject({ status: 'running' });
    expect(f.queueIds).toHaveLength(0);
  },
  30000,
);
