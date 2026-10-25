import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, getTableName, sql } from 'drizzle-orm';
import { createDatabase, type Database } from '../client';
import { importDemo, importEvidence } from '../import';
import { mapPrototypeSeed, readPrototypeSeed } from './index';
import {
  organizations,
  people,
  accountBindings,
  employments,
  grants,
} from '../../modules/directory';
import { cohorts, enrollments, assignments } from '../../modules/programs';
import { user, account } from '../../auth/schema';
import { projects, members, memberLogs } from '../../modules/staffing';
import {
  dimensions,
  ruleVersions,
  anchors,
} from '../../modules/evaluation-system';
import {
  importSnapshots,
  originals,
  originalVersions,
  fragments,
  events,
  statements,
  historicalEvaluations,
  historicalParticipants,
  eventSources,
} from '../../modules/records';
import {
  confirmations,
  aiSuggestions,
  scoreReviews,
} from '../../modules/talent';

let admin: Pool;
let source: URL;
const seed = () => mapPrototypeSeed(readPrototypeSeed(process.cwd()));
const password = 'Synthetic-test-password-only';
beforeAll(() => {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw)
    throw new Error('Real PostgreSQL TEST_DATABASE_URL required; no skip/fake');
  source = new URL(raw);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname) ||
    !source.pathname.endsWith('_test')
  )
    throw new Error('Loopback _test database required');
  admin = new Pool({ connectionString: raw });
});
afterAll(async () => {
  await admin?.end();
});
async function isolated(run: (db: Database) => Promise<void>) {
  const name = 'qtalent_mapper_' + randomUUID().replaceAll('-', '') + '_test';
  await admin.query('CREATE DATABASE "' + name + '"');
  const url = new URL(source);
  url.pathname = '/' + name;
  const connection = createDatabase(url.toString());
  try {
    await migrate(connection.db, {
      migrationsFolder: 'src/server/db/migrations',
    });
    await run(connection.db);
  } finally {
    await connection.pool.end();
    await admin.query('DROP DATABASE "' + name + '"');
  }
}
async function count(db: Database, table: Parameters<typeof getTableName>[0]) {
  const result = await db.execute(
    sql.join(
      [
        sql.raw('select count(*)::integer as count from '),
        sql.identifier(getTableName(table)),
      ],
      sql.raw(''),
    ),
  );
  return result.rows[0].count;
}
async function fingerprints(db: Database) {
  const names = [
    organizations,
    people,
    employments,
    user,
    account,
    accountBindings,
    grants,
    cohorts,
    enrollments,
    assignments,
    projects,
    members,
    memberLogs,
    dimensions,
    ruleVersions,
    anchors,
    importSnapshots,
    originals,
    originalVersions,
    fragments,
    events,
    statements,
    historicalEvaluations,
    historicalParticipants,
    eventSources,
    confirmations,
    aiSuggestions,
    scoreReviews,
  ].map(getTableName);
  const result: Record<string, unknown> = {};
  for (const name of names) {
    const rows = await db.execute(
      sql.join(
        [
          sql.raw(
            "select count(*)::integer as count, md5(coalesce(string_agg(to_jsonb(t)::text, '' order by to_jsonb(t)::text), '')) as digest from ",
          ),
          sql.identifier(name),
          sql.raw(' t'),
        ],
        sql.raw(''),
      ),
    );
    result[name] = rows.rows[0];
  }
  return result;
}
it('imports all approved baseline rows and reruns with identical data, IDs and retained user edits', async () => {
  await isolated(async (db) => {
    const mapped = seed();
    const report = await importDemo(db, mapped, password);
    expect(report.gaps).toHaveLength(21);
    expect(await count(db, importSnapshots)).toBe(398);
    expect(await count(db, events)).toBe(277);
    expect(await count(db, originals)).toBe(2);
    expect(await count(db, originalVersions)).toBe(2);
    expect(await count(db, confirmations)).toBe(559);
    expect(await count(db, aiSuggestions)).toBe(4);
    expect(await count(db, historicalEvaluations)).toBe(363);
    expect(await count(db, scoreReviews)).toBe(1);
    const scores = await db.select().from(confirmations);
    expect(scores.filter((s) => s.status === 'scored')).toHaveLength(558);
    expect(scores.filter((s) => s.status === 'unknown')).toMatchObject([
      { value: null, evaluatorId: null },
    ]);
    expect(
      scores.every(
        (s) =>
          s.confirmedAt === null &&
          s.modifiedBy === null &&
          s.sourceCategory === 'prototype_baseline',
      ),
    ).toBe(true);
    const history = await db.select().from(historicalEvaluations);
    expect(
      history.filter((r) => r.ruleVersionId === 'xe-weekly-v1'),
    ).toHaveLength(242);
    expect(history.filter((r) => r.ruleVersionId === null)).toHaveLength(121);
    expect(
      (await db.select().from(events)).filter((e) => e.behavior === ''),
    ).toHaveLength(10);
    await db
      .update(projects)
      .set({ name: 'Synthetic user-edited project' })
      .where(eq(projects.id, mapped.projects[0].id));
    await db
      .update(people)
      .set({ name: 'Synthetic user-edited demo name' })
      .where(eq(people.id, mapped.people[0].id));
    const before = await fingerprints(db);
    await importDemo(db, seed(), password);
    expect(await fingerprints(db)).toEqual(before);
    expect(
      (
        await db
          .select()
          .from(projects)
          .where(eq(projects.id, mapped.projects[0].id))
      )[0].name,
    ).toBe('Synthetic user-edited project');
  });
}, 30_000);

