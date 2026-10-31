import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Pool } from 'pg';
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
