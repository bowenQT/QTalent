import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { JobSnapshot } from '../../../../contracts/jobs';
import { staffingDemandSchema } from '../../../../contracts/staffing';
import {
  createDatabase,
  type DbExecutor,
  type Transaction,
} from '../../../db/client';
import { createFakeModelinkMaas } from '../../../integrations/maas';
import { createJobStore } from '../../../jobs/repository';
import { jobOperations, jobSnapshots } from '../../../jobs/schema';
import { createJobService } from '../../../jobs/service';
import {
  createStaffingDemandRuntime,
  staffingDemandQueue,
} from '../../../usecases/staffing-demand-runtime';
import {
  accountBindings,
  grants,
  organizations,
  people,
} from '../../directory';
import { projects } from '../schema';
import { demandOperations, demandRoots, demandVersions } from './schema';

const database = `qtalent_demand_snapshot_${randomUUID().replaceAll('-', '')}_test`;
const now = '2026-11-01T12:00:00.000Z';
const projectId = 'demo-demand-snapshot-project';
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase>;
let boss: PgBoss;
let runtime: ReturnType<typeof createStaffingDemandRuntime>;
let model: ReturnType<typeof createFakeModelinkMaas>;

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
    id: 'demo-demand-snapshot-org',
    name: '演示组织',
    shortName: '演示',
  });
  await connection.db.insert(people).values({
    id: 'demo-demand-snapshot-project-creator',
    name: '演示项目创建人',
    organizationId: 'demo-demand-snapshot-org',
    demo: true,
  });
  await connection.db.insert(projects).values({
    id: projectId,
    name: '演示项目',
    type: '业务项目',
    status: '筹备中',
    goal: '演示',
    organizationId: 'demo-demand-snapshot-org',
    cohortId: 'demo-demand-snapshot-cohort',
    creatorId: 'demo-demand-snapshot-project-creator',
    from: '2026-01-01',
    to: '2026-12-31',
  });
  // Only the provider boundary is fake. Authorization, persistence, queue and
  // the worker's generation/state transitions use their production code.
  model = createFakeModelinkMaas({
    requirements: [{ text: '演示：工程交付', priority: 'required' }],
  });
  vi.spyOn(model, 'generateStructured');
  runtime = createStaffingDemandRuntime({
    db: connection.db,
    boss,
    maas: model,
    now: () => now,
  });
}, 30000);

afterAll(async () => {
  if (boss) await boss.stop();
  if (connection) await connection.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    await admin.end();
  }
});

async function actor() {
  const accountId = randomUUID();
  const personId = randomUUID();
  await connection.db.insert(people).values({
    id: personId,
    name: '演示管理者',
    organizationId: 'demo-demand-snapshot-org',
    demo: true,
  });
  await connection.db.insert(accountBindings).values({ accountId, personId });
  await connection.db.insert(grants).values({
    id: randomUUID(),
    accountId,
    role: 'manager',
    scope: 'company',
    validFrom: '2026-01-01',
  });
  return { accountId, personId };
}
const request = () => ({
  operationId: randomUUID(),
  projectId,
  inputText: '演示：需要工程负责人',
});
async function native() {
  const owner = await actor();
  const input = request();
  const accepted = await runtime.service.create(owner.accountId, input);
  return {
    ...owner,
    operationId: input.operationId,
    jobId: accepted.snapshot.jobId,
  };
}
type Creation = Awaited<ReturnType<typeof native>>;

/** Full business rows, not just counts: reads must not update existing facts either. */
async function effects(db: DbExecutor) {
  return {
    roots: await db.select().from(demandRoots).orderBy(demandRoots.id),
    versions: await db
      .select()
      .from(demandVersions)
      .orderBy(demandVersions.demandId, demandVersions.revision),
    operations: await db
      .select()
      .from(demandOperations)
      .orderBy(demandOperations.accountId, demandOperations.operationId),
    jobs: await db.select().from(jobSnapshots).orderBy(jobSnapshots.jobId),
    jobOperations: await db
      .select()
      .from(jobOperations)
      .orderBy(
        jobOperations.jobId,
        jobOperations.accountId,
        jobOperations.operationId,
      ),
    queue: (
      await db.execute(
        sql`select id, name, data, state from pgboss.job order by id`,
      )
    ).rows,
    // Capture every existing audit column without assuming a pending metadata migration.
    audit: (
      await db.execute(
        sql`select to_jsonb(a) as row from audit_events a order by id`,
      )
    ).rows,
  };
}
async function readUnchanged(tx: Transaction, creation: Creation) {
  const before = await effects(tx);
  const calls = vi.mocked(model.generateStructured).mock.calls.length;
  const result = await runtime.readCreationSnapshotInTransaction(
    tx,
    creation.accountId,
    creation,
  );
  expect(await effects(tx)).toEqual(before);
  expect(model.generateStructured).toHaveBeenCalledTimes(calls);
  return result;
}
const read = (creation: Creation) =>
  connection.db.transaction((tx) => readUnchanged(tx, creation));

