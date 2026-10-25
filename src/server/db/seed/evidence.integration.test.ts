import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';
import { createDatabase } from '../client';
import { people, organizations } from '../../modules/directory';
import {
  originals,
  originalVersions,
  fragments,
  events,
  eventSources,
  statements,
  importSnapshots,
} from '../../modules/records';
import {
  dimensions,
  ruleVersions,
  anchors,
} from '../../modules/evaluation-system';
import {
  confirmations,
  aiSuggestions,
  scoreReviews,
} from '../../modules/talent';
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
const name = `qtalent_evidence_${randomUUID().replaceAll('-', '')}_test`;
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source)
    throw new Error(
      'Real PostgreSQL integration requires TEST_DATABASE_URL; no skip or fake fallback',
    );
  const url = new URL(source);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Integration database must be loopback and end _test');
  admin = new Pool({ connectionString: source });
  await admin.query(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  connection = createDatabase(url.toString());
  await migrate(connection.db, {
    migrationsFolder: 'src/server/db/migrations',
  });
}, 30_000);
afterAll(async () => {
  await connection?.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
  }
});
async function fixture() {
  const db = connection!.db;
  const p = randomUUID();
  const org = `${p}-org`,
    person = `${p}-person`,
    other = `${p}-other`,
    evaluator = `${p}-evaluator`,
    dimension = `${p}-dimension`,
    rule = `${p}-rule`,
    event = `${p}-event`,
    version = `${p}-version`,
    fragment = `${p}-fragment`;
  await db
    .insert(organizations)
    .values({ id: org, name: 'Synthetic organization', shortName: 'Test' });
  await db.insert(people).values(
    [person, other, evaluator].map((id) => ({
      id,
      name: 'Synthetic person',
      organizationId: org,
      demo: true,
    })),
  );
  await db.insert(dimensions).values({
    id: dimension,
    name: 'Synthetic dimension',
    axis: 'prof',
    core: true,
  });
  await db.insert(ruleVersions).values({ id: rule, provenance: 'published' });
  await db.insert(anchors).values(
    [1, 2, 3, 4, 5].map((value) => ({
      id: `${p}-anchor-${value}`,
      dimensionId: dimension,
      ruleVersionId: rule,
      value,
      text: `Synthetic behavior ${value}`,
    })),
  );
  await db.insert(originals).values({ id: p, title: 'Synthetic document' });
  await db.insert(originalVersions).values({
    id: version,
    originalId: p,
    version: 1,
    contentDigest: 'synthetic-digest',
  });
  await db.insert(fragments).values({
    id: fragment,
    originalVersionId: version,
    location: { kind: 'document', page: 1, paragraph: 'test-paragraph' },
    excerpt: 'Synthetic observation',
  });
  const eventRow = {
    id: event,
    personId: person,
    recorderId: evaluator,
    occurredOn: '2026-07-01',
    title: 'Synthetic event',
    situation: 'Test',
    behavior: 'Test behavior',
    impact: 'Test impact',
    ruleVersionId: rule,
  };
  await db.insert(events).values(eventRow);
  await db.insert(eventSources).values({
    eventId: event,
    fragmentId: fragment,
    originalVersionId: version,
  });
  const score = {
    id: `${p}-confirmation`,
    eventId: event,
    dimensionId: dimension,
    evaluatorId: evaluator,
    ruleVersionId: rule,
    status: 'scored',
    value: 3,
    anchorId: `${p}-anchor-3`,
    fragmentId: fragment,
    originalVersionId: version,
    revision: 1,
    active: true,
    modifiedBy: evaluator,
  };
  return {
    db,
    p,
    person,
    other,
    evaluator,
    rule,
    dimension,
    event,
    version,
    fragment,
    eventRow,
    score,
  };
}
it('runs migrations twice without schema changes', async () => {
  const db = connection!.db;
  const before = await db.execute(
    sql`select * from drizzle.__drizzle_migrations order by id`,
  );
  await migrate(db, { migrationsFolder: 'src/server/db/migrations' });
  expect(
    (
      await db.execute(
        sql`select * from drizzle.__drizzle_migrations order by id`,
      )
    ).rows,
  ).toEqual(before.rows);
});
it('rejects orphan fragments, invalid locations and cross-version event links', async () => {
  const f = await fixture();
  await expect(
    f.db.insert(fragments).values({
      id: `${f.p}-orphan`,
      originalVersionId: 'missing',
      location: { kind: 'document', paragraph: 'test' },
      excerpt: 'Synthetic',
    }),
  ).rejects.toMatchObject({ cause: { code: '23503' } });
  for (const location of [
    { kind: 'document', paragraph: '' },
    { kind: 'spreadsheet', sheet: 'test' },
    { kind: 'recording', startMs: 10, endMs: 10 },
    { kind: 'document', paragraph: 'test', page: 0 },
  ]) {
    await expect(
      f.db.insert(fragments).values({
        id: randomUUID(),
        originalVersionId: f.version,
        location: location as typeof fragments.$inferInsert.location,
        excerpt: 'Synthetic',
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
  }
  await f.db.insert(originalVersions).values({
    id: `${f.p}-v2`,
    originalId: f.p,
    version: 2,
    contentDigest: 'second',
  });
  await expect(
    f.db.insert(eventSources).values({
      eventId: f.event,
      fragmentId: f.fragment,
      originalVersionId: `${f.p}-v2`,
    }),
  ).rejects.toMatchObject({ cause: { code: '23503' } });
});
it('enforces attribution, anchor, version, evidence and 1–5/unknown invariants at the database boundary', async () => {
  const f = await fixture();
  for (const patch of [
    { value: 0 },
    { value: 6 },
    { value: null },
    { anchorId: null },
    { status: 'unknown', value: 3 },
    { status: 'not_demonstrated', value: 3 },
  ]) {
    await expect(
      f.db.insert(confirmations).values({ ...f.score, ...patch }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
  }
  await expect(
    f.db
      .insert(confirmations)
      .values({ ...f.score, evaluatorId: null as unknown as string }),
  ).rejects.toMatchObject({ cause: { code: '23502' } });
  for (const patch of [
    { evaluatorId: 'missing' },
    { anchorId: 'missing' },
    { fragmentId: 'missing' },
    { ruleVersionId: 'missing' },
    { anchorId: `${f.p}-anchor-4` },
  ]) {
    await expect(
      f.db.insert(confirmations).values({ ...f.score, ...patch }),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
  }
  await f.db
    .insert(confirmations)
    .values({ ...f.score, status: 'unknown', value: null, anchorId: null });
  expect(
    (
      await f.db
        .select()
        .from(confirmations)
        .where(eq(confirmations.id, f.score.id))
    )[0].value,
  ).toBeNull();
});
it('AI suggestions are separate and concurrent confirmations allow one active business key', async () => {
  const f = await fixture();
  await f.db.insert(aiSuggestions).values({
    ...f.score,
    id: `${f.p}-ai`,
    modelVersion: 'synthetic-model-v1',
    rationale: 'Synthetic rationale',
  });
  expect(
    await f.db
      .select()
      .from(confirmations)
      .where(eq(confirmations.eventId, f.event)),
  ).toHaveLength(0);
  const results = await Promise.allSettled([
    f.db.insert(confirmations).values(f.score),
    f.db.insert(confirmations).values({ ...f.score, id: `${f.p}-race` }),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  expect(
    await f.db
      .select()
      .from(confirmations)
      .where(eq(confirmations.eventId, f.event)),
  ).toHaveLength(1);
});
it('retains revision history and rejects incomplete or foreign lineage', async () => {
  const f = await fixture();
  await f.db.insert(confirmations).values(f.score);
  const next = {
    ...f.score,
    id: `${f.p}-next`,
    revision: 2,
    previousRevision: 1,
    previousId: f.score.id,
    reason: 'Synthetic correction',
    value: 4,
    anchorId: `${f.p}-anchor-4`,
  };
  await expect(
    f.db.insert(confirmations).values({ ...next, active: false, reason: null }),
  ).rejects.toMatchObject({ cause: { code: '23514' } });
  await expect(
    f.db
      .insert(confirmations)
      .values({ ...next, active: false, previousId: 'missing' }),
  ).rejects.toMatchObject({ cause: { code: '23503' } });
  await f.db.transaction(async (tx) => {
    await tx
      .update(confirmations)
      .set({ active: false })
      .where(eq(confirmations.id, f.score.id));
    await tx.insert(confirmations).values(next);
  });
  const rows = await f.db
    .select()
    .from(confirmations)
    .where(eq(confirmations.eventId, f.event));
  expect(rows).toHaveLength(2);
  expect(rows.find((r) => r.id === f.score.id)).toMatchObject({
    value: 3,
    active: false,
    evaluatorId: f.evaluator,
  });
  expect(rows.find((r) => r.active)).toMatchObject({
    value: 4,
    previousId: f.score.id,
  });
});
it('two individual events share evidence without copying participant/team scores or duplicating source joins', async () => {
  const f = await fixture();
  await f.db
    .insert(events)
    .values({ ...f.eventRow, id: `${f.p}-second`, personId: f.other });
  await f.db.insert(eventSources).values({
    eventId: `${f.p}-second`,
    fragmentId: f.fragment,
    originalVersionId: f.version,
  });
  await f.db
    .insert(confirmations)
    .values([
      f.score,
      { ...f.score, id: `${f.p}-second-score`, eventId: `${f.p}-second` },
    ]);
  expect(
    await f.db
      .select()
      .from(confirmations)
      .where(eq(confirmations.evaluatorId, f.evaluator)),
  ).toHaveLength(2);
  await expect(
    f.db.insert(eventSources).values({
      eventId: f.event,
      fragmentId: f.fragment,
      originalVersionId: f.version,
    }),
  ).rejects.toMatchObject({ cause: { code: '23505' } });
  await expect(
    f.db.delete(originalVersions).where(eq(originalVersions.id, f.version)),
  ).rejects.toMatchObject({ cause: { code: '23503' } });
});
it('stores distinct statement natures and review causes, never a frozen profile', async () => {
  const f = await fixture();
  const base = {
    eventId: f.event,
    text: 'Synthetic statement',
    fragmentId: f.fragment,
    originalVersionId: f.version,
  };
  await f.db.insert(statements).values(
    [
      'original_fact',
      'self_report',
      'management_observation',
      'human_conclusion',
    ].map((kind) => ({
      ...base,
      id: `${f.p}-${kind}`,
      kind: kind as 'original_fact',
      authorId: f.evaluator,
    })),
  );
  await f.db.insert(statements).values({
    ...base,
    id: `${f.p}-ai-statement`,
    kind: 'ai_inference',
    modelVersion: 'synthetic-model-v1',
    uncertainty: 'unknown',
  });
  await expect(
    f.db.insert(statements).values({
      ...base,
      id: randomUUID(),
      kind: 'ai_inference',
      authorId: f.evaluator,
    }),
  ).rejects.toMatchObject({ cause: { code: '23514' } });
  await f.db.insert(scoreReviews).values(
    [
      'score_gap',
      'ai_changed_without_reason',
      'post_freeze_position_change',
    ].map((reason) => ({
      id: randomUUID(),
      eventId: f.event,
      dimensionId: f.dimension,
      reason,
    })),
  );
  const tables = (
    await f.db.execute(
      sql`select tablename from pg_tables where schemaname='public'`,
    )
  ).rows.map((r) => r.tablename);
  expect(
    tables.some((t) => /frozen|profile_version|quadrant/.test(String(t))),
  ).toBe(false);
});
it('preserves synthetic snapshot identity without overwriting and rolls invalid transactions back', async () => {
  const db = connection!.db;
  const id = randomUUID();
  const snapshot = {
    id,
    recordId: 'test-record',
    sourceCommit: 'test-baseline',
    fieldPath: `EVENTS[${id}]`,
    provenance: 'demo_import_snapshot',
    content: { synthetic: true },
  };
  await db.insert(importSnapshots).values(snapshot).onConflictDoNothing();
  await db
    .insert(importSnapshots)
    .values({ ...snapshot, content: { synthetic: false } })
    .onConflictDoNothing();
  expect(
    await db.select().from(importSnapshots).where(eq(importSnapshots.id, id)),
  ).toEqual([snapshot]);
  await expect(
    db.insert(importSnapshots).values({ ...snapshot, id: randomUUID() }),
  ).rejects.toMatchObject({ cause: { code: '23505' } });
  const rollbackId = randomUUID();
  await expect(
    db.transaction(async (tx) => {
      await tx
        .insert(originals)
        .values({ id: rollbackId, title: 'Synthetic original' });
      await tx.insert(originalVersions).values({
        id: randomUUID(),
        originalId: 'missing',
        version: 1,
        contentDigest: 'synthetic',
      });
    }),
  ).rejects.toMatchObject({ cause: { code: '23503' } });
  expect(
    await db.select().from(originals).where(eq(originals.id, rollbackId)),
  ).toHaveLength(0);
});
it('rejects existing but unrelated previous revisions, suggestions, and source fragments', async () => {
  const f = await fixture(),
    other = await fixture();
  await other.db.insert(confirmations).values(other.score);
  await expect(
    f.db.insert(confirmations).values({
      ...f.score,
      revision: 2,
      previousRevision: 1,
      previousId: other.score.id,
      reason: 'Synthetic correction',
    }),
  ).rejects.toMatchObject({ cause: { code: '23503' } });
  await other.db.insert(aiSuggestions).values({
    ...other.score,
    id: `${other.p}-ai`,
    modelVersion: 'synthetic-v1',
    rationale: 'Synthetic',
  });
  await expect(
    f.db
      .insert(confirmations)
      .values({ ...f.score, suggestionId: `${other.p}-ai` }),
  ).rejects.toMatchObject({ cause: { code: '23503' } });
  await expect(
    f.db.insert(confirmations).values({
      ...f.score,
      fragmentId: other.fragment,
      originalVersionId: other.version,
    }),
  ).rejects.toMatchObject({ cause: { code: '23503' } });
  await f.db.insert(confirmations).values({
    ...f.score,
    id: `${f.p}-other-evaluator-score`,
    evaluatorId: f.other,
  });
  await expect(
    f.db.insert(confirmations).values({
      ...f.score,
      revision: 2,
      previousRevision: 1,
      previousId: `${f.p}-other-evaluator-score`,
      reason: 'Synthetic correction',
    }),
  ).rejects.toMatchObject({ cause: { code: '23503' } });
  await f.db.insert(fragments).values({
    id: `${f.p}-unlinked`,
    originalVersionId: f.version,
    location: { kind: 'document', paragraph: 'second' },
    excerpt: 'Synthetic unlinked source',
  });
  await expect(
    f.db
      .insert(confirmations)
      .values({ ...f.score, fragmentId: `${f.p}-unlinked` }),
  ).rejects.toMatchObject({ cause: { code: '23503' } });
  // Same event but another dimension is also not the suggestion that was confirmed.
  const dimension = `${f.p}-other-dimension`;
  await f.db.insert(dimensions).values({
    id: dimension,
    name: 'Synthetic second dimension',
    axis: 'pot',
    core: true,
  });
  await f.db.insert(anchors).values({
    id: `${f.p}-other-anchor`,
    dimensionId: dimension,
    ruleVersionId: f.rule,
    value: 3,
    text: 'Synthetic behavior',
  });
  await f.db.insert(aiSuggestions).values({
    ...f.score,
    id: `${f.p}-other-ai`,
    dimensionId: dimension,
    anchorId: `${f.p}-other-anchor`,
    modelVersion: 'synthetic-v1',
    rationale: 'Synthetic',
  });
  await expect(
    f.db
      .insert(confirmations)
      .values({ ...f.score, suggestionId: `${f.p}-other-ai` }),
  ).rejects.toMatchObject({ cause: { code: '23503' } });
});
