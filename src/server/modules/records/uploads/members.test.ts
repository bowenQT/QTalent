import { Pool, type PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getTableColumns, type Table } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { fixture } from '../../../../../tests/fixtures/upload-fake';
import { createUploadService } from './service';
import {
  createPostgresUploadStore,
  readUploadCollectionMembers,
  type UploadDispatch,
} from './store';
import { uploadCollections, uploadIntents, uploadObjects } from './schema';
import type { UploadCollection, UploadIntent, UploadedObject } from './types';

// Replace ONLY pg I/O. Real Drizzle transactions, SQL generation and row mapping
// are exercised here; actual PostgreSQL visibility is a separate integration test.
function driver() {
  const queries: { text: string; params: unknown[] }[] = [];
  let isolation = 'read committed';
  let collection: UploadCollection | null = null;
  let members: { intent: UploadIntent; object: UploadedObject | null }[] = [];
  let lock: Promise<void> = Promise.resolve();
  let failMembers = false;
  const columns = (table: Table, row: object | null): unknown[] =>
    Object.keys(getTableColumns(table)).map((key) =>
      row === null ? null : (row as Record<string, unknown>)[key],
    );
  const query = vi.fn(
    async (config: { text: string }, params: unknown[] = []) => {
      queries.push({ text: config.text, params });
      if (config.text.includes('current_setting'))
        return { rows: [{ isolation }] };
      if (config.text.includes('pg_advisory_xact_lock')) {
        await lock;
        return { rows: [] };
      }
      if (config.text.includes('from "records_upload_collections"'))
        return {
          rows: collection ? [columns(uploadCollections, collection)] : [],
        };
      if (config.text.startsWith('select count(*)')) return { rows: [[5]] };
      if (config.text.includes('from "records_upload_intents"')) {
        if (failMembers) throw new Error('synthetic database failure');
        return {
          rows: members.map(({ intent, object }) => [
            ...columns(uploadIntents, {
              ...intent,
              declaredBytes: intent.request.declaredBytes,
            }),
            ...columns(uploadObjects, object),
          ]),
        };
      }
      return { rows: [] };
    },
  );
  const release = vi.fn();
  const pool = new Pool();
  vi.spyOn(pool, 'connect').mockImplementation(
    async () =>
      ({
        query,
        release,
      }) as unknown as PoolClient,
  );
  const db = drizzle(pool);
  const dispatch = vi.fn<UploadDispatch>(async () => ({ jobId: 'unused' }));
  const store = createPostgresUploadStore(db, dispatch);
  return {
    db,
    store,
    queries,
    release,
    dispatch,
    seed(c: UploadCollection | null, rows: typeof members) {
      collection = c;
      members = rows;
    },
    isolation(value: string) {
      isolation = value;
    },
    waitForLock(pending: Promise<void>) {
      lock = pending;
    },
    failMembers() {
      failMembers = true;
    },
  };
}
async function facts() {
  const f = fixture();
  const grant = await createUploadService(f.options).request(
    'account',
    f.request,
  );
  const intent = f.snapshot().intents[0];
  const collection: UploadCollection = {
    id: f.request.recordCollectionId,
    creatorAccountId: 'account',
    operationId: 'create',
    target: f.request.target,
    targetFingerprint: 'a'.repeat(64),
    createdAt: f.now(),
    expiresAt: f.now() + 86400000,
    revision: 1,
  };
  const object: UploadedObject = {
    uploadId: grant.uploadId,
    originalVersionId: 'version',
    objectKey: grant.objectKey,
    byteLength: f.request.declaredBytes,
    mediaType: f.request.declaredMediaType,
    sha256: 'b'.repeat(64),
    etag: 'synthetic',
  };
  return { collection, intent, object };
}

