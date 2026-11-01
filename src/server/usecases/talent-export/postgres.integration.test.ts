import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../../db/client';
import {
  organizations,
  people,
  accountBindings,
  grants,
} from '../../modules/directory';
import {
  cohorts,
  enrollments,
  evaluationNodes,
  evaluationNodeSubjects,
  evaluationRelations,
} from '../../modules/programs';
import {
  originals,
  originalVersions,
  fragments,
  events,
  eventSources,
  eventParticipants,
} from '../../modules/records';
import {
  dimensions,
  anchors,
  ruleVersions,
} from '../../modules/evaluation-system';
import { confirmations, scoreReviews } from '../../modules/talent';
import { auditEvents } from '../../platform/audit/schema';
import { createPostgresTalentExportStore } from './postgres';
import { createTalentExportService } from './service';
import { snapshot } from './test-helpers';
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
let created = false;
const name = `qtalent_export_${randomUUID().replaceAll('-', '')}_test`;
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source)
    throw new Error(
      'Real PostgreSQL requires TEST_DATABASE_URL; no skip/fallback',
    );
  const url = new URL(source);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Integration database must be loopback and end _test');
  admin = new Pool({ connectionString: source });
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  url.pathname = '/' + name;
  connection = createDatabase(url.toString());
  await migrate(connection.db, {
    migrationsFolder: 'src/server/db/migrations',
  });
  const d = snapshot(),
    db = connection.db;
  await db.insert(organizations).values(d.directory.organizations);
  await db.insert(people).values(d.directory.people);
  await db
    .insert(accountBindings)
    .values({ accountId: 'account', personId: 'actor', isSystemAdmin: false });
  await db
    .insert(grants)
    .values(d.context.grants.map((g, i) => ({ ...g, id: 'grant-' + i })));
  await db.insert(cohorts).values(d.cohorts);
  await db
    .insert(enrollments)
    .values(
      d.context.enrollments.map((e, i) => ({ ...e, id: 'enrollment-' + i })),
    );
  await db.insert(evaluationNodes).values(d.nodes);
  await db
    .insert(evaluationNodeSubjects)
    .values(d.context.evaluationNodeSubjects);
  await db.insert(evaluationRelations).values(d.context.evaluationRelations);
  await db.insert(ruleVersions).values(d.ruleVersions);
  await db.insert(dimensions).values(d.dimensions);
  await db.insert(anchors).values(d.anchors);
  await db.insert(originals).values(d.originals);
  await db.insert(originalVersions).values(d.versions);
  await db.insert(fragments).values(d.fragments);
  await db.insert(events).values(d.events);
  await db.insert(eventSources).values(d.eventSources);
  await db.insert(confirmations).values(d.confirmations);
}, 30000);
beforeEach(async () => {
  const db = connection!.db;
  await db.delete(scoreReviews);
  await db.delete(eventParticipants);
  await db.delete(auditEvents);
  await db.update(grants).set({
    role: 'manager',
    scope: 'company',
    cohortId: null,
    revokedAt: null,
  });
  await db.update(accountBindings).set({ isSystemAdmin: false });
  await db.update(events).set({ withdrawnAt: null });
  await db.update(confirmations).set({ active: true });
});
afterAll(async () => {
  await connection?.pool.end();
  if (admin) {
    try {
      if (created) await admin.query(`DROP DATABASE "${name}"`);
    } finally {
      await admin.end();
    }
  }
});
function runtime(store = createPostgresTalentExportStore(connection!.db)) {
  return createTalentExportService({
    store,
    businessNow: () => new Date('2026-09-04T00:00:00Z'),
    wallNow: () => new Date('2026-11-01T12:00:00Z'),
  });
}
const input = { scopeId: 'all', range: 'all' };
async function review() {
  await connection!.db.insert(scoreReviews).values({
    id: 'review',
    eventId: 'event-0',
    dimensionId: 'prof',
    reason: 'ai_changed_without_reason',
    status: 'open',
    saveId: null,
    confirmationId: null,
    counterpartConfirmationId: null,
    withdrawnAt: null,
  });
}
it('reads actual native source/confirmation data, writes audit and returns the CSV under Read Committed', async () => {
  const store = createPostgresTalentExportStore(connection!.db);
  await store.transaction(async (tx) => {
    const result = await tx.execute<{ isolation: string }>(
      sql`select current_setting('transaction_isolation') as isolation`,
    );
    expect(result.rows[0].isolation).toBe('read committed');
  });
  const artifact = await runtime(store).download('account', input);
  expect(artifact?.projection).toMatchObject({
    people: 1,
    rows: 4,
    skipped: 0,
  });
  expect(artifact?.csv).toContain('演示·one');
  const audits = await connection!.db.select().from(auditEvents);
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    actorId: 'account',
    action: 'talent-export.download.success',
  });
  expect(audits[0]!.resourceId).toMatch(/^talent-export:[a-f0-9]{64}$/);
});
it('a newly opened real review removes only the current affected confirmed row at download', async () => {
  const service = runtime();
  expect((await service.generate('account', input))?.projection.rows).toBe(4);
  await review();
  const artifact = await service.download('account', input);
  expect(artifact?.projection).toMatchObject({ rows: 3, skipped: 1 });
  expect(
    artifact?.projection.data.some(
      (row) => row.confirmationId === 'event-0-prof',
    ),
  ).toBe(false);
});
it('revoked or admin accounts cannot reuse the previous scope or generated file', async () => {
  const service = runtime();
  await service.generate('account', input);
  await connection!.db.update(grants).set({ revokedAt: '2026-09-04' });
  await expect(service.download('account', input)).rejects.toMatchObject({
    code: 'forbidden',
  });
  await connection!.db.update(grants).set({ revokedAt: null });
  await connection!.db.update(accountBindings).set({ isSystemAdmin: true });
  await expect(service.download('account', input)).rejects.toMatchObject({
    code: 'forbidden',
  });
  const denied = await connection!.db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.action, 'talent-export.download.denied'));
  expect(denied).toHaveLength(2);
});
it('filters hidden shared provenance before counting reviewed scores', async () => {
  await connection!.db
    .update(grants)
    .set({ role: 'hr', scope: 'cohort', cohortId: 'cohort' });
  await connection!.db
    .insert(eventParticipants)
    .values({ eventId: 'event-0', personId: 'two' });
  await review();
  const artifact = await runtime().download('account', input);
  expect(artifact?.projection).toMatchObject({ rows: 2, skipped: 0 });
  expect(
    artifact?.projection.data.every((row) => row.eventId === 'event-1'),
  ).toBe(true);
});
it('does not export a real withdrawn event or an inactive confirmation', async () => {
  await connection!.db
    .update(events)
    .set({ withdrawnAt: new Date('2026-11-01') })
    .where(eq(events.id, 'event-0'));
  await connection!.db
    .update(confirmations)
    .set({ active: false })
    .where(eq(confirmations.id, 'event-1-prof'));
  expect((await runtime().download('account', input))?.projection.rows).toBe(1);
});
it('a separately committed review during the request invalidates prior bytes and rolls back the success audit', async () => {
  const store = createPostgresTalentExportStore(connection!.db),
    audit = store.audit;
  let changed = false;
  store.audit = async (tx, event) => {
    await audit(tx, event);
    if (!changed && event.phase === 'download' && event.outcome === 'success') {
      changed = true;
      await review();
    }
  };
  await expect(runtime(store).download('account', input)).rejects.toMatchObject(
    { code: 'changed' },
  );
  const audits = await connection!.db.select().from(auditEvents);
  expect(audits.map((a) => a.action)).toEqual([
    'talent-export.download.failed',
  ]);
});

it('the same real native review exclusion and current grant checks protect single-person content preparation', async () => {
  const service = runtime();
  const first = await service.person('account', { personId: 'one' });
  expect(first.projection.rows).toBe(4);
  expect(first.unavailableSections).toContain('formal_position');
  await review();
  expect(
    (await service.person('account', { personId: 'one' })).projection,
  ).toMatchObject({ rows: 3, skipped: 1 });
  await connection!.db.update(grants).set({ revokedAt: '2026-09-04' });
  await expect(
    service.person('account', { personId: 'one' }),
  ).rejects.toMatchObject({ code: 'forbidden' });
  const audits = await connection!.db.select().from(auditEvents);
  expect(audits.map((a) => a.action)).toEqual([
    'talent-export.print.success',
    'talent-export.print.success',
    'talent-export.print.denied',
  ]);
});
