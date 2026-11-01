import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { ZodError } from 'zod';
import type { StaffingDemand } from '../../../../contracts/staffing';
import { metadataFor } from '../../../integrations/maas';
import { DEMAND_PROMPT_VERSION } from './prompt';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase, type DbExecutor } from '../../../db/client';
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
const database = `qtalent_demand_read_tx_${randomUUID().replaceAll('-', '')}_test`;
const now = '2026-11-01T12:00:00.000Z';
const accountId = 'demo-demand-read-transaction-account';
const projectId = 'demo-demand-read-transaction-project';
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
    id: 'demo-demand-read-transaction-org',
    name: '演示组织',
    shortName: '演示',
  });
  await connection.db.insert(people).values({
    id: 'demo-demand-read-transaction-actor',
    name: '演示管理者',
    organizationId: 'demo-demand-read-transaction-org',
    demo: true,
  });
  await connection.db.insert(accountBindings).values({
    accountId,
    personId: 'demo-demand-read-transaction-actor',
    isSystemAdmin: false,
  });
  await connection.db.insert(grants).values({
    id: 'demo-demand-read-transaction-grant',
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
    organizationId: 'demo-demand-read-transaction-org',
    cohortId: 'demo-demand-read-transaction-cohort',
    creatorId: 'demo-demand-read-transaction-actor',
    from: '2026-01-01',
    to: '2026-12-31',
  });
  // Exercise the production authorization loader; no worker or model client.
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
function draft(id: string, revision = 1): StaffingDemand {
  return {
    id,
    projectId,
    revision,
    inputText: '演示：需要工程负责人',
    status: 'draft',
    requirements: [
      { id: 'demo-requirement', text: '演示：工程交付', priority: 'required' },
    ],
  };
}
async function insertVersion(db: DbExecutor, demand: StaffingDemand) {
  await db.insert(demandVersions).values({
    demandId: demand.id,
    revision: demand.revision,
    demand,
    promptVersion: DEMAND_PROMPT_VERSION,
    modelMetadata: metadataFor({ promptVersion: DEMAND_PROMPT_VERSION }),
    actorAccountId: accountId,
    createdAt: now,
  });
  await db
    .update(demandRoots)
    .set({ currentRevision: demand.revision })
    .where(eq(demandRoots.id, demand.id));
}
// Persist genuine demand-version facts, not a queued acknowledgement treated as a result.
async function persistedDraft() {
  const demand = draft(randomUUID());
  await connection.db.transaction(async (tx) => {
    await tx.insert(demandRoots).values({
      id: demand.id,
      projectId,
      initiatorAccountId: accountId,
      initiatorPersonId: 'demo-demand-read-transaction-actor',
      inputText: demand.inputText,
      promptVersion: DEMAND_PROMPT_VERSION,
      createdAt: now,
    });
    await insertVersion(tx, demand);
  });
  return demand;
}
it('reads uncommitted root and version facts only in the caller transaction and rolls them back', async () => {
  const failure = new Error('synthetic outer rollback');
  let demandId = '';
  await expect(
    connection.db.transaction(async (tx) => {
      const accepted = await service.createInTransaction(tx, accountId, {
        operationId: randomUUID(),
        projectId,
        inputText: '演示：需要工程负责人',
      });
      demandId = accepted.snapshot.jobId;
      expect(accepted.snapshot.result).toBeNull();
      expect(
        await service.readInTransaction(tx, accountId, demandId),
      ).toBeNull();
      const demand = draft(demandId);
      await insertVersion(tx, demand);
      expect(await service.readInTransaction(tx, accountId, demandId)).toEqual(
        demand,
      );
      expect(
        await service.readInTransaction(tx, accountId, demandId, 1),
      ).toEqual(demand);
      // The wrapper must use a separate connection; it cannot see caller-owned writes.
      expect(await service.read(accountId, demandId)).toBeNull();
      expect(
        await connection.db
          .select()
          .from(demandRoots)
          .where(eq(demandRoots.id, demandId)),
      ).toEqual([]);
      expect(
        await connection.db
          .select()
          .from(demandVersions)
          .where(eq(demandVersions.demandId, demandId)),
      ).toEqual([]);
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(demandId).not.toBe('');
  expect(await service.read(accountId, demandId)).toBeNull();
  expect(
    await connection.db
      .select()
      .from(demandRoots)
      .where(eq(demandRoots.id, demandId)),
  ).toEqual([]);
  expect(
    await connection.db
      .select()
      .from(demandVersions)
      .where(eq(demandVersions.demandId, demandId)),
  ).toEqual([]);
  expect(
    await connection.db
      .select()
      .from(demandOperations)
      .where(eq(demandOperations.demandId, demandId)),
  ).toEqual([]);
});
it('uses the uncommitted currentRevision without exposing it outside, and restores the old version after rollback', async () => {
  const original = await persistedDraft();
  const changed = {
    ...original,
    revision: 2,
    inputText: '演示：未提交的需求版本',
  };
  const failure = new Error('synthetic revision rollback');
  await expect(
    connection.db.transaction(async (tx) => {
      await insertVersion(tx, changed);
      expect(
        await service.readInTransaction(tx, accountId, original.id),
      ).toEqual(changed);
      expect(
        await service.readInTransaction(tx, accountId, original.id, 1),
      ).toEqual(original);
      expect(await service.read(accountId, original.id)).toEqual(original);
      expect(await service.read(accountId, original.id, 2)).toBeNull();
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(await service.read(accountId, original.id)).toEqual(original);
  expect(await service.read(accountId, original.id, 2)).toBeNull();
});
it('preserves wrapper, current and explicit historical outputs after commit', async () => {
  const original = await persistedDraft();
  const confirmed = await service.change(
    accountId,
    { operationId: randomUUID(), demandId: original.id, expectedRevision: 1 },
    { action: 'confirm' },
  );
  expect(confirmed.demand).toMatchObject({ revision: 2, status: 'confirmed' });
  await connection.db.transaction(async (tx) => {
    expect(await service.readInTransaction(tx, accountId, original.id)).toEqual(
      confirmed.demand,
    );
    expect(
      await service.readInTransaction(tx, accountId, original.id, 2),
    ).toEqual(confirmed.demand);
    expect(
      await service.readInTransaction(tx, accountId, original.id, 1),
    ).toEqual(original);
    // Zero is explicit, not a falsy request for the current version.
    for (const revision of [0, 99]) {
      expect(
        await service.readInTransaction(tx, accountId, original.id, revision),
      ).toBeNull();
      expect(await service.read(accountId, original.id, revision)).toBeNull();
    }
    expect(
      await service.readInTransaction(tx, accountId, 'demo-missing-demand'),
    ).toBeNull();
  });
  expect(await service.read(accountId, original.id)).toEqual(confirmed.demand);
  expect(await service.read(accountId, original.id, 1)).toEqual(original);
});
it('returns null for a missing current version rather than falling back to history or a queued snapshot', async () => {
  const original = await persistedDraft();
  await connection.db.transaction(async (tx) => {
    await tx
      .update(demandRoots)
      .set({ currentRevision: 99 })
      .where(eq(demandRoots.id, original.id));
    expect(
      await service.readInTransaction(tx, accountId, original.id),
    ).toBeNull();
    expect(
      await service.readInTransaction(tx, accountId, original.id, 1),
    ).toEqual(original);
    expect(await service.read(accountId, original.id)).toEqual(original);
  });
  expect(await service.read(accountId, original.id)).toBeNull();
  expect(await service.read(accountId, original.id, 1)).toEqual(original);
});
it('reloads real grants for current and historical reads inside the caller transaction and restores them on rollback', async () => {
  const original = await persistedDraft();
  const failure = new Error('synthetic grant rollback');
  await expect(
    connection.db.transaction(async (tx) => {
      expect(
        await service.readInTransaction(tx, accountId, original.id),
      ).toEqual(original);
      await tx
        .update(grants)
        .set({ revokedAt: now })
        .where(eq(grants.accountId, accountId));
      expect(
        await service.readInTransaction(tx, accountId, original.id),
      ).toBeNull();
      expect(
        await service.readInTransaction(tx, accountId, original.id, 1),
      ).toBeNull();
      expect(await service.read(accountId, original.id)).toEqual(original);
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(await service.read(accountId, original.id)).toEqual(original);
});
it('loads the current binding before even a missing root and propagates its access error', async () => {
  const original = await persistedDraft();
  const failure = new Error('synthetic binding rollback');
  await expect(
    connection.db.transaction(async (tx) => {
      // Remove the referencing grant in this uncommitted transaction first;
      // a dangling FK is not a valid missing-binding fixture.
      await tx.delete(grants).where(eq(grants.accountId, accountId));
      await tx
        .delete(accountBindings)
        .where(eq(accountBindings.accountId, accountId));
      await expect(
        service.readInTransaction(tx, accountId, original.id),
      ).rejects.toBeInstanceOf(DemandAccessError);
      await expect(
        service.readInTransaction(tx, accountId, 'demo-missing-demand'),
      ).rejects.toBeInstanceOf(DemandAccessError);
      expect(await service.read(accountId, original.id)).toEqual(original);
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(await service.read(accountId, original.id)).toEqual(original);
});
it('parses stored demand JSON only after current authorization and propagates Zod failures through both entries', async () => {
  const original = await persistedDraft();
  await connection.db
    .update(demandVersions)
    .set({
      demand: sql`${JSON.stringify({ ...original, requirements: [] })}::jsonb`,
    })
    .where(eq(demandVersions.demandId, original.id));
  await expect(service.read(accountId, original.id)).rejects.toBeInstanceOf(
    ZodError,
  );
  await expect(
    connection.db.transaction((tx) =>
      service.readInTransaction(tx, accountId, original.id),
    ),
  ).rejects.toBeInstanceOf(ZodError);
  const failure = new Error('synthetic parse-order rollback');
  await expect(
    connection.db.transaction(async (tx) => {
      await tx
        .update(grants)
        .set({ revokedAt: now })
        .where(eq(grants.accountId, accountId));
      expect(
        await service.readInTransaction(tx, accountId, original.id),
      ).toBeNull();
      expect(
        await service.readInTransaction(tx, accountId, original.id, 1),
      ).toBeNull();
      throw failure;
    }),
  ).rejects.toBe(failure);
});
it('takes a fresh full clock instant on every read before evaluating temporal authorization', async () => {
  const original = await persistedDraft();
  let instant = '2026-11-01T23:59:59.999Z';
  let clockCalls = 0;
  const timed = createStaffingDemandRuntime({
    db: connection.db,
    boss,
    now: () => {
      clockCalls++;
      return instant;
    },
  }).service;
  // The real grant schema stores dates, so exercise its actual midnight edge.
  const revokedAt = '2026-11-02';
  const failure = new Error('synthetic temporal rollback');
  await expect(
    connection.db.transaction(async (tx) => {
      await tx
        .update(grants)
        .set({ revokedAt })
        .where(eq(grants.accountId, accountId));
      expect(await timed.readInTransaction(tx, accountId, original.id)).toEqual(
        original,
      );
      expect(clockCalls).toBe(1);
      instant = '2026-11-02T00:00:00.000Z';
      expect(
        await timed.readInTransaction(tx, accountId, original.id),
      ).toBeNull();
      expect(clockCalls).toBe(2);
      // The old wrapper samples the same clock but cannot see the pending revocation.
      expect(await timed.read(accountId, original.id)).toEqual(original);
      expect(clockCalls).toBe(3);
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(await timed.read(accountId, original.id)).toEqual(original);
  expect(clockCalls).toBe(4);
});