describe('native upload collection member query', () => {
  it('returns the complete cross-account history with objects, expired intents and released members', async () => {
    const d = driver();
    const f = await facts();
    const members = Array.from({ length: 13 }, (_, i) => ({
      intent: {
        ...f.intent,
        id: `upload-${i}`,
        accountId: `account-${i}`,
        expiresAt: i % 2 ? 1 : f.intent.expiresAt,
        releasedAt: i % 3 ? null : 2,
      },
      object: null as UploadedObject | null,
    }));
    members[0].object = { ...f.object, uploadId: members[0].intent.id };
    Object.assign(members[0].intent, {
      revision: 3,
      completed: {
        uploadId: members[0].intent.id,
        recordCollectionId: f.collection.id,
        originalId: 'original',
        originalVersionId: f.object.originalVersionId,
        jobId: 'job',
        revision: 2,
        source: null,
      },
    });
    d.seed(f.collection, members);
    const result = await d.store.readCollectionMembers(f.collection.id);
    expect(result?.members).toHaveLength(13);
    expect(result?.members).toMatchObject(members);
    expect(result?.recordCollectionId).toBe(f.collection.id);
    expect(result?.collection).toEqual(f.collection);
    expect(d.dispatch).not.toHaveBeenCalled();
    expect(d.queries[0].text).toBe('begin isolation level read committed');
    const lock = d.queries.find((q) =>
      q.text.includes('pg_advisory_xact_lock'),
    )!;
    expect(lock.params).toEqual([`quota:${f.collection.id}`]);
    const membership = d.queries.find((q) =>
      q.text.includes('from "records_upload_intents"'),
    )!;
    expect(membership.params).toEqual([f.collection.id]);
    expect(membership.text.split(' where ')[1]).toBe(
      '"records_upload_intents"."record_collection_id" = $1 order by "records_upload_intents"."id" asc',
    );
    expect(membership.text).toContain('left join "records_upload_objects"');
    expect(membership.text).not.toContain('limit');
    expect(d.queries.at(-1)?.text).toBe('commit');
    expect(d.release).toHaveBeenCalledOnce();
  });

  it('waits for the same quota lock before loading any collection or members', async () => {
    const d = driver();
    const f = await facts();
    d.seed(f.collection, [{ intent: f.intent, object: null }]);
    let unlock!: () => void;
    d.waitForLock(
      new Promise<void>((resolve) => {
        unlock = resolve;
      }),
    );
    const reading = d.store.readCollectionMembers(f.collection.id);
    await vi.waitFor(() =>
      expect(
        d.queries.some((q) => q.text.includes('pg_advisory_xact_lock')),
      ).toBe(true),
    );
    expect(
      d.queries.some((q) => q.text.includes('from "records_upload_')),
    ).toBe(false);
    unlock();
    expect((await reading)?.members).toHaveLength(1);
  });

  it('distinguishes a proven empty collection from a nonexistent collection', async () => {
    const d = driver();
    const f = await facts();
    expect(await d.store.readCollectionMembers('absent')).toBeNull();
    expect(
      d.queries.some((q) => q.text.includes('from "records_upload_intents"')),
    ).toBe(false);
    d.seed(f.collection, []);
    expect(await d.store.readCollectionMembers(f.collection.id)).toEqual({
      recordCollectionId: f.collection.id,
      collection: f.collection,
      members: [],
    });
  });

  it.each(['repeatable read', 'serializable', ''])(
    'rejects a native %s transaction rather than claiming a fresh locked snapshot',
    async (isolation) => {
      const d = driver();
      d.isolation(isolation);
      await expect(
        d.db.transaction((tx) => readUploadCollectionMembers(tx, 'collection')),
      ).rejects.toMatchObject({
        status: 'unavailable',
        reason: 'upload_read_committed_required',
      });
      expect(
        d.queries.some((q) => q.text.includes('pg_advisory_xact_lock')),
      ).toBe(false);
      expect(d.queries.at(-1)?.text).toBe('rollback');
    },
  );

  it('refuses an empty identity without looking up a quota alias', async () => {
    const d = driver();
    await expect(d.store.readCollectionMembers(' ')).rejects.toMatchObject({
      status: 'unavailable',
      reason: 'record_collection_unresolved',
    });
    expect(d.queries.map((q) => q.text)).toEqual([
      'begin isolation level read committed',
      'rollback',
    ]);
  });

  it('does not turn database unavailability into an empty membership list', async () => {
    const d = driver();
    const f = await facts();
    d.seed(f.collection, []);
    d.failMembers();
    await expect(
      d.store.readCollectionMembers(f.collection.id),
    ).rejects.toThrow();
    expect(d.queries.at(-1)?.text).toBe('rollback');
    expect(d.release).toHaveBeenCalledOnce();
  });

  it.each([
    'identity',
    'quota',
    'request',
    'completion-collection',
    'completion-upload',
    'version',
    'missing-object',
    'object-without-completion',
    'object-upload',
    'key',
    'size',
  ])(
    'fails closed on inconsistent %s facts without silently omitting a member',
    async (kind) => {
      const d = driver();
      const f = await facts();
      const intent = {
        ...f.intent,
        completed: {
          uploadId: f.intent.id,
          recordCollectionId: f.collection.id,
          originalId: 'original',
          originalVersionId: f.object.originalVersionId,
          jobId: 'job',
          revision: 2,
          source: null,
        },
      } as UploadIntent;
      let object: UploadedObject | null = { ...f.object };
      if (kind === 'identity') intent.recordCollectionId = 'other';
      if (kind === 'quota') intent.quotaScope = 'other';
      if (kind === 'request')
        intent.request = { ...intent.request, recordCollectionId: 'other' };
      if (kind === 'completion-collection')
        intent.completed!.recordCollectionId = 'other';
      if (kind === 'completion-upload') intent.completed!.uploadId = 'other';
      if (kind === 'version') object.originalVersionId = 'other';
      if (kind === 'missing-object') object = null;
      if (kind === 'object-without-completion') intent.completed = null;
      if (kind === 'object-upload') object!.uploadId = 'other';
      if (kind === 'key') object!.objectKey = 'other';
      if (kind === 'size') object!.byteLength += 1;
      d.seed(f.collection, [{ intent, object }]);
      await expect(
        d.store.readCollectionMembers(f.collection.id),
      ).rejects.toMatchObject({
        status: 'unavailable',
        reason: 'upload_collection_inconsistent',
      });
      expect(d.queries.at(-1)?.text).toBe('rollback');
    },
  );
});