it('sees an uncommitted native create only in its caller transaction and rolls every creation fact back', async () => {
  const owner = await actor();
  const input = request();
  const before = await effects(connection.db);
  const rollback = new Error('synthetic outer rollback');
  let creation: Creation | undefined;
  await expect(
    connection.db.transaction(async (tx) => {
      const accepted = await runtime.service.createInTransaction(
        tx,
        owner.accountId,
        input,
      );
      creation = {
        ...owner,
        operationId: input.operationId,
        jobId: accepted.snapshot.jobId,
      };
      expect(await readUnchanged(tx, creation)).toMatchObject({
        jobId: creation.jobId,
        kind: 'staffing_demand',
        status: 'queued',
        result: null,
        progress: { completed: 0, total: 1 },
      });
      expect(await read(creation)).toBeNull();
      expect(await effects(connection.db)).toEqual(before);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
  expect(creation).toBeDefined();
  expect(await read(creation!)).toBeNull();
  expect(await effects(connection.db)).toEqual(before);
});

it('returns the actual committed queued projection rather than the immutable create acknowledgement', async () => {
  const creation = await native();
  const snapshot = await read(creation);
  expect(snapshot).toMatchObject({
    status: 'queued',
    result: null,
    canCancel: true,
    canRetry: false,
  });
  const shared = createJobService(
    createJobStore(connection.db),
    [runtime.policy],
    () => now,
  );
  const response = await shared.read(creation.accountId, creation.jobId);
  expect(response).toEqual({ status: 'success', snapshot });
});

it('returns real generation output and never substitutes a later edited or confirmed demand version', async () => {
  const creation = await native();
  await runtime.run({ jobId: creation.jobId, attempt: 1 });
  const generated = await read(creation);
  expect(generated).toMatchObject({
    status: 'completed',
    revision: 3,
    result: { id: creation.jobId, projectId, revision: 1, status: 'draft' },
    progress: { completed: 1, total: 1 },
    canRetry: false,
    canCancel: false,
  });
  const original = staffingDemandSchema.parse(generated!.result);
  const edited = await runtime.service.change(
    creation.accountId,
    {
      operationId: randomUUID(),
      demandId: creation.jobId,
      expectedRevision: 1,
    },
    {
      action: 'edit',
      requirements: [
        { ...original.requirements[0], text: '演示：后续人工编辑' },
      ],
    },
  );
  await runtime.service.change(
    creation.accountId,
    {
      operationId: randomUUID(),
      demandId: creation.jobId,
      expectedRevision: edited.demand.revision,
    },
    { action: 'confirm' },
  );
  expect(await read(creation)).toEqual(generated);
  expect(
    await runtime.service.read(creation.accountId, creation.jobId),
  ).toMatchObject({
    revision: 3,
    status: 'confirmed',
    requirements: [{ text: '演示：后续人工编辑' }],
  });
});

it('rejects wrong operations, missing jobs and another creator’s job despite a company manager grant', async () => {
  const first = await native();
  const other = await native();
  for (const input of [
    { ...first, operationId: randomUUID() },
    { ...first, jobId: randomUUID() },
    { ...first, jobId: other.jobId },
    { ...other, accountId: first.accountId },
  ])
    expect(await read(input)).toBeNull();
});

it('rejects an actual edit operation even when it points at the same demand', async () => {
  const creation = await native();
  await runtime.run({ jobId: creation.jobId, attempt: 1 });
  const operationId = randomUUID();
  await runtime.service.change(
    creation.accountId,
    { operationId, demandId: creation.jobId, expectedRevision: 1 },
    {
      action: 'edit',
      requirements: [
        { id: randomUUID(), text: '演示：修改要求', priority: 'required' },
      ],
    },
  );
  expect(await read({ ...creation, operationId })).toBeNull();
});

it.each(['binding', 'revoked', 'missing-binding'] as const)(
  'reloads current %s rather than trusting creation-time authority',
  async (change) => {
    const creation = await native();
    if (change === 'binding') {
      const replacement = await actor();
      await connection.db
        .update(accountBindings)
        .set({ personId: replacement.personId })
        .where(eq(accountBindings.accountId, creation.accountId));
    } else if (change === 'revoked') {
      await connection.db
        .update(grants)
        .set({ revokedAt: '2026-11-01' })
        .where(eq(grants.accountId, creation.accountId));
    } else {
      await connection.db
        .delete(grants)
        .where(eq(grants.accountId, creation.accountId));
      await connection.db
        .delete(accountBindings)
        .where(eq(accountBindings.accountId, creation.accountId));
    }
    expect(await read(creation)).toBeNull();
  },
);

it.each([
  'fingerprint',
  'operation-revision',
  'initiator-account',
  'kind',
  'resource',
  'input-version',
  'root-input',
  'root-prompt',
] as const)(
  'rejects inconsistent %s without creating or changing any records',
  async (change) => {
    const creation = await native();
    await connection.db.transaction(async (tx) => {
      if (change === 'fingerprint' || change === 'operation-revision') {
        await tx
          .update(demandOperations)
          .set(
            change === 'fingerprint'
              ? {
                  fingerprint:
                    '["create","different-project","different-input"]',
                }
              : { revision: 1 },
          )
          .where(
            and(
              eq(demandOperations.accountId, creation.accountId),
              eq(demandOperations.operationId, creation.operationId),
            ),
          );
      } else if (
        change === 'initiator-account' ||
        change === 'root-input' ||
        change === 'root-prompt'
      ) {
        await tx
          .update(demandRoots)
          .set(
            change === 'initiator-account'
              ? { initiatorAccountId: 'demo-another-account' }
              : change === 'root-input'
                ? { inputText: '演示：不同初始输入' }
                : { promptVersion: 'different-prompt' },
          )
          .where(eq(demandRoots.id, creation.jobId));
      } else {
        await tx
          .update(jobSnapshots)
          .set(
            change === 'kind'
              ? { kind: 'another-kind' }
              : change === 'resource'
                ? { resourceId: randomUUID() }
                : { inputVersion: 'different-version' },
          )
          .where(eq(jobSnapshots.jobId, creation.jobId));
      }
      expect(await readUnchanged(tx, creation)).toBeNull();
    });
  },
);

it.each(['id', 'projectId', 'inputText', 'revision'] as const)(
  'rejects a completed result whose %s disagrees with creation facts',
  async (field) => {
    const creation = await native();
    await runtime.run({ jobId: creation.jobId, attempt: 1 });
    const generated = await read(creation);
    const result = staffingDemandSchema.parse(generated!.result);
    await connection.db
      .update(jobSnapshots)
      .set({
        result: {
          ...result,
          [field]: field === 'revision' ? 2 : 'demo-other-value',
        },
      })
      .where(eq(jobSnapshots.jobId, creation.jobId));
    expect(await read(creation)).toBeNull();
  },
);

it('rejects a queued row carrying a stale result instead of leaking it as an initial result', async () => {
  const creation = await native();
  await runtime.run({ jobId: creation.jobId, attempt: 1 });
  // Preserve the genuine generated result while corrupting only its state.
  await connection.db
    .update(jobSnapshots)
    .set({ status: 'queued' })
    .where(eq(jobSnapshots.jobId, creation.jobId));
  expect(await read(creation)).toBeNull();
});

it('reuses the shared safe error and retry/cancel projection for a failed actual job', async () => {
  const creation = await native();
  await connection.db.transaction(async (tx) => {
    await tx
      .update(demandRoots)
      .set({ retryable: true })
      .where(eq(demandRoots.id, creation.jobId));
    await tx
      .update(jobSnapshots)
      .set({ status: 'failed', errorCode: 'processing_failed', revision: 3 })
      .where(eq(jobSnapshots.jobId, creation.jobId));
  });
  const snapshot = await read(creation);
  expect(snapshot).toMatchObject({
    status: 'failed',
    result: null,
    canRetry: true,
    error: { code: 'processing_failed', message: '处理失败，可以检查后重试' },
  });
  const shared = createJobService(
    createJobStore(connection.db),
    [runtime.policy],
    () => now,
  );
  expect(await shared.read(creation.accountId, creation.jobId)).toEqual({
    status: 'success',
    snapshot,
  });
});

/** Confirm a real lock wait before committing the concurrently changed facts. */
async function waitAndChange(
  creation: Creation,
  lock: 'job' | 'root',
  change: (tx: Transaction) => Promise<void>,
): Promise<JobSnapshot | null> {
  const calls = vi.mocked(model.generateStructured).mock.calls.length;
  let reading: Promise<JobSnapshot | null> | undefined;
  let signal: (pid: number) => void = () => undefined;
  let fail: (error: unknown) => void = () => undefined;
  const ready = new Promise<number>((resolve, reject) => {
    signal = resolve;
    fail = reject;
  });
  let expectedEffects: Awaited<ReturnType<typeof effects>> | undefined;
  try {
    await connection.db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout = '10s'`);
      const blocker = await tx.execute<{ pid: number }>(
        sql`select pg_backend_pid() as pid`,
      );
      if (lock === 'job')
        await tx
          .select()
          .from(jobSnapshots)
          .where(eq(jobSnapshots.jobId, creation.jobId))
          .for('update');
      else
        await tx
          .select()
          .from(demandRoots)
          .where(eq(demandRoots.id, creation.jobId))
          .for('update');
      reading = connection.db.transaction(
        async (readerTx) => {
          await readerTx.execute(sql`set local statement_timeout = '10s'`);
          const reader = await readerTx.execute<{ pid: number }>(
            sql`select pg_backend_pid() as pid`,
          );
          signal(reader.rows[0]!.pid);
          return runtime.readCreationSnapshotInTransaction(
            readerTx,
            creation.accountId,
            creation,
          );
        },
        { isolationLevel: 'read committed' },
      );
      void reading.catch(fail);
      const readerPid = await ready;
      await expect
        .poll(
          async () => {
            const waiting = await connection.db.execute<{ blocked: boolean }>(
              sql`select ${blocker.rows[0]!.pid}::int = any(pg_blocking_pids(${readerPid}::int)) as blocked`,
            );
            return waiting.rows[0]!.blocked;
          },
          { timeout: 5000 },
        )
        .toBe(true);
      if (lock === 'root') {
        // A reader waiting on root must already hold job: catch reverse lock order.
        await expect(
          connection.pool.query(
            'select job_id from job_snapshots where job_id = $1 for update nowait',
            [creation.jobId],
          ),
        ).rejects.toMatchObject({ code: '55P03' });
      }
      await change(tx);
      expectedEffects = await effects(tx);
    });
    const result = await reading!;
    expect(await effects(connection.db)).toEqual(expectedEffects);
    expect(model.generateStructured).toHaveBeenCalledTimes(calls);
    return result;
  } finally {
    if (reading) await Promise.allSettled([reading]);
  }
}

it('waits for the job lock and returns the post-wait status/revision instead of the queued acknowledgement', async () => {
  const creation = await native();
  const snapshot = await waitAndChange(creation, 'job', async (tx) => {
    await tx
      .update(jobSnapshots)
      .set({ status: 'running', revision: 2 })
      .where(eq(jobSnapshots.jobId, creation.jobId));
  });
  expect(snapshot).toMatchObject({
    status: 'running',
    revision: 2,
    result: null,
  });
}, 20000);

it.each(['job', 'root'] as const)(
  'rechecks operation association after waiting for the %s lock',
  async (lock) => {
    const creation = await native();
    const other = await native();
    expect(
      await waitAndChange(creation, lock, async (tx) => {
        await tx
          .update(demandOperations)
          .set({ demandId: other.jobId })
          .where(
            and(
              eq(demandOperations.accountId, creation.accountId),
              eq(demandOperations.operationId, creation.operationId),
            ),
          );
      }),
    ).toBeNull();
  },
  20000,
);

it.each(['binding', 'revocation', 'root-input'] as const)(
  'rechecks %s after waiting for the root lock',
  async (change) => {
    const creation = await native();
    const replacement = await actor();
    expect(
      await waitAndChange(creation, 'root', async (tx) => {
        if (change === 'binding')
          await tx
            .update(accountBindings)
            .set({ personId: replacement.personId })
            .where(eq(accountBindings.accountId, creation.accountId));
        else if (change === 'revocation')
          await tx
            .update(grants)
            .set({ revokedAt: '2026-11-01' })
            .where(eq(grants.accountId, creation.accountId));
        else
          await tx
            .update(demandRoots)
            .set({ inputText: '演示：等待期间变化' })
            .where(eq(demandRoots.id, creation.jobId));
      }),
    ).toBeNull();
  },
  20000,
);

it('refuses a caller transaction that is not Read Committed instead of serving a pre-wait snapshot', async () => {
  const creation = await native();
  for (const isolationLevel of ['repeatable read', 'serializable'] as const)
    await expect(
      connection.db.transaction((tx) => readUnchanged(tx, creation), {
        isolationLevel,
      }),
    ).rejects.toThrow('Read Committed');
  expect(await read(creation)).toMatchObject({
    jobId: creation.jobId,
    status: 'queued',
  });
});
