/** Canonical pseudonym facts in the pre-899 physical schema; migration tests only. */
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

/** Insert the verified baseline into the OLD physical schema, without calling the new seed importer. */
export async function seedVerifiedLegacyBaseline(connection: Connection) {
  const seed = mapPrototypeSeed(readPrototypeSeed(process.cwd()));
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
export async function fingerprintMigrationFacts(
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