describe('stored collection identity at native write boundaries', () => {
  it('passes the stored identity and the native transaction to dispatch exactly once', async () => {
    const d = driver();
    const f = await facts();
    await d.store.transaction([`quota:${f.collection.id}`], async (tx) => {
      await tx.insertIntent(f.intent);
      expect(
        await tx.archiveAndDispatch(f.intent, f.object, {
          originalId: 'original',
          originalVersionId: 'version',
        }),
      ).toBe('unused');
    });
    expect(d.dispatch).toHaveBeenCalledOnce();
    const [executor, input] = d.dispatch.mock.calls[0];
    expect(executor).not.toBe(d.db);
    expect(input).toMatchObject({
      recordCollectionId: f.collection.id,
      quotaScope: f.collection.id,
      uploadId: f.intent.id,
    });
    expect(
      d.queries.find((q) =>
        q.text.startsWith('insert into "records_upload_intents"'),
      )?.text,
    ).toContain('"record_collection_id"');
    expect(d.queries.at(-1)?.text).toBe('commit');
  });

  it.each(['insert', 'archive'])(
    'refuses %s with a missing stored identity before writes or dispatch',
    async (boundary) => {
      const d = driver();
      const f = await facts();
      Reflect.deleteProperty(f.intent, 'recordCollectionId');
      await expect(
        d.store.transaction([`quota:${f.collection.id}`], async (tx) => {
          if (boundary === 'insert') await tx.insertIntent(f.intent);
          else
            await tx.archiveAndDispatch(f.intent, f.object, {
              originalId: 'original',
              originalVersionId: 'version',
            });
        }),
      ).rejects.toMatchObject({
        status: 'conflict',
        reason: 'record_collection_changed',
      });
      expect(d.dispatch).not.toHaveBeenCalled();
      expect(d.queries.some((q) => q.text.startsWith('insert'))).toBe(false);
      expect(d.queries.at(-1)?.text).toBe('rollback');
    },
  );

  it('does not accept an empty job identity after the real callback returns', async () => {
    const d = driver();
    const f = await facts();
    d.dispatch.mockResolvedValue({ jobId: ' ' });
    await expect(
      d.store.transaction([`quota:${f.collection.id}`], (tx) =>
        tx.archiveAndDispatch(f.intent, f.object, {
          originalId: 'original',
          originalVersionId: 'version',
        }),
      ),
    ).rejects.toMatchObject({
      status: 'unavailable',
      reason: 'dispatch_missing_job',
    });
    expect(d.dispatch).toHaveBeenCalledOnce();
    expect(d.queries.at(-1)?.text).toBe('rollback');
  });

  it('counts the explicit collection FK with the existing active-slot rules', async () => {
    const d = driver();
    expect(
      await d.store.transaction([], (tx) => tx.activeCount('collection', 42)),
    ).toBe(5);
    const count = d.queries.find((q) => q.text.startsWith('select count(*)'))!;
    expect(count.params).toEqual(['collection', 42]);
    expect(count.text).toContain('"record_collection_id" = $1');
    expect(count.text).toContain('"released_at" is null');
    expect(count.text).toContain('"completed" is not null');
    expect(count.text).toContain('"expires_at" > $2');
  });
});