it('rolls back the complete base and evidence batch if a late confirmation insert fails', async () => {
  await isolated(async (db) => {
    await db.execute(
      sql.raw(
        "CREATE FUNCTION reject_mapper_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic late import failure'; END; $$",
      ),
    );
    await db.execute(
      sql.raw(
        'CREATE TRIGGER reject_mapper_confirmation BEFORE INSERT ON talent_confirmations FOR EACH ROW EXECUTE FUNCTION reject_mapper_confirmation()',
      ),
    );
    await expect(importDemo(db, seed(), password)).rejects.toThrow();
    for (const table of [
      people,
      projects,
      originals,
      originalVersions,
      fragments,
      events,
      aiSuggestions,
      importSnapshots,
      ruleVersions,
      user,
    ])
      expect(await count(db, table)).toBe(0);
  });
}, 30_000);

it('refuses a real identity collision without binding baseline evidence to it or retaining partial inserts', async () => {
  await isolated(async (db) => {
    const mapped = seed();
    await db.insert(organizations).values({
      id: 'synthetic-real-org',
      name: 'Synthetic real org',
      shortName: 'Real',
    });
    await db.insert(people).values({
      id: mapped.people[0].id,
      name: 'Synthetic real identity',
      organizationId: 'synthetic-real-org',
      demo: false,
    });
    await expect(importDemo(db, mapped, password)).rejects.toThrow(/collision/);
    expect(await count(db, people)).toBe(1);
    expect(await count(db, organizations)).toBe(1);
    expect(await count(db, importSnapshots)).toBe(0);
    expect((await db.select().from(people))[0]).toMatchObject({
      demo: false,
      name: 'Synthetic real identity',
    });
  });
}, 30_000);

it('refuses a published rubric collision without overwriting rules or retaining seeded identities', async () => {
  await isolated(async (db) => {
    await db
      .insert(ruleVersions)
      .values({ id: 'rubric-v1', provenance: 'published' });
    await expect(importDemo(db, seed(), password)).rejects.toThrow(/collision/);
    expect(await count(db, people)).toBe(0);
    expect(await count(db, user)).toBe(0);
    expect(await count(db, anchors)).toBe(0);
    expect(await count(db, importSnapshots)).toBe(0);
    expect((await db.select().from(ruleVersions))[0]).toMatchObject({
      provenance: 'published',
      sourceCommit: null,
    });
  });
}, 30_000);

it('refuses a different existing account email instead of adding demo bindings or grants', async () => {
  await isolated(async (db) => {
    const mapped = seed();
    await db.insert(user).values({
      id: mapped.accounts[0].id,
      email: 'synthetic-other@example.test',
      name: 'Synthetic account',
    });
    await expect(importDemo(db, mapped, password)).rejects.toThrow(/collision/);
    expect(await count(db, accountBindings)).toBe(0);
    expect(await count(db, people)).toBe(0);
    expect((await db.select().from(user))[0].email).toBe(
      'synthetic-other@example.test',
    );
  });
}, 30_000);

