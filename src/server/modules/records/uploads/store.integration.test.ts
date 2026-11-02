import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../../../db/client';
import { jobSnapshots } from '../../../jobs/schema';
import { originals, originalVersions, fragments } from '../schema';
import { uploadIntents } from './schema';
import {
  createPostgresUploadStore,
  readUploadCollectionMembers,
  type UploadDispatch,
} from './store';
import { createUploadService } from './service';
import { createOriginalReader } from './read';
import { readValidatedUpload } from './handoff';
import { readValidatedUploadInTransaction } from './handoff-transaction';
import { createValidatedAttachmentInput } from '../attachments/upload-input';
import type { Transaction } from '../../../db/client';
import { newJob } from '../../../jobs/state';
import { createRecordCollectionService } from './collections';
import { fixture } from '../../../../../tests/fixtures/upload-fake';

let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
let created = false;
const name = `qtalent_upload_store_${randomUUID().replaceAll('-', '')}_test`;
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source)
    throw new Error(
      'Real PostgreSQL requires TEST_DATABASE_URL; no skip or fake fallback',
    );
  const url = new URL(source);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Integration database must be loopback and end _test');
  admin = new Pool({ connectionString: source });
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  url.pathname = `/${name}`;
  connection = createDatabase(url.toString());
  await migrate(connection.db, {
    //926 combination validation only; default remains the published migration gate.
    migrationsFolder:
      process.env.QTALENT_926_TEST_MIGRATIONS ?? 'src/server/db/migrations',
  });
  const { rows } = await connection.db.execute<{ ready: boolean }>(
    sql`select to_regclass('public.records_upload_collections') is not null and to_regclass('public.records_upload_intents') is not null and to_regclass('public.records_upload_objects') is not null and to_regclass('public.records_upload_read_tickets') is not null as ready`,
  );
  if (!rows[0].ready)
    throw new Error(
      'Upload migrations are not published yet; parent serializes 846 -> 845 -> 873. Do not generate a competing migration or push test schema.',
    );
}, 30000);
afterAll(async () => {
  await connection?.pool.end();
  if (admin) {
    try {
      if (created) await admin.query(`DROP DATABASE "${name}"`);
    } finally {
      await admin.end();
    }
  }
});
async function databaseFixture(draft = false) {
  let writable = true;
  let failDispatch = false;
  let canonicalCollection: string | null = null;
  const dispatches: {
    originalId: string;
    originalVersionId: string;
    jobId: string;
  }[] = [];
  const dispatch: UploadDispatch = async (tx, input) => {
    const jobId = randomUUID();
    dispatches.push({ ...input, jobId });
    // Synthetic dispatch boundary writes a real durable row using the provided
    // executor. This proves rollback of callback effects, not pg-boss wiring.
    await tx.insert(jobSnapshots).values({
      jobId,
      kind: 'upload-archive-verification',
      resourceId: input.uploadId,
      inputVersion: input.originalVersionId,
      status: 'queued',
      attempt: 1,
      revision: 1,
      updatedAt: new Date(f.now()).toISOString(),
      result: null,
      errorCode: null,
      cancelRequestedAt: null,
    });
    if (failDispatch)
      throw new Error('synthetic dispatch failure after durable write');
    return { jobId };
  };
  const store = createPostgresUploadStore(connection!.db, dispatch);
  const collections = createRecordCollectionService({
    store,
    now: () => Date.parse('2026-10-25T16:00:00Z'),
    async canWriteTarget() {
      return writable;
    },
    async loadBinding() {
      if (draft) return { state: 'draft', externalAttachmentCount: 0 };
      return {
        state: 'saved',
        eventIds: ['synthetic-event'],
        externalAttachmentCount: 0,
      };
    },
    async collectionForEvent(eventId) {
      return eventId === 'synthetic-event' ? canonicalCollection : null;
    },
  });
  const collection = await collections.create('account', {
    operationId: randomUUID(),
    target: { kind: 'people', personIds: ['demo-person-1'] },
  });
  canonicalCollection = collection.id;
  const f = fixture(collection.id);
  // Fixtures share this real database; each new collection is a new operation.
  f.request.operationId = randomUUID();
  const options = {
    ...f.options,
    store,
    policy: {
      ...f.options.policy,
      resolveWriteTarget: collections.resolveWriteTarget,
    },
  };
  const service = createUploadService(options);
  return {
    ...f,
    options,
    store,
    service,
    collections,
    dispatches,
    deny() {
      writable = false;
      f.deny();
    },
    failDispatch() {
      failDispatch = true;
    },
  };
}
async function uploaded(draft = false) {
  const f = await databaseFixture(draft);
  const grant = await f.service.request('account', f.request);
  await f.put(grant.objectKey);
  const command = {
    uploadId: grant.uploadId,
    receiptRef: 'synthetic notice',
    operationId: 'complete',
    expectedRevision: 1,
  };
  return { ...f, grant, command };
}
it('persists one original/version/mapping and one dispatch under concurrent completion', async () => {
  const f = await uploaded();
  const results = await Promise.all(
    Array.from({ length: 4 }, () => f.service.complete('account', f.command)),
  );
  expect(
    results.every(
      (result) => result.originalVersionId === results[0].originalVersionId,
    ),
  ).toBe(true);
  expect(f.dispatches).toHaveLength(1);
  expect(f.dispatches[0]).toMatchObject({
    recordCollectionId: f.request.recordCollectionId,
  });
  const result = results[0];
  const [version] = await connection!.db
    .select()
    .from(originalVersions)
    .where(eq(originalVersions.id, result.originalVersionId));
  const handoff = await readValidatedUpload(f.store, result);
  expect(version.contentDigest).toBe(handoff!.object.sha256);
  expect(handoff).toMatchObject({
    jobId: result.jobId,
    purpose: 'attachment',
    recordCollectionId: f.request.recordCollectionId,
    object: { objectKey: f.grant.objectKey, byteLength: 7 },
  });
  f.deny();
  await expect(f.service.complete('account', f.command)).rejects.toMatchObject({
    status: 'forbidden',
  });
});
it('rolls back original/version/object/completion and durable callback effects together', async () => {
  const f = await uploaded();
  f.failDispatch();
  await expect(f.service.complete('account', f.command)).rejects.toMatchObject({
    status: 'unavailable',
  });
  const captured = f.dispatches[0];
  expect(captured).toBeDefined();
  expect(
    await connection!.db
      .select()
      .from(originals)
      .where(eq(originals.id, captured.originalId)),
  ).toHaveLength(0);
  expect(
    await connection!.db
      .select()
      .from(originalVersions)
      .where(eq(originalVersions.id, captured.originalVersionId)),
  ).toHaveLength(0);
  expect(
    await connection!.db
      .select()
      .from(jobSnapshots)
      .where(eq(jobSnapshots.jobId, captured.jobId)),
  ).toHaveLength(0);
  expect(
    await f.store.transaction([], (tx) =>
      tx.findObject(captured.originalVersionId),
    ),
  ).toBeNull();
  expect(
    (await f.store.transaction([], (tx) => tx.findIntent(f.grant.uploadId)))!
      .completed,
  ).toBeNull();
});
it('reserves ten slots atomically across different authenticated uploaders', async () => {
  const f = await databaseFixture();
  const results = await Promise.allSettled(
    Array.from({ length: 11 }, (_, i) =>
      f.service.request(`account-${i}`, {
        ...f.request,
        operationId: `request-${i}`,
      }),
    ),
  );
  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(10);
  const failure = results.find((result) => result.status === 'rejected');
  expect(failure).toMatchObject({
    reason: { status: 'validation_error', reason: 'attachment_limit' },
  });
});
it('keeps the exact 2 GiB intent declaration in bigint and rejects a bypass above the product cap', async () => {
  const f = await databaseFixture();
  const service = createUploadService({
    ...f.options,
    adapterMaxBytes: 2 ** 31,
  });
  const grant = await service.request('account', {
    ...f.request,
    declaredBytes: 2 ** 31,
  });
  const [row] = await connection!.db
    .select()
    .from(uploadIntents)
    .where(eq(uploadIntents.id, grant.uploadId));
  expect(row.declaredBytes).toBe(2147483648);
  await expect(
    f.store.transaction([], (tx) =>
      tx.insertIntent({
        ...row,
        id: randomUUID(),
        operationId: 'bypass-cap',
        objectKey: `uploads/${randomUUID()}/original`,
        request: { ...row.request, declaredBytes: 2147483649 },
      }),
    ),
  ).rejects.toMatchObject({ cause: { code: '23514' } });
});
it('persists a private read ticket only for a real matching fragment/version pair', async () => {
  const f = await uploaded();
  const result = await f.service.complete('account', f.command);
  const fragmentId = randomUUID();
  await connection!.db.insert(fragments).values({
    id: fragmentId,
    originalVersionId: result.originalVersionId,
    excerpt: '演示：已解析合成内容。',
    location: { kind: 'document', paragraph: '1' },
  });
  const reader = createOriginalReader(f.options);
  const ticket = await reader.grant('account', {
    fragmentId,
    originalVersionId: result.originalVersionId,
  });
  const token = new URL(ticket.url, 'https://app.invalid').searchParams.get(
    'ticket',
  )!;
  expect(await (await reader.open('account', token)).text()).toBe('演示x');
  const second = await f.service.request('account', {
    ...f.request,
    operationId: 'second',
  });
  await f.put(second.objectKey);
  const other = await f.service.complete('account', {
    ...f.command,
    uploadId: second.uploadId,
    operationId: 'second-complete',
  });
  await expect(
    f.store.transaction([], (tx) =>
      tx.insertTicket({
        digest: 'a'.repeat(64),
        accountId: 'account',
        fragmentId,
        originalId: other.originalId,
        originalVersionId: other.originalVersionId,
        requestedRange: null,
        expiresAt: f.now() + 60000,
      }),
    ),
  ).rejects.toMatchObject({ cause: { code: '23503' } });
});
it('persists membership release, frees the SQL quota count, and preserves the original version', async () => {
  const f = await uploaded(true);
  const result = await f.service.complete('account', f.command);
  const command = {
    uploadId: result.uploadId,
    operationId: 'release',
    expectedRevision: 2,
  };
  const removed = await f.collections.release('account', command);
  await expect(f.collections.release('account', command)).resolves.toEqual(
    removed,
  );
  const [intent] = await connection!.db
    .select()
    .from(uploadIntents)
    .where(eq(uploadIntents.id, result.uploadId));
  expect(intent.releasedAt).toBe(f.now());
  expect(
    await f.store.transaction([], (tx) =>
      tx.activeCount(f.request.recordCollectionId, f.now()),
    ),
  ).toBe(0);
  expect(await readValidatedUpload(f.store, result)).not.toBeNull();
  expect(
    await connection!.db
      .select()
      .from(originalVersions)
      .where(eq(originalVersions.id, result.originalVersionId)),
  ).toHaveLength(1);
  await expect(f.service.complete('account', f.command)).rejects.toMatchObject({
    status: 'conflict',
    reason: 'upload_removed',
  });
});

