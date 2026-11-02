/** Canonical pseudonym facts in the pre-899 physical schema; migration tests only. */
import { hashPassword } from 'better-auth/crypto';
import { user, account } from '../../src/server/auth/schema';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTableColumns, getTableName } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { createDatabase } from '../../src/server/db/client';
import { mapPrototypeSeed, readPrototypeSeed } from '../../src/server/db/seed';
import * as directory from '../../src/server/modules/directory/schema';
import * as programs from '../../src/server/modules/programs/schema';
import * as staffing from '../../src/server/modules/staffing/schema';
import * as rules from '../../src/server/modules/evaluation-system/schema';
import * as records from '../../src/server/modules/records/schema';
import * as talent from '../../src/server/modules/talent/schema';
type Connection = ReturnType<typeof createDatabase>;

/** The pre-899 physical columns, pinned to the last snapshot before 899.
 * Later migrations only add columns, so these exist in every newer database;
 * columns added later take their defaults when an old database is upgraded. */
const legacyColumns = new Map(
  Object.values(
    JSON.parse(
      readFileSync(
        join(process.cwd(), 'src/server/db/migrations/meta/0002_snapshot.json'),
        'utf8',
      ),
    ).tables as Record<
      string,
      { name: string; columns: Record<string, unknown> }
    >,
  ).map((table) => [table.name, new Set(Object.keys(table.columns))]),
);
function legacyKeys(table: PgTable) {
  const columns = getTableColumns(table);
  const known = legacyColumns.get(getTableName(table));
  if (!known) throw new Error('Not a pre-899 table: ' + getTableName(table));
  return Object.keys(columns).filter((key) => known.has(columns[key].name));
}

/** Read an old database through its pre-899 columns only. */
export async function readLegacyRows<T extends PgTable>(
  connection: Connection,
  table: T,
): Promise<T['$inferSelect'][]> {
  const columns = getTableColumns(table);
  const selection = Object.fromEntries(
    legacyKeys(table).map((key) => [key, columns[key]]),
  );
  return (await connection.db
    .select(selection)
    .from(table as PgTable)) as T['$inferSelect'][];
}

/** Insert the verified baseline into the OLD physical schema, without calling the new seed importer. */
export async function seedVerifiedLegacyBaseline(
  connection: Connection,
  password?: string,
) {
  const seed = mapPrototypeSeed(readPrototypeSeed(process.cwd()));
  async function insert(table: PgTable, input: readonly object[]) {
    if (!input.length) return;
    const columns = getTableColumns(table);
    const rows = input as Record<string, unknown>[];
    const legacy = new Set(legacyKeys(table));
    const keys = [...new Set(rows.flatMap(Object.keys))].filter((key) =>
      legacy.has(key),
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
  if (password !== undefined) {
    const passwordHash = await hashPassword(password);
    await insert(
      user,
      seed.accounts.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        emailVerified: true,
      })),
    );
    await insert(
      account,
      seed.accounts.map((row) => ({
        id: 'credential-' + row.id,
        accountId: row.id,
        providerId: 'credential',
        userId: row.id,
        password: passwordHash,
      })),
    );
  }
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
interface MigrationFactFingerprint {
  count: number;
  digest: string;
  columns: string[];
}
type MigrationFactFingerprints = Record<string, MigrationFactFingerprint>;

/** Pass a prior fingerprint to compare its physical columns across an upgrade.
 * Ordinary snapshots still include every current column, apart from the explicit node option. */
export async function fingerprintMigrationFacts(
  connection: Connection,
  names?: string[] | MigrationFactFingerprints,
  omitNode = true,
): Promise<MigrationFactFingerprints> {
  const previous = names && !Array.isArray(names) ? names : undefined;
  const tables = Array.isArray(names)
    ? names
    : previous
      ? Object.keys(previous)
      : (
          await connection.pool.query<{ tablename: string }>(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
          )
        ).rows.map((row) => row.tablename);
  const result: MigrationFactFingerprints = {};
  for (const name of tables) {
    const physical = (
      await connection.pool.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
        [name],
      )
    ).rows.map((row) => row.column_name);
    const columns =
      previous?.[name].columns ??
      physical.filter((column) => !omitNode || column !== 'evaluation_node_id');
    if (
      !physical.length ||
      columns.some((column) => !physical.includes(column))
    )
      throw new Error('Migration removed a captured fact column: ' + name);
    const omitted = physical.filter((column) => !columns.includes(column));
    const row = '(to_jsonb(t) - $1::text[])';
    const table = '"' + name.replaceAll('"', '""') + '"';
    const query =
      'SELECT count(*)::int AS count, md5(coalesce(string_agg(' +
      row +
      "::text, '' ORDER BY " +
      row +
      "::text), '')) AS digest FROM " +
      table +
      ' AS t';
    const snapshot = await connection.pool.query<{
      count: number;
      digest: string;
    }>(query, [omitted]);
    result[name] = { ...snapshot.rows[0], columns: [...columns] };
  }
  return result;
}