it('detects a semantic unique-key collision whose incoming anchor ID was not inserted', async () => {
  await isolated(async (db) => {
    const mapped = seed();
    await db.insert(dimensions).values(mapped.evidence.dimensions[0]);
    await db.insert(ruleVersions).values(mapped.evidence.ruleVersions[0]);
    await db
      .insert(anchors)
      .values({ ...mapped.evidence.anchors[0], id: 'synthetic-other-anchor' });
    await expect(importDemo(db, mapped, password)).rejects.toThrow(/collision/);
    expect(await count(db, people)).toBe(0);
    expect((await db.select().from(anchors)).map((a) => a.id)).toEqual([
      'synthetic-other-anchor',
    ]);
  });
}, 30_000);

function ordinaryBatch() {
  return {
    originals: [{ id: 'test-original', title: 'Synthetic original' }],
    originalVersions: [
      {
        id: 'test-version',
        originalId: 'test-original',
        version: 1,
        contentDigest: 'synthetic-digest',
      },
    ],
    fragments: [
      {
        id: 'test-fragment',
        originalVersionId: 'test-version',
        location: { kind: 'document', page: 1, paragraph: '1' },
        excerpt: 'Synthetic observation',
      },
    ],
    events: [
      {
        id: 'test-event',
        personId: 'test-person',
        recorderId: 'test-reviewer',
        occurredOn: '2026-07-24',
        title: 'Synthetic event',
        situation: 'Synthetic situation',
        behavior: 'Synthetic behavior',
        impact: '',
        ruleVersionId: 'test-published',
      },
    ],
    eventSources: [
      {
        eventId: 'test-event',
        fragmentId: 'test-fragment',
        originalVersionId: 'test-version',
      },
    ],
    confirmations: [
      {
        id: 'test-confirmation',
        eventId: 'test-event',
        dimensionId: 'test-dimension',
        ruleVersionId: 'test-published',
        status: 'scored',
        value: 3,
        anchorId: 'test-anchor',
        evaluatorId: 'test-reviewer',
        modifiedBy: 'test-reviewer',
        confirmedAt: '2026-07-24T00:00:00Z',
        fragmentId: 'test-fragment',
        originalVersionId: 'test-version',
      },
    ],
  };
}
function completeOrdinaryBatch() {
  const batch = ordinaryBatch();
  const reference = {
    fragmentId: 'test-fragment',
    originalVersionId: 'test-version',
  };
  return {
    ...batch,
    statements: [
      {
        id: 'test-statement',
        eventId: 'test-event',
        kind: 'original_fact',
        text: 'Synthetic observation',
        authorId: 'test-reviewer',
        ...reference,
      },
    ],
    aiSuggestions: [
      {
        id: 'test-ai',
        eventId: 'test-event',
        dimensionId: 'test-dimension',
        ruleVersionId: 'test-published',
        modelVersion: 'synthetic-test-model',
        rationale: 'Synthetic rationale',
        status: 'scored',
        value: 3,
        anchorId: 'test-anchor',
        ...reference,
      },
    ],
    historicalEvaluations: [
      {
        id: 'test-history',
        sourceRecordId: 'test-history-source',
        personId: 'test-person',
        recorderId: 'test-reviewer',
        occurredOn: '2026-07-24',
        kind: 'Synthetic original review',
        scale: [['Original scale', 'B']],
        ruleVersionId: 'test-published',
        ...reference,
      },
    ],
    historicalParticipants: [
      { evaluationId: 'test-history', personId: 'test-person' },
    ],
  };
}
async function realReferences(db: Database) {
  await db
    .insert(organizations)
    .values({ id: 'test-org', name: 'Synthetic org', shortName: 'Test' });
  await db.insert(people).values(
    ['test-person', 'test-reviewer'].map((id) => ({
      id,
      name: 'Synthetic identity',
      organizationId: 'test-org',
      demo: false,
    })),
  );
  await db.insert(dimensions).values({
    id: 'test-dimension',
    name: 'Synthetic dimension',
    axis: 'prof',
    core: true,
  });
  await db
    .insert(ruleVersions)
    .values({ id: 'test-published', provenance: 'published' });
  await db.insert(anchors).values({
    id: 'test-anchor',
    dimensionId: 'test-dimension',
    ruleVersionId: 'test-published',
    value: 3,
    text: 'Synthetic anchor',
  });
}
it('writes a complete original batch through the formal entry and reruns it without duplicates', async () => {
  await isolated(async (db) => {
    await realReferences(db);
    await importEvidence(db, ordinaryBatch());
    await importEvidence(db, ordinaryBatch());
    expect(await count(db, confirmations)).toBe(1);
    expect((await db.select().from(events))[0].demo).toBe(false);
    expect((await db.select().from(confirmations))[0]).toMatchObject({
      sourceCategory: 'original',
      evaluatorId: 'test-reviewer',
      modifiedBy: 'test-reviewer',
    });
  });
});
it('formal entry checks actual identity/rule provenance rather than trusting original/demo flags in the batch', async () => {
  await isolated(async (db) => {
    await realReferences(db);
    await db
      .update(people)
      .set({ demo: true })
      .where(eq(people.id, 'test-person'));
    await expect(importEvidence(db, ordinaryBatch())).rejects.toThrow(
      /non-demo/,
    );
    expect(await count(db, originals)).toBe(0);
    await db
      .update(people)
      .set({ demo: false })
      .where(eq(people.id, 'test-person'));
    await db
      .update(ruleVersions)
      .set({ provenance: 'demo_import_snapshot', sourceCommit: '2e51b50' })
      .where(eq(ruleVersions.id, 'test-published'));
    await expect(importEvidence(db, ordinaryBatch())).rejects.toThrow(
      /published/,
    );
    expect(await count(db, originals)).toBe(0);
  });
});
it('formal entry writes original AI, statements and historical references through the same checked transaction', async () => {
  await isolated(async (db) => {
    await realReferences(db);
    await importEvidence(db, completeOrdinaryBatch());
    expect(await count(db, statements)).toBe(1);
    expect(await count(db, aiSuggestions)).toBe(1);
    expect(await count(db, historicalEvaluations)).toBe(1);
    expect(await count(db, historicalParticipants)).toBe(1);
  });
});
it.each([
  'statement-author',
  'history-subject',
  'history-participant',
  'history-rule',
])(
  'rejects an actual demo %s concealed behind original batch labels',
  async (field) => {
    await isolated(async (db) => {
      await realReferences(db);
      await db.insert(people).values({
        id: 'test-related-demo',
        name: 'Synthetic demo identity',
        organizationId: 'test-org',
        demo: true,
      });
      await db.insert(ruleVersions).values({
        id: 'test-demo-rule',
        provenance: 'demo_import_snapshot',
        sourceCommit: '2e51b50',
      });
      const batch = completeOrdinaryBatch();
      if (field === 'statement-author')
        batch.statements[0].authorId = 'test-related-demo';
      if (field === 'history-subject')
        batch.historicalEvaluations[0].personId = 'test-related-demo';
      if (field === 'history-participant')
        batch.historicalParticipants[0].personId = 'test-related-demo';
      if (field === 'history-rule')
        batch.historicalEvaluations[0].ruleVersionId = 'test-demo-rule';
      await expect(importEvidence(db, batch)).rejects.toThrow(
        field === 'history-rule' ? /published/ : /non-demo/,
      );
      expect(await count(db, originals)).toBe(0);
    });
  },
);
it('direct demo entry refuses production even with a forged input demo flag', async () => {
  const mapped = Object.assign(seed(), { demo: true, APP_ENV: 'test' });
  vi.stubEnv('APP_ENV', 'production');
  vi.stubEnv('ACCESS_ENFORCED', 'true');
  vi.stubEnv('ACCESS_ISSUER', 'https://synthetic-team.cloudflareaccess.com');
  vi.stubEnv('ACCESS_AUDIENCE', 'synthetic-test-audience');
  try {
    await isolated(async (db) => {
      await expect(importDemo(db, mapped, password)).rejects.toThrow(
        /production/,
      );
      expect(await count(db, people)).toBe(0);
    });
  } finally {
    vi.unstubAllEnvs();
  }
});
