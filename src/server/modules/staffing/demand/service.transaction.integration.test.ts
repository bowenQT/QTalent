import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase, type DbExecutor } from '../../../db/client';
import { jobSnapshots } from '../../../jobs/schema';
import {
  accountBindings,
  grants,
  organizations,
  people,
} from '../../directory';
import {
  createStaffingDemandRuntime,
  staffingDemandQueue,
} from '../../../usecases/staffing-demand-runtime';
import { projects } from '../schema';
import { demandOperations, demandRoots, demandVersions } from './schema';
import { DemandAccessError } from './service';
import { DemandConflictError } from './version';

const database = `qtalent_demand_tx_${randomUUID().replaceAll('-', '')}_test`;
const now = '2026-11-01T12:00:00.000Z';
const accountId = 'demo-demand-transaction-account';
const projectId = 'demo-demand-transaction-project';
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase>;
let boss: PgBoss;
let service: ReturnType<typeof createStaffingDemandRuntime>['service'];

beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source)
    throw new Error('TEST_DATABASE_URL required; no mock or skip fallback');
  const url = new URL(source);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Only isolated loopback test databases are allowed');
  admin = new Pool({ connectionString: source });
  await admin.query(`CREATE DATABASE "${database}"`);
  url.pathname = '/' + database;
  connection = createDatabase(url.toString());
  await migrate(connection.db, {
    migrationsFolder: 'src/server/db/migrations',
  });
  boss = new PgBoss({ connectionString: url.toString() });
  await boss.start();
  await boss.createQueue(staffingDemandQueue);
  await connection.db.insert(organizations).values({
    id: 'demo-demand-transaction-org',
    name: '演示组织',
    shortName: '演示',
  });
  await connection.db.insert(people).values({
    id: 'demo-demand-transaction-actor',
    name: '演示管理者',
    organizationId: 'demo-demand-transaction-org',
    demo: true,
  });
  await connection.db.insert(accountBindings).values({
    accountId,
    personId: 'demo-demand-transaction-actor',
    isSystemAdmin: false,
  });
  await connection.db.insert(grants).values({
    id: 'demo-demand-transaction-grant',
    accountId,
    role: 'manager',
    scope: 'company',
    validFrom: '2026-01-01',
  });
  await connection.db.insert(projects).values({
    id: projectId,
    name: '演示项目',
    type: '业务项目',
    status: '筹备中',
    goal: '演示',
    organizationId: 'demo-demand-transaction-org',
    cohortId: 'demo-demand-transaction-cohort',
    creatorId: 'demo-demand-transaction-actor',
    from: '2026-01-01',
    to: '2026-12-31',
  });
  // Exercise the production authorization loader and pg-boss transaction adapter.
  // No worker or model client is registered by this producer-only runtime.
  service = createStaffingDemandRuntime({
    db: connection.db,
    boss,
    now: () => now,
  }).service;
}, 30000);

afterAll(async () => {
  if (boss) await boss.stop();
  if (connection) await connection.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    await admin.end();
  }
});

const input = () => ({
  operationId: randomUUID(),
  projectId,
  inputText: '演示：需要工程负责人',
});

async function effects(db: DbExecutor, demandId: string) {
  const roots = await db
    .select()
    .from(demandRoots)
    .where(eq(demandRoots.id, demandId));
  const jobs = await db
    .select()
    .from(jobSnapshots)
    .where(eq(jobSnapshots.jobId, demandId));
  const operations = await db
    .select()
    .from(demandOperations)
    .where(eq(demandOperations.demandId, demandId));
  const versions = await db
    .select()
    .from(demandVersions)
    .where(eq(demandVersions.demandId, demandId));
  const queued = await db.execute(
    sql`select id from pgboss.job where name = ${staffingDemandQueue} and data->>'jobId' = ${demandId}`,
  );
  return {
    roots: roots.length,
    jobs: jobs.length,
    operations: operations.length,
    versions: versions.length,
    queued: queued.rows.length,
  };
}

const absent = { roots: 0, jobs: 0, operations: 0, versions: 0, queued: 0 };
const accepted = { roots: 1, jobs: 1, operations: 1, versions: 0, queued: 1 };

