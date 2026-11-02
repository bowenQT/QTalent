import { randomUUID } from 'node:crypto';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './client';
import {
  fingerprintMigrationFacts,
  seedVerifiedLegacyBaseline,
} from '../../../tests/fixtures/legacy-migration-seed';

const folder = 'src/server/db/migrations';
const journal = () =>
  JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8'));
async function isolated(
  run: (connection: ReturnType<typeof createDatabase>) => Promise<void>,
) {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) throw new Error('BOW-873 requires real isolated PostgreSQL');
  const url = new URL(raw);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test') ||
    url.port === '55432'
  )
    throw new Error('Unsafe test database');
  const admin = new Pool({ connectionString: raw });
  const name = 'qtalent_m873_' + randomUUID().replaceAll('-', '') + '_test';
  await admin.query('CREATE DATABASE "' + name + '"');
  url.pathname = '/' + name;
  const connection = createDatabase(url.toString());
  try {
    await run(connection);
  } finally {
    await connection.pool.end();
    await admin.query('DROP DATABASE "' + name + '"');
    await admin.end();
  }
}
async function previous(connection: ReturnType<typeof createDatabase>) {
  const temporary = mkdtempSync(join(tmpdir(), 'qtalent-873-before-'));
  try {
    const old = journal();
    old.entries = old.entries.filter((row: { idx: number }) => row.idx < 10);
    expect(old.entries).toHaveLength(10);
    cpSync(join(folder, 'meta'), join(temporary, 'meta'), { recursive: true });
    writeFileSync(join(temporary, 'meta/_journal.json'), JSON.stringify(old));
    for (const row of old.entries)
      cpSync(join(folder, row.tag + '.sql'), join(temporary, row.tag + '.sql'));
    await migrate(connection.db, { migrationsFolder: temporary });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
async function emptyUploads(connection: ReturnType<typeof createDatabase>) {
  for (const table of [
    'records_upload_collections',
    'records_upload_intents',
    'records_upload_objects',
    'records_upload_read_tickets',
  ]) {
    expect(
      (
        await connection.pool.query(
          'SELECT count(*)::int AS n FROM "' + table + '"',
        )
      ).rows[0].n,
    ).toBe(0);
  }
}
it('creates the four upload tables from the default empty-database path without fabricating upload or authorization facts', async () => {
  await isolated(async (connection) => {
    await migrate(connection.db, { migrationsFolder: folder });
    await emptyUploads(connection);
    expect(
      (
        await connection.pool.query(
          'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations',
        )
      ).rows[0].n,
    ).toBe(journal().entries.length);
  });
});
it('upgrades the real seeded 0000–0009 database without changing historical facts and reruns idempotently', async () => {
  await isolated(async (connection) => {
    await previous(connection);
    // The current importer writes current columns; an old database is seeded
    // through the pinned pre-899 baseline instead.
    await seedVerifiedLegacyBaseline(
      connection,
      'Synthetic-test-password-only',
    );
    const before = await fingerprintMigrationFacts(
      connection,
      undefined,
      false,
    );
    await migrate(connection.db, { migrationsFolder: folder });
    expect(await fingerprintMigrationFacts(connection, before, false)).toEqual(
      before,
    );
    await emptyUploads(connection);
    await migrate(connection.db, { migrationsFolder: folder });
    expect(await fingerprintMigrationFacts(connection, before, false)).toEqual(
      before,
    );
    await emptyUploads(connection);
  });
});