it('reads all historical members from the actual collection FK without a ten-row or lifecycle filter', async () => {
  const f = await databaseFixture(true);
  const ids: string[] = [];
  let archivedVersion: string | undefined;
  for (let i = 0; i < 12; i++) {
    const grant = await f.service.request('account', {
      ...f.request,
      operationId: `history-${i}`,
    });
    ids.push(grant.uploadId);
    let revision = 1;
    if (i === 0) {
      await f.put(grant.objectKey);
      const completed = await f.service.complete('account', {
        uploadId: grant.uploadId,
        receiptRef: 'synthetic notice',
        operationId: 'complete',
        expectedRevision: 1,
      });
      archivedVersion = completed.originalVersionId;
      revision = completed.revision;
    }
    if (i % 2 === 0)
      await f.collections.release('account', {
        uploadId: grant.uploadId,
        operationId: `release-${i}`,
        expectedRevision: revision,
      });
  }
  await connection!.db
    .update(uploadIntents)
    .set({ expiresAt: f.now() - 1 })
    .where(eq(uploadIntents.id, ids[1]));
  const snapshot = await f.store.readCollectionMembers(
    f.request.recordCollectionId,
  );
  expect(snapshot?.members).toHaveLength(12);
  expect(snapshot?.members.map((member) => member.intent.id).sort()).toEqual(
    [...ids].sort(),
  );
  expect(
    snapshot?.members.filter((member) => member.intent.releasedAt !== null),
  ).toHaveLength(6);
  expect(
    snapshot?.members.find((member) => member.intent.id === ids[1])?.intent
      .expiresAt,
  ).toBe(f.now() - 1);
  expect(
    snapshot?.members.find((member) => member.object !== null)?.object
      ?.originalVersionId,
  ).toBe(archivedVersion);
  expect(await f.store.readCollectionMembers(randomUUID())).toBeNull();
});
it('keeps the real quota lock throughout the caller native transaction and refuses stale isolation', async () => {
  const f = await databaseFixture();
  const id = f.request.recordCollectionId;
  const key = `quota:${id}`;
  await connection!.db.transaction(
    async (tx) => {
      const snapshot = await readUploadCollectionMembers(tx, id);
      expect(snapshot?.members).toEqual([]);
      const waiting = await connection!.db.transaction((other) =>
        other.execute<{ locked: boolean }>(
          sql`select pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) as locked`,
        ),
      );
      expect(waiting.rows[0].locked).toBe(false);
    },
    { isolationLevel: 'read committed' },
  );
  const available = await connection!.db.transaction((tx) =>
    tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) as locked`,
    ),
  );
  expect(available.rows[0].locked).toBe(true);
  await expect(
    connection!.db.transaction((tx) => readUploadCollectionMembers(tx, id), {
      isolationLevel: 'repeatable read',
    }),
  ).rejects.toMatchObject({
    status: 'unavailable',
    reason: 'upload_read_committed_required',
  });
});

it('reads validated upload facts in the caller transaction and retains its quota lock through rollback', async () => {
  const f = await uploaded();
  const completed = await f.service.complete('account', f.command);
  const original = await readValidatedUpload(f.store, completed);
  const failure = new Error('synthetic caller rollback');
  await expect(
    connection!.db.transaction(
      async (tx) => {
        const [intent] = await tx
          .select()
          .from(uploadIntents)
          .where(eq(uploadIntents.id, completed.uploadId));
        await tx
          .update(uploadIntents)
          .set({
            request: { ...intent.request, filename: 'demo-uncommitted.txt' },
          })
          .where(eq(uploadIntents.id, intent.id));
        const current = await readValidatedUploadInTransaction(tx, completed);
        expect(current).toMatchObject({
          filename: 'demo-uncommitted.txt',
          recordCollectionId: f.request.recordCollectionId,
        });
        expect(await readValidatedUpload(f.store, completed)).toEqual(original);
        const attempted = await connection!.db.transaction((other) =>
          other.execute<{ locked: boolean }>(
            sql`select pg_try_advisory_xact_lock(hashtextextended(${`quota:${f.request.recordCollectionId}`},0)) as locked`,
          ),
        );
        expect(attempted.rows[0].locked).toBe(false);
        throw failure;
      },
      { isolationLevel: 'read committed' },
    ),
  ).rejects.toBe(failure);
  expect(await readValidatedUpload(f.store, completed)).toEqual(original);
});
it('keeps the actual873 collection binding through866 context load and separate open recheck', async () => {
  const f = await uploaded();
  const completed = await f.service.complete('account', f.command);
  let authorizedContext: Transaction | undefined;
  const input = createValidatedAttachmentInput<Transaction>({
    readValidatedUploadInContext: readValidatedUploadInTransaction,
    readValidatedUpload: (ref) => readValidatedUpload(f.store, ref),
    // Synthetic policy tests only context identity; not production authorization.
    canProcess: async (tx, binding) => {
      authorizedContext = tx;
      return binding.recordCollectionId === f.request.recordCollectionId;
    },
    openObject: async () =>
      (async function* () {
        yield Buffer.from('synthetic');
      })(),
  });
  const job = newJob(
    {
      jobId: completed.jobId,
      kind: 'media',
      resourceId: completed.uploadId,
      inputVersion: completed.originalVersionId,
    },
    new Date(f.now()).toISOString(),
  );
  await connection!.db.transaction(
    async (tx) => {
      expect(await input.loadAuthorizedAttachment(tx, job)).toMatchObject({
        recordCollectionId: f.request.recordCollectionId,
        completedJobId: completed.jobId,
        version: { originalVersionId: completed.originalVersionId },
      });
      expect(authorizedContext).toBe(tx);
    },
    { isolationLevel: 'read committed' },
  );
});
it('rejects missing or wrong native upload references and repeatable-read snapshots', async () => {
  const f = await uploaded();
  const completed = await f.service.complete('account', f.command);
  expect(
    await connection!.db.transaction((tx) =>
      readValidatedUploadInTransaction(tx, {
        ...completed,
        uploadId: randomUUID(),
      }),
    ),
  ).toBeNull();
  expect(
    await connection!.db.transaction((tx) =>
      readValidatedUploadInTransaction(tx, {
        ...completed,
        originalVersionId: randomUUID(),
      }),
    ),
  ).toBeNull();
  await expect(
    connection!.db.transaction(
      (tx) => readValidatedUploadInTransaction(tx, completed),
      { isolationLevel: 'repeatable read' },
    ),
  ).rejects.toMatchObject({ reason: 'upload_read_committed_required' });
});
it('re-reads committed completion after waiting for the collection lock instead of using the pre-lock hint', async () => {
  const f = await uploaded();
  const completed = await f.service.complete('account', f.command);
  let release!: () => void, locked!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const writer = connection!.db.transaction(async (tx) => {
    await readUploadCollectionMembers(tx, f.request.recordCollectionId);
    locked();
    await gate;
    // A controlled conflicting persisted fact, never an allowed producer action.
    await tx
      .update(uploadIntents)
      .set({
        completed: {
          ...completed,
          recordCollectionId: 'synthetic-wrong-collection',
        },
      })
      .where(eq(uploadIntents.id, completed.uploadId));
  });
  await held;
  let pid = 0;
  const reader = connection!.db.transaction(async (tx) => {
    const result = await tx.execute<{ pid: number }>(
      sql`select pg_backend_pid() as pid`,
    );
    pid = result.rows[0].pid;
    return readValidatedUploadInTransaction(tx, completed);
  });
  const observed = reader.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  // Observe actual PostgreSQL lock waiting, not a timing-only sleep assertion.
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (pid) {
        const q = await connection!.db.execute<{ waiting: boolean }>(
          sql`select exists(select 1 from pg_locks where pid=${pid} and not granted) as waiting`,
        );
        waiting = q.rows[0].waiting;
        if (waiting) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(waiting).toBe(true);
  } finally {
    release();
    await writer;
  }
  expect(await observed).toMatchObject({
    error: { reason: 'upload_collection_inconsistent' },
  });
});
