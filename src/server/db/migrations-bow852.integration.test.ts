import { createHash, randomUUID } from 'node:crypto';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './client';
import { importDemo } from './import';
import { mapPrototypeSeed, readPrototypeSeed } from './seed';
import {
  fingerprintMigrationFacts,
  seedVerifiedLegacyBaseline,
} from '../../../tests/fixtures/legacy-migration-seed';
import {
  demandRoots,
  demandVersions,
  demandOperations,
} from '../modules/staffing/demand/schema';

const folder = 'src/server/db/migrations';
const journal = () =>
  JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8'));
const publishedHashes: Record<string, string> = {
  '0004_bow_899_legacy_node_backfill.sql':
    '08a9600ac91aa62d81c124ffec91cf5756d45df6a9abf8e28c722f613e03d9c6',
  '0000_secret_white_queen.sql':
    'da61c816ad84bfbe673ba0442773067b8ebf2e68945c80a86440ddbd9ae4f704',
  '0005_bow_922_rule_applicability.sql':
    'e6c6d2ce7aeeec4123a0adfe00d33294e0173bfe3bea8bf2f30b47042e54de8b',
  '0003_bow_899_evaluation_nodes.sql':
    'ec94cca5c2c4fcb7f1096fb19456154f0bfcad6542cb9304109980c5eb888fa2',
  '0001_salty_pestilence.sql':
    'a537db3a8e4900453e5574fe29b5e4ee55ed0454ee37d205d25485f77e57ee9c',
  '0006_bow_922_legacy_rule_applicability.sql':
    '06c4755c68105deae0a5356250be39123efe50e0782e1bdf219131e149a25daf',
  '0002_cold_secret_warriors.sql':
    '9be0312123def03b18f176cb18a69918271155f0e34eb02d2b63ff451cddf3f4',
  'meta/0003_snapshot.json':
    '647d20d01b0f59f7f501485cf3c07be67f0b0c1ca7a6952138a2afb81dbf6b4a',
  'meta/0004_snapshot.json':
    'e76a1903d3ca96ef86a79459299512390cb2f1650abe5eb2efb03471fa318586',
  'meta/0000_snapshot.json':
    '8251999426a2cc7a1783d3c99828f1c142968210d220cd5373532fa411987b8d',
  'meta/0001_snapshot.json':
    'b966babb23cc6c71cf63d7db640f95e3c0947c75934843ece5fbcadea1dced0a',
  'meta/0005_snapshot.json':
    'fd14f50f92af1d43914596acb8a1036d865771c027c8bf268bc9819d0fe4ce20',
  'meta/0002_snapshot.json':
    'cee015182edc76d672c00ca898c5a88c2e2c8784ab401c6d68129e1e32c82230',
  'meta/0006_snapshot.json':
    '33ce16ba696e69eafe0b748029fbab2ccd3df7ca006f9479b023c2176d13a666',
};
const tables = [
  'staffing_demands',
  'staffing_demand_versions',
  'staffing_demand_operations',
];
const collisionTable = 'staffing_demand_versions';
let source: URL;
let admin: Pool;
type Connection = ReturnType<typeof createDatabase>;
beforeAll(() => {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw)
    throw new Error(
      'BOW-852 migration tests require real PostgreSQL; no skips',
    );
  source = new URL(raw);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname) ||
    !source.pathname.endsWith('_test') ||
    source.port === '55432'
  )
    throw new Error(
      'Only the authorized isolated loopback test database is allowed',
    );
  admin = new Pool({ connectionString: raw, max: 3 });
});
afterAll(async () => {
  await admin?.end();
});
async function isolated(run: (connection: Connection) => Promise<void>) {
  const name = 'qtalent_m852_' + randomUUID().replaceAll('-', '') + '_test';
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(source);
  url.pathname = '/' + name;
  const connection = createDatabase(url.toString());
  try {
    await run(connection);
  } finally {
    await connection.pool.end();
    await admin.query(`DROP DATABASE "${name}"`);
  }
}
/** Only copy the published pre-852 stage; all ordinary verification uses the committed full directory. */
async function previous(connection: Connection, count: 3 | 7 = 7) {
  const temporary = mkdtempSync(
    join(tmpdir(), 'qtalent-b852-published-stage-'),
  );
  try {
    const old = journal();
    old.entries = old.entries.filter((row: { idx: number }) => row.idx < count);
    expect(old.entries).toHaveLength(count);
    cpSync(join(folder, 'meta'), join(temporary, 'meta'), { recursive: true });
    writeFileSync(join(temporary, 'meta/_journal.json'), JSON.stringify(old));
    for (const row of old.entries)
      cpSync(join(folder, row.tag + '.sql'), join(temporary, row.tag + '.sql'));
    await migrate(connection.db, { migrationsFolder: temporary });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
async function countJournal(connection: Connection) {
  return (
    await connection.pool.query(
      'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations',
    )
  ).rows[0].n;
}
async function emptyDemands(connection: Connection) {
  expect(await connection.db.select().from(demandRoots)).toEqual([]);
  expect(await connection.db.select().from(demandVersions)).toEqual([]);
  expect(await connection.db.select().from(demandOperations)).toEqual([]);
}
it('keeps published 0000–0006 SQL/meta unchanged and creates the real demand tables from the default empty-database path', async () => {
  for (const [file, hash] of Object.entries(publishedHashes))
    expect(
      createHash('sha256')
        .update(readFileSync(join(folder, file)))
        .digest('hex'),
    ).toBe(hash);
  await isolated(async (connection) => {
    await migrate(connection.db, { migrationsFolder: folder });
    expect(await countJournal(connection)).toBe(journal().entries.length);
    await emptyDemands(connection);
    await importDemo(
      connection.db,
      mapPrototypeSeed(readPrototypeSeed(process.cwd())),
      'Synthetic-test-password-only',
    );
    await emptyDemands(connection);
  });
});
it('upgrades the actual pre-852 canonical seeded schema without changing any rule, score, source, identity or node fact, and reruns idempotently', async () => {
  await isolated(async (connection) => {
    // Seed the verified immutable facts through the actual historical schema.
    // The current importer is only used again after all current migrations exist.
    await previous(connection, 3);
    await seedVerifiedLegacyBaseline(
      connection,
      'Synthetic-test-password-only',
    );
    await previous(connection);
    const before = await fingerprintMigrationFacts(
      connection,
      undefined,
      false,
    );
    await migrate(connection.db, { migrationsFolder: folder });
    expect(await fingerprintMigrationFacts(connection, before, false)).toEqual(
      before,
    );
    await emptyDemands(connection);
    const after = await fingerprintMigrationFacts(connection, undefined, false);
    await migrate(connection.db, { migrationsFolder: folder });
    await importDemo(
      connection.db,
      mapPrototypeSeed(readPrototypeSeed(process.cwd())),
      'Synthetic-test-password-only',
    );
    expect(
      await fingerprintMigrationFacts(connection, Object.keys(after), false),
    ).toEqual(after);
    expect(await countJournal(connection)).toBe(journal().entries.length);
  });
});
it('a conflicting unjournaled demand table rolls back every pending DDL/journal write and leaves the old schema and sentinel intact', async () => {
  await isolated(async (connection) => {
    await previous(connection);
    await connection.pool.query(
      `CREATE TABLE "${collisionTable}" (sentinel text PRIMARY KEY)`,
    );
    await connection.pool.query(
      `INSERT INTO "${collisionTable}" VALUES ('synthetic-existing-row')`,
    );
    const before = await fingerprintMigrationFacts(
      connection,
      undefined,
      false,
    );
    await expect(
      migrate(connection.db, { migrationsFolder: folder }),
    ).rejects.toThrow();
    expect(await countJournal(connection)).toBe(7);
    expect(
      await fingerprintMigrationFacts(connection, Object.keys(before), false),
    ).toEqual(before);
    for (const table of tables.filter((name) => name !== collisionTable))
      expect(
        (
          await connection.pool.query('SELECT to_regclass($1) AS name', [
            'public.' + table,
          ])
        ).rows[0].name,
      ).toBeNull();
    await connection.pool.query(`DROP TABLE "${collisionTable}"`);
    await migrate(connection.db, { migrationsFolder: folder });
    await emptyDemands(connection);
  });
});
