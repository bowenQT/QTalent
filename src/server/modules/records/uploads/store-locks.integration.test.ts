import { fixture } from '../../../../../tests/fixtures/upload-fake';
import { createUploadService } from './service';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, type DbExecutor } from '../../../db/client';
import { originals } from '../schema';
import { createPostgresUploadStore, lockUploadCollection } from './store';

let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
let created = false;
const name = `qtalent_upload_locks_${randomUUID().replaceAll('-', '')}_test`;
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
  // Only already-published migrations. No push-schema, generated test migration,
  // or handwritten upload-table DDL bypasses the parent's migration sequence.
  await migrate(connection.db, {
    migrationsFolder: 'src/server/db/migrations',
  });
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
function store() {
  return createPostgresUploadStore(connection!.db, async () => {
    throw new Error('No jobs in lock-only verification');
  });
}
async function tryLock(tx: DbExecutor, key: string) {
  const result = await tx.execute<{ locked: boolean }>(
    sql`select pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) as locked`,
  );
  return result.rows[0].locked;
}
it('holds the collection lock on the real transaction until its callback completes', async () => {
  const key = `quota:${randomUUID()}`;
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const running = store().transaction([key], async (tx) => {
    expect(tx.executor).toBeDefined();
    entered();
    await gate;
  });
  await ready;
  try {
    expect(await connection!.db.transaction((tx) => tryLock(tx, key))).toBe(
      false,
    );
  } finally {
    release();
    await running;
  }
  expect(await connection!.db.transaction((tx) => tryLock(tx, key))).toBe(true);
});
it('rolls back writes and releases its collection lock after a callback fails', async () => {
  const id = randomUUID();
  const key = `quota:${randomUUID()}`;
  await expect(
    store().transaction([key], async (tx) => {
      await tx
        .executor!.insert(originals)
        .values({ id, title: 'Synthetic rollback verification' });
      throw new Error('synthetic rollback');
    }),
  ).rejects.toThrow('synthetic rollback');
  expect(
    await connection!.db.select().from(originals).where(eq(originals.id, id)),
  ).toHaveLength(0);
  expect(await connection!.db.transaction((tx) => tryLock(tx, key))).toBe(true);
});
it('commits callback writes through the exact executor passed to the adapter', async () => {
  const id = randomUUID();
  await store().transaction([`quota:${id}`], async (tx) => {
    await tx
      .executor!.insert(originals)
      .values({ id, title: 'Synthetic committed original' });
  });
  expect(
    await connection!.db.select().from(originals).where(eq(originals.id, id)),
  ).toMatchObject([{ id, title: 'Synthetic committed original' }]);
});
it('uses the same collection lock for the 846 save bridge and upload quota operations', async () => {
  const id = randomUUID();
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const save = connection!.db.transaction(async (tx) => {
    await lockUploadCollection(tx, id);
    entered();
    await gate;
  });
  await ready;
  try {
    expect(
      await connection!.db.transaction((tx) => tryLock(tx, `quota:${id}`)),
    ).toBe(false);
  } finally {
    release();
    await save;
  }
  expect(
    await connection!.db.transaction((tx) => tryLock(tx, `quota:${id}`)),
  ).toBe(true);
});

it('waits on the exact 846 collection fence before completion rechecks current authorization', async () => {
  const f = fixture();
  const original = createUploadService(f.options);
  const grant = await original.request('account', f.request);
  await f.put(grant.objectKey);
  const fakeTx = await f.options.store.transaction([], async (tx) => tx);
  // Only payload storage is a unit boundary here; the advisory fence is the
  // actual PostgreSQL store and the actual 846 lock helper, not a fake mutex.
  const service = createUploadService({
    ...f.options,
    store: {
      transaction(locks, work) {
        return store().transaction(locks, (realTx) =>
          work({ ...fakeTx, executor: realTx.executor }),
        );
      },
    },
  });
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const save = connection!.db.transaction(async (tx) => {
    await lockUploadCollection(tx, f.request.recordCollectionId);
    entered();
    await held;
  });
  await ready;
  const pending = service
    .complete('account', {
      uploadId: grant.uploadId,
      receiptRef: 'notice',
      operationId: 'complete',
      expectedRevision: 1,
    })
    .then(
      (value) => ({ value, error: null }),
      (error: unknown) => ({ value: null, error }),
    );
  try {
    await vi.waitFor(
      async () => {
        const waiting = await admin!.query(
          'SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1 AND wait_event_type=$2',
          [name, 'Lock'],
        );
        expect(waiting.rows[0].n).toBeGreaterThan(0);
      },
      { interval: 20, timeout: 2000 },
    );
    f.deny();
  } finally {
    release();
    await save;
  }
  const result = await pending;
  expect(result.value).toBeNull();
  expect(result.error).toMatchObject({ status: 'forbidden' });
  expect(f.snapshot().objects).toHaveLength(0);
  expect(f.snapshot().jobs).toHaveLength(0);
});

it('reloads lock-protected facts under Read Committed even when the connection default is Repeatable Read', async () => {
  const source = new URL(process.env.TEST_DATABASE_URL!);
  source.pathname = '/' + name;
  const pool = new Pool({ connectionString: source.toString(), max: 1 });
  const isolated = { pool, db: drizzle(pool) };
  try {
    await pool.query(
      "SET SESSION default_transaction_isolation TO 'repeatable read'",
    );
    const configured = await isolated.db.execute<{
      default_transaction_isolation: string;
    }>(sql`show default_transaction_isolation`);
    expect(configured.rows[0].default_transaction_isolation).toBe(
      'repeatable read',
    );
    const id = randomUUID();
    const collectionId = randomUUID();
    await connection!.db
      .insert(originals)
      .values({ id, title: 'Synthetic scope before' });
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocker = connection!.db.transaction(async (tx) => {
      await lockUploadCollection(tx, collectionId);
      entered();
      await held;
    });
    await ready;
    const read = createPostgresUploadStore(isolated.db, async () => {
      throw new Error('No dispatch in isolation verification');
    }).transaction([`quota:${collectionId}`], async (tx) => {
      const [row] = await tx
        .executor!.select()
        .from(originals)
        .where(eq(originals.id, id));
      return row.title;
    });
    try {
      await vi.waitFor(
        async () => {
          const waiting = await admin!.query(
            'SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1 AND wait_event_type=$2',
            [name, 'Lock'],
          );
          expect(waiting.rows[0].n).toBeGreaterThan(0);
        },
        { interval: 20, timeout: 2000 },
      );
      await connection!.db
        .update(originals)
        .set({ title: 'Synthetic current scope' })
        .where(eq(originals.id, id));
    } finally {
      release();
      await blocker;
    }
    expect(await read).toBe('Synthetic current scope');
  } finally {
    await isolated.pool.end();
  }
});
