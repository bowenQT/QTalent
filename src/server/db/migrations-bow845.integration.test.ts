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
import { importDemo } from './import';
import { mapPrototypeSeed, readPrototypeSeed } from './seed';
import { fingerprintMigrationFacts } from '../../../tests/fixtures/legacy-migration-seed';

const folder = 'src/server/db/migrations';
const journal = () =>
  JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8'));
async function isolated(
  run: (connection: ReturnType<typeof createDatabase>) => Promise<void>,
) {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) throw new Error('BOW-845 requires real isolated PostgreSQL');
  const url = new URL(raw);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test') ||
    url.port === '55432'
  )
    throw new Error('Unsafe test database');
  const admin = new Pool({ connectionString: raw });
  const name = 'qtalent_m845_' + randomUUID().replaceAll('-', '') + '_test';
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
  const temporary = mkdtempSync(join(tmpdir(), 'qtalent-845-before-'));
  try {
    const old = journal();
    old.entries = old.entries.filter((row: { idx: number }) => row.idx < 9);
    expect(old.entries).toHaveLength(9);
    cpSync(join(folder, 'meta'), join(temporary, 'meta'), { recursive: true });
    writeFileSync(join(temporary, 'meta/_journal.json'), JSON.stringify(old));
    for (const row of old.entries)
      cpSync(join(folder, row.tag + '.sql'), join(temporary, row.tag + '.sql'));
    await migrate(connection.db, { migrationsFolder: temporary });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
async function emptyArrange(connection: ReturnType<typeof createDatabase>) {
  for (const table of [
    'records_arrange_inputs',
    'records_arrange_operations',
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
it('creates the two arrangement tables from the default empty-database path without fabricating inputs', async () => {
  await isolated(async (connection) => {
    await migrate(connection.db, { migrationsFolder: folder });
    await emptyArrange(connection);
    expect(
      (
        await connection.pool.query(
          'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations',
        )
      ).rows[0].n,
    ).toBe(journal().entries.length);
  });
});
it('upgrades the real seeded 0000–0008 database without changing historical facts and reruns idempotently', async () => {
  await isolated(async (connection) => {
    await previous(connection);
    await importDemo(
      connection.db,
      mapPrototypeSeed(readPrototypeSeed(process.cwd())),
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
    await emptyArrange(connection);
    await migrate(connection.db, { migrationsFolder: folder });
    expect(await fingerprintMigrationFacts(connection, before, false)).toEqual(
      before,
    );
    await emptyArrange(connection);
  });
});