it('keeps every demand and pg-boss write in the caller transaction and rolls all of it back on outer failure', async () => {
  const request = input();
  const failure = new Error('synthetic outer transaction failure');
  let demandId = '';
  await expect(
    connection.db.transaction(async (tx) => {
      await tx
        .update(projects)
        .set({ goal: '演示：未提交的外层变更' })
        .where(eq(projects.id, projectId));
      const created = await service.createInTransaction(tx, accountId, request);
      demandId = created.snapshot.jobId;
      expect(created.replayed).toBe(false);
      expect(await effects(tx, demandId)).toEqual(accepted);
      // A separate pool connection must see neither the queue row nor business rows.
      expect(await effects(connection.db, demandId)).toEqual(absent);
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(demandId).not.toBe('');
  expect(await effects(connection.db, demandId)).toEqual(absent);
  expect(
    await connection.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId)),
  ).toMatchObject([{ goal: '演示' }]);
  const retried = await service.create(accountId, request);
  expect(retried.replayed).toBe(false);
  expect(retried.snapshot.jobId).not.toBe(demandId);
  expect(await effects(connection.db, retried.snapshot.jobId)).toEqual(
    accepted,
  );
});

it('replays the same operation before and after commit through either entry without another job or queue row', async () => {
  const request = input();
  const created = await connection.db.transaction(async (tx) => {
    const first = await service.createInTransaction(tx, accountId, request);
    expect(await service.createInTransaction(tx, accountId, request)).toEqual({
      ...first,
      replayed: true,
    });
    expect(await effects(tx, first.snapshot.jobId)).toEqual(accepted);
    return first;
  });
  expect(await service.create(accountId, request)).toEqual({
    ...created,
    replayed: true,
  });
  expect(
    await connection.db.transaction((tx) =>
      service.createInTransaction(tx, accountId, request),
    ),
  ).toEqual({ ...created, replayed: true });
  expect(await effects(connection.db, created.snapshot.jobId)).toEqual(
    accepted,
  );
});

it('rejects a reused operation with a changed payload and rolls back the surrounding writes', async () => {
  const request = input();
  const created = await service.create(accountId, request);
  await expect(
    connection.db.transaction(async (tx) => {
      await tx
        .update(projects)
        .set({ goal: '演示：不应提交的冲突变更' })
        .where(eq(projects.id, projectId));
      await service.createInTransaction(tx, accountId, {
        ...request,
        inputText: '演示：不同需求',
      });
    }),
  ).rejects.toBeInstanceOf(DemandConflictError);
  expect(
    await connection.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId)),
  ).toMatchObject([{ goal: '演示' }]);
  expect(await effects(connection.db, created.snapshot.jobId)).toEqual(
    accepted,
  );
  expect(await service.create(accountId, request)).toEqual({
    ...created,
    replayed: true,
  });
});

it('serializes concurrent outer transactions and the existing create wrapper on one operation', async () => {
  const request = input();
  const results = await Promise.all([
    connection.db.transaction((tx) =>
      service.createInTransaction(tx, accountId, request),
    ),
    service.create(accountId, request),
  ]);
  expect(results[0].snapshot).toEqual(results[1].snapshot);
  expect(results.map((result) => result.replayed).sort()).toEqual([
    false,
    true,
  ]);
  expect(await effects(connection.db, results[0].snapshot.jobId)).toEqual(
    accepted,
  );
});

it('rechecks real authorization in the caller transaction even for an accepted operation', async () => {
  const request = input();
  const created = await service.create(accountId, request);
  await expect(
    connection.db.transaction(async (tx) => {
      await tx
        .update(grants)
        .set({ revokedAt: now })
        .where(eq(grants.accountId, accountId));
      await service.createInTransaction(tx, accountId, request);
    }),
  ).rejects.toBeInstanceOf(DemandAccessError);
  expect(await service.create(accountId, request)).toEqual({
    ...created,
    replayed: true,
  });
  expect(await effects(connection.db, created.snapshot.jobId)).toEqual(
    accepted,
  );
});
