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
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './client';
import { importDemo } from './import';
import { mapPrototypeSeed, readPrototypeSeed } from './seed';
import {
  insertLegacyRows,
  readLegacyRows,
  seedVerifiedLegacyBaseline,
  fingerprintMigrationFacts,
} from '../../../tests/fixtures/legacy-migration-seed';
import {
  readEffectiveRuleVersion,
  ruleVersions,
  ruleVersionApplicability,
} from '../modules/evaluation-system';

const folder = 'src/server/db/migrations';
const journal = () =>
  JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8'));
const publishedHashes: Record<string, string> = {
  '0004_bow_899_legacy_node_backfill.sql':
    '08a9600ac91aa62d81c124ffec91cf5756d45df6a9abf8e28c722f613e03d9c6',
  '0000_secret_white_queen.sql':
    'da61c816ad84bfbe673ba0442773067b8ebf2e68945c80a86440ddbd9ae4f704',
  '0003_bow_899_evaluation_nodes.sql':
    'ec94cca5c2c4fcb7f1096fb19456154f0bfcad6542cb9304109980c5eb888fa2',
  '0001_salty_pestilence.sql':
    'a537db3a8e4900453e5574fe29b5e4ee55ed0454ee37d205d25485f77e57ee9c',
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
  'meta/0002_snapshot.json':
    'cee015182edc76d672c00ca898c5a88c2e2c8784ab401c6d68129e1e32c82230',
};
let admin: Pool;
let source: URL;
type Connection = ReturnType<typeof createDatabase>;
beforeAll(() => {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw)
    throw new Error(
      'BOW-922 migration tests require real PostgreSQL; no skips',
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
  const name = 'qtalent_m922_' + randomUUID().replaceAll('-', '') + '_test';
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
/** Reconstruct an already-published stage, never substitute generated SQL for the default migrations. */
async function stage(connection: Connection, count: number) {
  const temporary = mkdtempSync(
    join(tmpdir(), 'qtalent-b922-published-stage-'),
  );
  try {
    const previous = journal();
    previous.entries = previous.entries.filter(
      (row: { idx: number }) => row.idx < count,
    );
    expect(previous.entries).toHaveLength(count);
    cpSync(join(folder, 'meta'), join(temporary, 'meta'), { recursive: true });
    writeFileSync(
      join(temporary, 'meta/_journal.json'),
      JSON.stringify(previous),
    );
    for (const row of previous.entries)
      cpSync(join(folder, row.tag + '.sql'), join(temporary, row.tag + '.sql'));
    await migrate(connection.db, { migrationsFolder: temporary });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
async function seededPrevious(connection: Connection) {
  await stage(connection, 3);
  await seedVerifiedLegacyBaseline(connection);
  await stage(connection, 5);
}
async function journalCount(connection: Connection) {
  return (
    await connection.pool.query(
      'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations',
    )
  ).rows[0].n;
}
async function applicabilityAbsent(connection: Connection) {
  expect(
    (
      await connection.pool.query(
        "SELECT to_regclass('public.evaluation_rule_version_applicability') AS name",
      )
    ).rows[0].name,
  ).toBeNull();
}

it('keeps published 0000–0004 SQL/meta identical and applies the default migrations plus canonical seed on an empty database', async () => {
  for (const [file, hash] of Object.entries(publishedHashes))
    expect(
      createHash('sha256')
        .update(readFileSync(join(folder, file)))
        .digest('hex'),
    ).toBe(hash);
  await isolated(async (connection) => {
    await migrate(connection.db, { migrationsFolder: folder });
    expect(await journalCount(connection)).toBe(journal().entries.length);
    expect(await connection.db.select().from(ruleVersionApplicability)).toEqual(
      [],
    );
    await importDemo(
      connection.db,
      mapPrototypeSeed(readPrototypeSeed(process.cwd())),
      'Synthetic-test-password-only',
    );
    const rows = await connection.db
      .select()
      .from(ruleVersionApplicability)
      .orderBy(ruleVersionApplicability.versionId);
    expect(
      rows.map(({ versionId, category, periodId }) => ({
        versionId,
        category,
        periodId,
      })),
    ).toEqual([
      {
        versionId: 'rubric-v1',
        category: 'dimension_anchors',
        periodId: 'legacy:rubric-v1',
      },
      {
        versionId: 'xe-weekly-v1',
        category: 'xe_weekly',
        periodId: 'legacy:xe-weekly-v1',
      },
    ]);
    const before = await fingerprintMigrationFacts(
      connection,
      undefined,
      false,
    );
    await migrate(connection.db, { migrationsFolder: folder });
    expect(
      await fingerprintMigrationFacts(connection, Object.keys(before), false),
    ).toEqual(before);
  });
});

it('upgrades canonical old seeded facts through 899, classifies only the two known rules from real usage, and changes no source/score/node facts', async () => {
  await isolated(async (connection) => {
    await seededPrevious(connection);
    await insertLegacyRows(
      connection,
      ruleVersions,
      [{ id: 'unmapped-existing-v1', provenance: 'published' }],
      '0004',
    );
    const before = await fingerprintMigrationFacts(
      connection,
      undefined,
      false,
    );
    const versionColumns = ['id', 'provenance', 'sourceCommit'] as const;
    const versions = await readLegacyRows(
      connection,
      ruleVersions,
      versionColumns,
      '0004',
    );
    await migrate(connection.db, { migrationsFolder: folder });
    expect(await fingerprintMigrationFacts(connection, before, false)).toEqual(
      before,
    );
    expect(
      await readLegacyRows(connection, ruleVersions, versionColumns, '0004'),
    ).toEqual(versions);
    const rows = await connection.db
      .select()
      .from(ruleVersionApplicability)
      .orderBy(ruleVersionApplicability.versionId);
    expect(
      rows.map((row) => ({
        versionId: row.versionId,
        category: row.category,
        periodId: row.periodId,
        from: row.effectiveFrom.toISOString(),
        until: row.effectiveUntil,
      })),
    ).toEqual([
      {
        versionId: 'rubric-v1',
        category: 'dimension_anchors',
        periodId: 'legacy:rubric-v1',
        from: '2026-07-24T00:00:00.000Z',
        until: null,
      },
      {
        versionId: 'xe-weekly-v1',
        category: 'xe_weekly',
        periodId: 'legacy:xe-weekly-v1',
        from: '2026-07-24T00:00:00.000Z',
        until: null,
      },
    ]);
    expect(
      await readEffectiveRuleVersion(connection.db, {
        category: 'xe_selection',
        at: '2026-10-31T00:00:00.000Z',
      }),
    ).toMatchObject({ status: 'not_found' });
    expect(await journalCount(connection)).toBe(journal().entries.length);
  });
});

it('missing historical usage fails the full pending migration transaction, leaving old rows and journal unchanged; a corrected batch can retry', async () => {
  await isolated(async (connection) => {
    await stage(connection, 5);
    await insertLegacyRows(
      connection,
      ruleVersions,
      [{ id: 'rubric-v1', provenance: 'published' }],
      '0004',
    );
    const before = await fingerprintMigrationFacts(
      connection,
      undefined,
      false,
    );
    await expect(
      migrate(connection.db, { migrationsFolder: folder }),
    ).rejects.toThrow();
    await applicabilityAbsent(connection);
    expect(await journalCount(connection)).toBe(5);
    expect(
      await fingerprintMigrationFacts(connection, Object.keys(before), false),
    ).toEqual(before);
    await connection.pool.query('DELETE FROM evaluation_rule_versions');
    await seedVerifiedLegacyBaseline(connection);
    await migrate(connection.db, { migrationsFolder: folder });
    expect(
      await connection.db.select().from(ruleVersionApplicability),
    ).toHaveLength(2);
  });
});

it('a non-finite historical usage refuses classification and rolls back new DDL without touching the source facts', async () => {
  await isolated(async (connection) => {
    await seededPrevious(connection);
    await connection.pool.query(
      "UPDATE records_events SET occurred_on = 'infinity' WHERE id = (SELECT id FROM records_events WHERE rule_version_id = 'rubric-v1' LIMIT 1)",
    );
    const before = await fingerprintMigrationFacts(
      connection,
      undefined,
      false,
    );
    await expect(
      migrate(connection.db, { migrationsFolder: folder }),
    ).rejects.toThrow();
    await applicabilityAbsent(connection);
    expect(await journalCount(connection)).toBe(5);
    expect(
      await fingerprintMigrationFacts(connection, Object.keys(before), false),
    ).toEqual(before);
  });
});

it('preserves existing closed and restored intervals while backfilling only the other missing legacy category', async () => {
  await isolated(async (connection) => {
    await seededPrevious(connection);
    await stage(connection, 6); // committed BOW-922 structure, before its explicit data step
    await insertLegacyRows(
      connection,
      ruleVersions,
      [{ id: 'rubric-v2', provenance: 'published' }],
      '0005',
    );
    await insertLegacyRows(
      connection,
      ruleVersionApplicability,
      [
        {
          periodId: 'retained:v1:first',
          versionId: 'rubric-v1',
          category: 'dimension_anchors',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          effectiveUntil: new Date('2026-06-01T00:00:00.000Z'),
        },
        {
          periodId: 'retained:v2',
          versionId: 'rubric-v2',
          category: 'dimension_anchors',
          effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
          effectiveUntil: new Date('2026-09-01T00:00:00.000Z'),
        },
        {
          periodId: 'retained:v1:restored',
          versionId: 'rubric-v1',
          category: 'dimension_anchors',
          effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
        },
      ],
      '0005',
    );
    const intervalColumns = [
      'periodId',
      'versionId',
      'category',
      'effectiveFrom',
      'effectiveUntil',
    ] as const;
    const before = await readLegacyRows(
      connection,
      ruleVersionApplicability,
      intervalColumns,
      '0005',
    );
    await migrate(connection.db, { migrationsFolder: folder });
    expect(
      (
        await readLegacyRows(
          connection,
          ruleVersionApplicability,
          intervalColumns,
          '0005',
        )
      ).filter((row) => row.category === 'dimension_anchors'),
    ).toEqual(before);
    expect(
      await connection.db
        .select()
        .from(ruleVersionApplicability)
        .where(eq(ruleVersionApplicability.category, 'xe_weekly')),
    ).toHaveLength(1);
    for (const [at, versionId] of [
      ['2026-05-31T23:59:59.999Z', 'rubric-v1'],
      ['2026-06-01T00:00:00.000Z', 'rubric-v2'],
      ['2026-09-01T00:00:00.000Z', 'rubric-v1'],
    ])
      expect(
        await readEffectiveRuleVersion(connection.db, {
          category: 'dimension_anchors',
          at,
        }),
      ).toMatchObject({ status: 'success', version: { versionId } });
  });
});
