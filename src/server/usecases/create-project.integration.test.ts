import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';
import { createDatabase } from '../db/client';
import { importDemo } from '../db/import';
import { mapPrototypeSeed, readPrototypeSeed } from '../db/seed';
import { createProject } from './create-project';
import {
  projects,
  members,
  memberLogs,
  createRequests,
} from '../modules/staffing';
import { grants } from '../modules/directory';
import { auditEvents } from '../platform/audit/schema';
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
const name = `qtalent_${randomUUID().replaceAll('-', '')}_test`;
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source)
    throw new Error(
      'Real PostgreSQL integration is required: set TEST_DATABASE_URL to an isolated loopback PostgreSQL database ending _test. No mock or skip fallback.',
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
  await importDemo(
    connection.db,
    mapPrototypeSeed(readPrototypeSeed(process.cwd())),
    'Test-password-not-a-secret',
  );
}, 30_000);
afterAll(async () => {
  await connection?.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
  }
});
const input = () => ({
  requestId: randomUUID(),
  name: `集成测试项目-${randomUUID()}`,
  type: '业务项目' as const,
  status: '进行中' as const,
  goal: '仅测试',
  ownerId: null,
  memberIds: [],
});
it('atomic creation, concurrent duplicate replay, and request payload conflict', async () => {
  const db = connection!.db,
    payload = input();
  const results = await Promise.all([
    createProject(db, 'demo-ceo', payload, '2026-09-04'),
    createProject(db, 'demo-ceo', payload, '2026-09-04'),
  ]);
  expect(results[0].projectId).toBe(results[1].projectId);
  const id = results[0].projectId;
  expect(
    await db.select().from(projects).where(eq(projects.id, id)),
  ).toHaveLength(1);
  expect(
    await db.select().from(memberLogs).where(eq(memberLogs.projectId, id)),
  ).toHaveLength(1);
  expect(
    await db.select().from(auditEvents).where(eq(auditEvents.resourceId, id)),
  ).toHaveLength(1);
  expect(
    await db
      .select()
      .from(createRequests)
      .where(eq(createRequests.projectId, id)),
  ).toHaveLength(1);
  await expect(
    createProject(
      db,
      'demo-ceo',
      { ...payload, name: '不同内容' },
      '2026-09-04',
    ),
  ).rejects.toThrow('同一提交');
});
it('rolls back all project effects when audit insert fails', async () => {
  const db = connection!.db,
    payload = input();
  await db.execute(
    sql`CREATE FUNCTION fail_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failed'; END; $$`,
  );
  await db.execute(
    sql`CREATE TRIGGER fail_test_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_test_audit()`,
  );
  try {
    await expect(
      createProject(db, 'demo-ceo', payload, '2026-09-04'),
    ).rejects.toThrow();
    expect(
      await db
        .select()
        .from(createRequests)
        .where(eq(createRequests.requestId, payload.requestId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(projects).where(eq(projects.name, payload.name)),
    ).toHaveLength(0);
  } finally {
    await db.execute(sql`DROP TRIGGER fail_test_audit ON audit_events`);
    await db.execute(sql`DROP FUNCTION fail_test_audit()`);
  }
});
it('rejects forged people and current revocation after prior success', async () => {
  const db = connection!.db;
  await expect(
    createProject(
      db,
      'demo-hrbp',
      { ...input(), ownerId: 'outside-or-forged' },
      '2026-09-04',
    ),
  ).rejects.toThrow();
  const payload = input();
  await createProject(db, 'demo-hrbp', payload, '2026-09-04');
  await db
    .update(grants)
    .set({ revokedAt: '2026-09-04' })
    .where(eq(grants.accountId, 'demo-hrbp'));
  await expect(
    createProject(db, 'demo-hrbp', payload, '2026-09-04'),
  ).rejects.toThrow();
});
it('owner included once and members, log, audit commit together', async () => {
  const db = connection!.db;
  const seed = mapPrototypeSeed(readPrototypeSeed(process.cwd()));
  const eligible = seed.people.filter((p) => !p.noReview).slice(0, 2);
  const result = await createProject(
    db,
    'demo-ceo',
    {
      ...input(),
      ownerId: eligible[0].id,
      memberIds: eligible.map((p) => p.id),
    },
    '2026-09-04',
  );
  expect(
    await db
      .select()
      .from(members)
      .where(eq(members.projectId, result.projectId)),
  ).toHaveLength(2);
});
