import { pathToFileURL } from 'node:url';
import { hashPassword } from 'better-auth/crypto';
import {
  and,
  eq,
  getTableColumns,
  inArray,
  or,
  type InferInsertModel,
} from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import { createDatabase, type Database, type Transaction } from './client';
import { readPrototypeSeed, mapPrototypeSeed, type DemoSeed } from './seed';
import {
  parseFormalEvidence,
  type EvidenceRecords,
} from './seed/evidence-input';
import {
  people,
  organizations,
  accountBindings,
  grants,
  employments,
} from '../modules/directory';
import { cohorts, enrollments, assignments } from '../modules/programs';
import { projects, members, memberLogs } from '../modules/staffing';
import {
  dimensions,
  ruleVersions,
  anchors,
} from '../modules/evaluation-system';
import {
  originals,
  originalVersions,
  fragments,
  events,
  eventParticipants,
  eventSources,
  statements,
  importSnapshots,
  historicalEvaluations,
  historicalParticipants,
} from '../modules/records';
import { aiSuggestions, confirmations, scoreReviews } from '../modules/talent';
import { user, account } from '../auth/schema';
import { getEnv } from '../env';

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}

/** Verify after ON CONFLICT, including a concurrent winner; never attach seed data to an incompatible row. */
async function insertChecked<T extends PgTable>(
  tx: Transaction,
  table: T,
  rows: InferInsertModel<T>[],
  keys: string[] = ['id'],
  immutable?: string[],
) {
  if (!rows.length) return;
  const inserted = await tx
    .insert(table)
    .values(rows)
    .onConflictDoNothing()
    .returning();
  if (inserted.length === rows.length) return;
  const columns = getTableColumns(table) as Record<string, AnyPgColumn>;
  const input = rows as Record<string, unknown>[];
  const found = await tx
    .select()
    .from(table as PgTable)
    .where(
      or(
        ...input.map((row) =>
          and(...keys.map((key) => eq(columns[key], row[key]))),
        ),
      ),
    );
  const identity = (row: Record<string, unknown>) =>
    canonical(keys.map((key) => row[key]));
  const existing = new Map(found.map((row) => [identity(row), row]));
  for (const row of input) {
    const actual = existing.get(identity(row));
    const compare = immutable ?? Object.keys(row);
    if (
      !actual ||
      compare.some(
        (key) =>
          row[key] !== undefined &&
          canonical(row[key]) !== canonical(actual[key]),
      )
    )
      throw new Error('Import identity collision: ' + identity(row));
  }
}

async function writeEvidence(tx: Transaction, records: EvidenceRecords) {
  await insertChecked(tx, originals, records.originals);
  await insertChecked(tx, originalVersions, records.originalVersions);
  await insertChecked(tx, fragments, records.fragments);
  await insertChecked(tx, events, records.events);
  await insertChecked(tx, eventParticipants, records.eventParticipants, [
    'eventId',
    'personId',
  ]);
  await insertChecked(tx, eventSources, records.eventSources, [
    'eventId',
    'fragmentId',
    'originalVersionId',
  ]);
  await insertChecked(tx, statements, records.statements);
  await insertChecked(tx, aiSuggestions, records.aiSuggestions);
  await insertChecked(tx, confirmations, records.confirmations);
  await insertChecked(tx, scoreReviews, records.scoreReviews);
  await insertChecked(tx, historicalEvaluations, records.historicalEvaluations);
  await insertChecked(
    tx,
    historicalParticipants,
    records.historicalParticipants,
    ['evaluationId', 'personId'],
  );
}

async function assertFormalReferences(
  tx: Transaction,
  records: EvidenceRecords,
) {
  const personIds = [
    ...new Set([
      ...records.events.flatMap((r) => [r.personId, r.recorderId]),
      ...records.eventParticipants.map((r) => r.personId),
      ...records.statements.flatMap((r) =>
        r.authorId === null ? [] : [r.authorId],
      ),
      ...records.confirmations.flatMap((r) =>
        [r.evaluatorId, r.modifiedBy].filter((v): v is string => v !== null),
      ),
      ...records.historicalEvaluations.flatMap((r) =>
        r.personId === null ? [r.recorderId] : [r.personId, r.recorderId],
      ),
      ...records.historicalParticipants.map((r) => r.personId),
    ]),
  ];
  if (personIds.length) {
    const found = await tx
      .select({ id: people.id, demo: people.demo })
      .from(people)
      .where(inArray(people.id, personIds));
    if (found.length !== personIds.length || found.some((p) => p.demo))
      throw new Error('Formal import requires existing non-demo identities');
  }
  const versions = [
    ...new Set([
      ...records.events.map((r) => r.ruleVersionId),
      ...records.aiSuggestions.map((r) => r.ruleVersionId),
      ...records.confirmations.map((r) => r.ruleVersionId),
      ...records.historicalEvaluations.flatMap((r) =>
        r.ruleVersionId === null ? [] : [r.ruleVersionId],
      ),
    ]),
  ];
  if (versions.length) {
    const found = await tx
      .select({ id: ruleVersions.id, provenance: ruleVersions.provenance })
      .from(ruleVersions)
      .where(inArray(ruleVersions.id, versions));
    if (
      found.length !== versions.length ||
      found.some((v) => v.provenance !== 'published')
    )
      throw new Error('Formal import requires existing published rules');
  }
}

