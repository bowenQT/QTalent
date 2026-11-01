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
import { eq, getTableColumns, getTableName } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './client';
import { importDemo } from './import';
import { mapPrototypeSeed, readPrototypeSeed } from './seed';
import * as directory from '../modules/directory/schema';
import * as programs from '../modules/programs/schema';
import * as staffing from '../modules/staffing/schema';
import * as rules from '../modules/evaluation-system/schema';
import * as records from '../modules/records/schema';
import * as talent from '../modules/talent/schema';
import { planLegacyEvaluationNodes } from '../modules/programs/legacy-node-mapping';

const folder = 'src/server/db/migrations';
const password = 'Synthetic-test-password-only';
let admin: Pool;
let source: URL;
type Connection = ReturnType<typeof createDatabase>;
const mapped = () => mapPrototypeSeed(readPrototypeSeed(process.cwd()));
beforeAll(() => {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw)
    throw new Error(
      'BOW-899 migration tests require real PostgreSQL; no skips',
    );
  source = new URL(raw);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname) ||
    !source.pathname.endsWith('_test') ||
    source.port === '55432'
  )
    throw new Error(
      'Only the authorized loopback isolated test database is allowed',
    );
  admin = new Pool({ connectionString: raw, max: 3 });
});
afterAll(async () => {
  await admin?.end();
});
async function isolated(run: (connection: Connection) => Promise<void>) {
  const name = 'qtalent_m899_' + randomUUID().replaceAll('-', '') + '_test';
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
async function previous(connection: Connection) {
  const temporary = mkdtempSync(join(tmpdir(), 'qtalent-b899-old-migrations-'));
  try {
    const journal = JSON.parse(
      readFileSync(join(folder, 'meta/_journal.json'), 'utf8'),
    );
    journal.entries = journal.entries.filter(
      (row: { idx: number }) => row.idx < 3,
    );
    cpSync(join(folder, 'meta'), join(temporary, 'meta'), { recursive: true });
    writeFileSync(
      join(temporary, 'meta/_journal.json'),
      JSON.stringify(journal),
    );
    for (const row of journal.entries)
      cpSync(join(folder, row.tag + '.sql'), join(temporary, row.tag + '.sql'));
    await migrate(connection.db, { migrationsFolder: temporary });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
/** Insert the verified baseline into the OLD physical schema, without calling the new seed importer. */
async function legacySeed(connection: Connection) {
  const seed = mapped();
  async function insert(table: PgTable, input: readonly object[]) {
    if (!input.length) return;
    const columns = getTableColumns(table);
    const rows = input as Record<string, unknown>[];
    const keys = [...new Set(rows.flatMap(Object.keys))].filter(
      (key) => key in columns && key !== 'evaluationNodeId',
    );
    for (let start = 0; start < rows.length; start += 100) {
      const values: unknown[] = [];
      const placeholders = rows.slice(start, start + 100).map(
        (row) =>
          '(' +
          keys
            .map((key) => {
              const value = row[key];
              if (value === undefined) return 'DEFAULT';
              values.push(
                columns[key].dataType === 'json' && value !== null
                  ? JSON.stringify(value)
                  : value,
              );
              return '$' + values.length;
            })
            .join(',') +
          ')',
      );
      await connection.pool.query(
        `INSERT INTO "${getTableName(table)}" (${keys.map((key) => '"' + columns[key].name + '"').join(',')}) VALUES ${placeholders.join(',')}`,
        values,
      );
    }
  }
  await insert(
    directory.organizations,
    seed.organizations.map((row) => ({ ...row, shortName: row.name })),
  );
  await insert(directory.people, seed.people);
  await insert(
    directory.employments,
    seed.people.map((row) => ({
      id: 'demo-employment-' + row.id,
      personId: row.id,
      organizationId: row.organizationId,
      validFrom: row.joined,
      validTo: null,
    })),
  );
  await insert(
    directory.accountBindings,
    seed.accounts.map((row) => ({
      accountId: row.id,
      personId: row.personId,
      isSystemAdmin: row.isSystemAdmin,
    })),
  );
  await insert(programs.cohorts, seed.cohorts);
  await insert(
    directory.grants,
    seed.grants.map((row, i) => ({ ...row, id: 'demo-grant-' + i })),
  );
  await insert(
    programs.enrollments,
    seed.enrollments.map((row, i) => ({ ...row, id: 'demo-enrollment-' + i })),
  );
  await insert(
    programs.assignments,
    seed.assignments.map((row, i) => ({ ...row, id: 'demo-assignment-' + i })),
  );
  await insert(staffing.projects, seed.projects);
  await insert(staffing.members, seed.members);
  await insert(staffing.memberLogs, seed.memberLogs);
  await insert(rules.dimensions, seed.evidence.dimensions);
  await insert(rules.ruleVersions, seed.evidence.ruleVersions);
  await insert(rules.anchors, seed.evidence.anchors);
  await insert(records.importSnapshots, seed.evidence.snapshots);
  for (const [table, rows] of [
    [records.originals, seed.evidence.originals],
    [records.originalVersions, seed.evidence.originalVersions],
    [records.fragments, seed.evidence.fragments],
    [records.events, seed.evidence.events],
    [records.eventParticipants, seed.evidence.eventParticipants],
    [records.eventSources, seed.evidence.eventSources],
    [records.statements, seed.evidence.statements],
    [talent.aiSuggestions, seed.evidence.aiSuggestions],
    [talent.confirmations, seed.evidence.confirmations],
    [talent.scoreReviews, seed.evidence.scoreReviews],
    [records.historicalEvaluations, seed.evidence.historicalEvaluations],
    [records.historicalParticipants, seed.evidence.historicalParticipants],
  ] as const)
    await insert(table, rows);
  return seed;
}
async function legacyFingerprint(
  connection: Connection,
  names?: string[],
  omitNode = true,
) {
  const tables =
    names ??
    (
      await connection.pool.query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
      )
    ).rows.map((row) => row.tablename);
  const result: Record<string, unknown> = {};
  for (const name of tables) {
    const row = omitNode
      ? "(to_jsonb(t) - 'evaluation_node_id')"
      : 'to_jsonb(t)';
    const snapshot = await connection.pool.query(
      `SELECT count(*)::int AS count, md5(coalesce(string_agg(${row}::text, '' ORDER BY ${row}::text), '')) AS digest FROM "${name}" AS t`,
    );
    result[name] = snapshot.rows[0];
  }
  return result;
}
async function legacyPlan(connection: Connection) {
  return planLegacyEvaluationNodes({
    cohorts: await connection.db.select().from(programs.cohorts),
    people: await connection.db.select().from(directory.people),
    enrollments: await connection.db.select().from(programs.enrollments),
    assignments: await connection.db.select().from(programs.assignments),
    projects: await connection.db.select().from(staffing.projects),
    events: await connection.db
      .select({
        id: records.events.id,
        personId: records.events.personId,
        projectId: records.events.projectId,
        occurredOn: records.events.occurredOn,
      })
      .from(records.events),
  });
}
it('keeps all three published SQL migrations byte-identical and migrates an empty database with real node/subject constraints', async () => {
  const hashes = {
    '0000_secret_white_queen.sql':
      'da61c816ad84bfbe673ba0442773067b8ebf2e68945c80a86440ddbd9ae4f704',
    '0001_salty_pestilence.sql':
      'a537db3a8e4900453e5574fe29b5e4ee55ed0454ee37d205d25485f77e57ee9c',
    '0002_cold_secret_warriors.sql':
      '9be0312123def03b18f176cb18a69918271155f0e34eb02d2b63ff451cddf3f4',
  };
  for (const [file, hash] of Object.entries(hashes))
    expect(
      createHash('sha256')
        .update(readFileSync(join(folder, file)))
        .digest('hex'),
    ).toBe(hash);
  await isolated(async (connection) => {
    await migrate(connection.db, { migrationsFolder: folder });
    expect(
      (
        await connection.pool.query(
          'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations',
        )
      ).rows[0].n,
    ).toBe(5);
    expect(await connection.db.select().from(programs.evaluationNodes)).toEqual(
      [],
    );
    await legacySeed(connection);
    await connection.db.insert(programs.evaluationNodes).values({
      id: 'synthetic-interview',
      name: '演示面试',
      kind: 'interview',
    });
    await expect(
      connection.db.insert(programs.evaluationRelations).values({
        id: 'invalid',
        evaluationNodeId: 'synthetic-interview',
        personId: mapped().people[0].id,
        evaluatorId: mapped().people[1].id,
        kind: 'interviewer',
        validFrom: '2026-01-01T00:00:00.000Z',
      }),
    ).rejects.toThrow();
    const event = mapped().evidence.events[0];
    await expect(
      connection.db
        .update(records.events)
        .set({ evaluationNodeId: 'synthetic-interview' })
        .where(eq(records.events.id, event.id)),
    ).rejects.toThrow();
    await connection.db.insert(programs.evaluationNodeSubjects).values({
      evaluationNodeId: 'synthetic-interview',
      personId: event.personId,
    });
    await connection.db
      .update(records.events)
      .set({ evaluationNodeId: 'synthetic-interview' })
      .where(eq(records.events.id, event.id));
  });
}, 30_000);
it('upgrades a genuinely pre-899 seeded database using only unique historical facts, preserving every existing score/source/scale and revocation', async () => {
  await isolated(async (connection) => {
    await previous(connection);
    const seed = await legacySeed(connection);
    const first = seed.evidence.events[0];
    await connection.db
      .insert(programs.cohorts)
      .values({ id: 'synthetic-overlap', name: '演示重叠期次' });
    await connection.db.insert(programs.enrollments).values({
      id: 'synthetic-overlap-membership',
      cohortId: 'synthetic-overlap',
      personId: first.personId,
      confirmed: true,
      validFrom: '2020-01-01',
    });
    // Old schema has no evaluation_node_id: use its physical columns deliberately.
    await connection.pool.query(
      'INSERT INTO records_events (id, person_id, recorder_id, occurred_on, title, situation, behavior, impact, project_id, rule_version_id, demo) SELECT $1, person_id, recorder_id, occurred_on, title, situation, behavior, impact, NULL, rule_version_id, demo FROM records_events WHERE id = $2',
      ['synthetic-ambiguous', first.id],
    );
    await connection.pool.query(
      'INSERT INTO records_events (id, person_id, recorder_id, occurred_on, title, situation, behavior, impact, project_id, rule_version_id, demo) SELECT $1, person_id, recorder_id, $3::date, title, situation, behavior, impact, NULL, rule_version_id, demo FROM records_events WHERE id = $2',
      ['synthetic-no-history', first.id, '1900-01-01'],
    );
    await connection.db
      .update(programs.assignments)
      .set({ revokedAt: '2026-06-01' })
      .where(eq(programs.assignments.id, 'demo-assignment-0'));
    const before = await legacyFingerprint(connection);
    const plan = await legacyPlan(connection);
    await migrate(connection.db, { migrationsFolder: folder });
    expect(await legacyFingerprint(connection, Object.keys(before))).toEqual(
      before,
    );
    expect(await connection.db.select().from(programs.evaluationNodes)).toEqual(
      expect.arrayContaining(plan.nodes),
    );
    expect(
      await connection.db.select().from(programs.evaluationNodeSubjects),
    ).toHaveLength(plan.subjects.length);
    const relations = await connection.db
      .select()
      .from(programs.evaluationRelations);
    expect(relations).toHaveLength(plan.relations.length);
    for (const expected of plan.relations) {
      const actual = relations.find((row) => row.id === expected.id)!;
      expect({
        ...actual,
        validFrom: new Date(actual.validFrom).toISOString(),
        validTo: actual.validTo && new Date(actual.validTo).toISOString(),
        revokedAt: actual.revokedAt && new Date(actual.revokedAt).toISOString(),
      }).toEqual(expected);
    }
    const bindings = new Map(
      plan.eventBindings.map((row) => [row.eventId, row.evaluationNodeId]),
    );
    const events = await connection.db.select().from(records.events);
    for (const event of events)
      expect(event.evaluationNodeId).toBe(bindings.get(event.id) ?? null);
    expect(
      events.find((row) => row.id === 'synthetic-ambiguous')?.evaluationNodeId,
    ).toBeNull();
    expect(
      events.find((row) => row.id === 'synthetic-no-history')?.evaluationNodeId,
    ).toBeNull();
    const historical = await connection.db
      .select()
      .from(records.historicalEvaluations);
    for (const row of historical)
      expect(row.evaluationNodeId).toBe(
        row.kind === '训练营周评'
          ? (bindings.get(row.sourceRecordId) ?? null)
          : null,
      );
    expect(
      historical.filter(
        (row) => row.kind !== '训练营周评' && row.evaluationNodeId !== null,
      ),
    ).toEqual([]);
    const after = await legacyFingerprint(connection);
    await migrate(connection.db, { migrationsFolder: folder });
    expect(await legacyFingerprint(connection, Object.keys(after))).toEqual(
      after,
    );
    expect(
      (
        await connection.pool.query(
          'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations',
        )
      ).rows[0].n,
    ).toBe(5);
  });
}, 30_000);
it('rolls back the complete schema and journal transition if backfilling an existing event fails', async () => {
  await isolated(async (connection) => {
    await previous(connection);
    await legacySeed(connection);
    const before = await legacyFingerprint(connection);
    await connection.pool.query(
      "CREATE FUNCTION synthetic_reject_node_binding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic migration backfill failure'; END; $$",
    );
    await connection.pool.query(
      'CREATE TRIGGER synthetic_reject_node_binding BEFORE UPDATE ON records_events FOR EACH ROW EXECUTE FUNCTION synthetic_reject_node_binding()',
    );
    await expect(
      migrate(connection.db, { migrationsFolder: folder }),
    ).rejects.toThrow();
    expect(
      (
        await connection.pool.query(
          "SELECT to_regclass('public.programs_evaluation_nodes') AS table_name",
        )
      ).rows[0].table_name,
    ).toBeNull();
    expect(
      (
        await connection.pool.query(
          "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='records_events' AND column_name='evaluation_node_id'",
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await connection.pool.query(
          'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations',
        )
      ).rows[0].n,
    ).toBe(3);
    expect(await legacyFingerprint(connection, Object.keys(before))).toEqual(
      before,
    );
  });
}, 30_000);
it('binds a fresh verified seed once and keeps explicitly revoked node relations revoked on every seed rerun', async () => {
  await isolated(async (connection) => {
    await migrate(connection.db, { migrationsFolder: folder });
    await importDemo(connection.db, mapped(), password);
    const plan = await legacyPlan(connection);
    expect(
      await connection.db.select().from(programs.evaluationNodes),
    ).toHaveLength(plan.nodes.length);
    expect(
      await connection.db.select().from(programs.evaluationRelations),
    ).toHaveLength(plan.relations.length);
    const bindings = new Map(
      plan.eventBindings.map((row) => [row.eventId, row.evaluationNodeId]),
    );
    for (const row of await connection.db.select().from(records.events))
      expect(row.evaluationNodeId).toBe(bindings.get(row.id) ?? null);
    const history = await connection.db
      .select()
      .from(records.historicalEvaluations);
    for (const row of history)
      expect(row.evaluationNodeId).toBe(
        row.kind === '训练营周评'
          ? (bindings.get(row.sourceRecordId) ?? null)
          : null,
      );
    const detached = history.find((row) => row.evaluationNodeId !== null)!;
    await connection.db
      .update(records.events)
      .set({ evaluationNodeId: null })
      .where(eq(records.events.id, detached.sourceRecordId));
    await connection.db
      .update(records.historicalEvaluations)
      .set({ evaluationNodeId: null })
      .where(eq(records.historicalEvaluations.id, detached.id));
    const relation = plan.relations[0];
    const revokedAt = '2026-07-01T12:00:00.000Z';
    await connection.db
      .update(programs.evaluationRelations)
      .set({ revokedAt })
      .where(eq(programs.evaluationRelations.id, relation.id));
    const before = await legacyFingerprint(connection, undefined, false);
    await importDemo(connection.db, mapped(), password);
    expect(
      await legacyFingerprint(connection, Object.keys(before), false),
    ).toEqual(before);
    const actual = await connection.db
      .select()
      .from(programs.evaluationRelations)
      .where(eq(programs.evaluationRelations.id, relation.id));
    expect(new Date(actual[0].revokedAt!).toISOString()).toBe(revokedAt);
  });
}, 30_000);