/** Full original-evidence batch only. Authorization remains the server caller's responsibility. */
export async function importEvidence(db: Database, input: unknown) {
  const records = parseFormalEvidence(input);
  await db.transaction(async (tx) => {
    await assertFormalReferences(tx, records);
    await writeEvidence(tx, records);
  });
}

/** Explicit server seed path. Neither a payload mode nor demo=true can change the running environment. */
export async function importDemo(
  db: Database,
  input: DemoSeed,
  password: string,
) {
  if (getEnv().APP_ENV === 'production')
    throw new Error('Demo import is forbidden in production');
  if (password.length < 12)
    throw new Error('DEMO_PASSWORD must contain at least 12 characters');
  // A mutable raw object cannot prove ownership by a fixed Git blob.
  const verified = readPrototypeSeed(process.cwd());
  if (canonical(input.raw) !== canonical(verified))
    throw new Error('Demo input must match the verified snapshot');
  const seed = mapPrototypeSeed(verified);
  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    await insertChecked(
      tx,
      organizations,
      seed.organizations.map((o) => ({
        id: o.id,
        name: o.name,
        shortName: o.name,
      })),
      ['id'],
      ['id'],
    );
    await insertChecked(
      tx,
      people,
      seed.people.map((p) => ({
        id: p.id,
        name: p.name,
        organizationId: p.organizationId,
        hue: p.hue,
        photo: p.photo,
        noReview: p.noReview,
        demo: true,
      })),
      ['id'],
      ['id', 'demo'],
    );
    await insertChecked(
      tx,
      employments,
      seed.people.map((p) => ({
        id: 'demo-employment-' + p.id,
        personId: p.id,
        organizationId: p.organizationId,
        validFrom: p.joined,
        validTo: null,
      })),
      ['id'],
      ['id', 'personId'],
    );
    await insertChecked(
      tx,
      user,
      seed.accounts.map((a) => ({
        id: a.id,
        name: a.name,
        email: a.email,
        emailVerified: true,
      })),
      ['id'],
      ['id', 'email'],
    );
    await insertChecked(
      tx,
      account,
      seed.accounts.map((a) => ({
        id: 'credential-' + a.id,
        accountId: a.id,
        providerId: 'credential',
        userId: a.id,
        password: passwordHash,
      })),
      ['id'],
      ['id', 'accountId', 'providerId', 'userId'],
    );
    await insertChecked(
      tx,
      accountBindings,
      seed.accounts.map((a) => ({
        accountId: a.id,
        personId: a.personId,
        isSystemAdmin: a.isSystemAdmin,
      })),
      ['accountId'],
    );
    await insertChecked(
      tx,
      cohorts,
      seed.cohorts.map((c) => ({ id: c.id, name: c.name })),
      ['id'],
      ['id'],
    );
    await insertChecked(
      tx,
      grants,
      seed.grants.map((g, i) => ({ id: 'demo-grant-' + i, ...g })),
      ['id'],
      ['id', 'accountId', 'role', 'scope', 'cohortId'],
    );
    await insertChecked(
      tx,
      enrollments,
      seed.enrollments.map((e, i) => ({ id: 'demo-enrollment-' + i, ...e })),
      ['id'],
      ['id', 'personId', 'cohortId'],
    );
    await insertChecked(
      tx,
      assignments,
      seed.assignments.map((a, i) => ({ id: 'demo-assignment-' + i, ...a })),
      ['id'],
      ['id', 'personId', 'cohortId', 'studentId', 'kind'],
    );
    await insertChecked(
      tx,
      projects,
      seed.projects.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        status: p.status,
        goal: p.goal,
        organizationId: p.organizationId,
        cohortId: p.cohortId,
        isTopic: p.isTopic,
        ownerId: p.ownerId,
        creatorId: p.creatorId,
        from: p.from,
        to: p.to,
        sortOrder: p.sortOrder,
      })),
      ['id'],
      ['id'],
    );
    await insertChecked(
      tx,
      members,
      seed.members.map((m) => ({
        id: m.id,
        projectId: m.projectId,
        personId: m.personId,
        role: m.role,
        mode: m.mode,
        validFrom: m.validFrom,
        validTo: m.validTo,
        by: m.by,
      })),
      ['id'],
      ['id', 'projectId', 'personId'],
    );
    await insertChecked(
      tx,
      memberLogs,
      seed.memberLogs.map((l) => ({
        id: l.id,
        projectId: l.projectId,
        at: l.at,
        text: l.text,
        by: l.by,
      })),
      ['id'],
      ['id', 'projectId'],
    );
    await insertChecked(tx, dimensions, seed.evidence.dimensions);
    await insertChecked(tx, ruleVersions, seed.evidence.ruleVersions);
    await insertChecked(tx, anchors, seed.evidence.anchors);
    await insertChecked(tx, importSnapshots, seed.evidence.snapshots);
    await writeEvidence(tx, seed.evidence);
  });
  return { gaps: seed.evidence.gaps };
}

export async function runImport() {
  const env = getEnv();
  if (env.APP_ENV === 'production')
    throw new Error('Demo import is forbidden in production');
  if (!env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD is required');
  const connection = createDatabase(env.DATABASE_URL);
  try {
    const report = await importDemo(
      connection.db,
      mapPrototypeSeed(readPrototypeSeed(process.cwd())),
      env.DEMO_PASSWORD,
    );
    console.log(JSON.stringify(report));
  } finally {
    await connection.pool.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runImport();
