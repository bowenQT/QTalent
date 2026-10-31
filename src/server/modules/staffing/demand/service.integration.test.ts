import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { PgBoss, fromDrizzle } from 'pg-boss';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, afterAll, afterEach, expect, it } from 'vitest';
import { createDatabase } from '../../../db/client';
import { projects } from '../schema';
import { createFakeMaas, metadataFor } from '../../../integrations/maas';
import { createJobService } from '../../../jobs/service';
import { createJobStore } from '../../../jobs/repository';
import {
  createDemandService,
  DemandAccessError,
  type DemandDependencies,
} from './service';
import { DemandConflictError } from './version';
import { demandJobPolicy, runDemandGeneration } from './job';
import { demandRoots, demandVersions } from './schema';
import { DEMAND_PROMPT_VERSION } from './prompt';

let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase>;
let boss: PgBoss;
let deps: DemandDependencies;
let allowed = true;
const database = `qtalent_demand_${randomUUID().replaceAll('-', '')}_test`;
const now = '2026-10-25T12:00:00.000Z';
const queue = 'staffing-demand-test';
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
  await boss.createQueue(queue);
  await connection.db.insert(projects).values({
    id: 'project',
    name: '演示项目',
    type: '业务项目',
    status: '筹备中',
    goal: '演示',
    organizationId: 'demo',
    cohortId: 'cohort',
    creatorId: 'actor',
    from: '2026-01-01',
    to: '2026-12-31',
  });
  deps = {
    db: connection.db,
    now: () => now,
    loadContext: async (_tx, accountId) => ({
      actorName: '演示管理者',
      context: {
        account: { id: accountId, personId: 'actor', isSystemAdmin: false },
        now,
        grants: allowed
          ? [
              {
                accountId,
                role: 'manager',
                scope: 'company',
                cohortId: null,
                validFrom: '2026-01-01',
                validTo: null,
                revokedAt: null,
              },
            ]
          : [],
        enrollments: [],
        assignments: [],
        people: [],
        members: [],
        projects: [
          {
            id: 'project',
            cohortId: 'cohort',
            isTopic: false,
            creatorId: 'actor',
            ownerId: null,
          },
        ],
      },
    }),
    enqueue: async (tx, job) => {
      await boss.send(
        queue,
        { jobId: job.jobId, attempt: job.attempt },
        { db: fromDrizzle(tx, sql) },
      );
    },
  };
}, 30000);
afterAll(async () => {
  if (boss) await boss.stop();
  if (connection) await connection.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    await admin.end();
  }
});
afterEach(() => {
  allowed = true;
});
const input = () => ({
  operationId: randomUUID(),
  projectId: 'project',
  inputText: '演示：需要工程负责人',
});
const fake = () =>
  createFakeMaas({
    requirements: [{ text: '工程交付', priority: 'required' }],
  });
it('creates one durable job, generates a draft then preserves edit/confirm revisions', async () => {
  const service = createDemandService(deps);
  const request = input();
  const responses = await Promise.all([
    service.create('account', request),
    service.create('account', request),
  ]);
  expect(responses.map((r) => r.snapshot.jobId)).toEqual([
    responses[0].snapshot.jobId,
    responses[0].snapshot.jobId,
  ]);
  expect(responses.map((r) => r.replayed).sort()).toEqual([false, true]);
  expect(responses[0].snapshot.result).toBeNull();
  const id = responses[0].snapshot.jobId;
  expect(
    (await boss.findJobs<{ jobId: string }>(queue)).filter(
      (j) => j.data.jobId === id,
    ),
  ).toHaveLength(1);
  await expect(
    service.create('account', { ...request, inputText: 'different' }),
  ).rejects.toThrow();
  await runDemandGeneration(deps, fake(), { jobId: id, attempt: 1 });
  const draft = await service.read('account', id);
  expect(draft).toMatchObject({ revision: 1, status: 'draft' });
  const confirmation = {
    operationId: randomUUID(),
    demandId: id,
    expectedRevision: 1,
  };
  const result = await service.change('account', confirmation, {
    action: 'confirm',
  });
  expect(result.demand).toMatchObject({
    revision: 2,
    status: 'confirmed',
    confirmedBy: { id: 'actor' },
  });
  expect(
    await service.change('account', confirmation, { action: 'confirm' }),
  ).toMatchObject({ replayed: true, demand: result.demand });
  await expect(
    service.change(
      'account',
      { ...confirmation, operationId: randomUUID() },
      { action: 'confirm' },
    ),
  ).rejects.toThrow();
  const edited = await service.change(
    'account',
    { ...confirmation, operationId: randomUUID(), expectedRevision: 2 },
    {
      action: 'edit',
      requirements: [{ id: 'new', text: '技术沟通', priority: 'bonus' }],
    },
  );
  expect(edited.demand).toMatchObject({ revision: 3, status: 'draft' });
  expect(await service.read('account', id, 2)).toEqual(result.demand);
  expect(
    await connection.db
      .select()
      .from(demandVersions)
      .where(eq(demandVersions.demandId, id)),
  ).toHaveLength(3);
  allowed = false;
  expect(await service.read('account', id)).toBeNull();
  await expect(
    service.change('account', confirmation, { action: 'confirm' }),
  ).rejects.toThrow();
  await expect(service.create('account', request)).rejects.toThrow();
  allowed = true;
});
it('failure is not a demand; an explicit retry uses the shared job service once', async () => {
  const service = createDemandService(deps);
  const created = await service.create('account', input());
  const jobId = created.snapshot.jobId;
  await runDemandGeneration(
    deps,
    {
      async generateStructured() {
        return {
          ok: false,
          kind: 'network',
          retryable: true,
          metadata: metadataFor({ promptVersion: DEMAND_PROMPT_VERSION }),
        };
      },
    },
    { jobId, attempt: 1 },
  );
  expect(await service.read('account', jobId)).toBeNull();
  const jobs = createJobService(
    createJobStore(connection.db),
    [demandJobPolicy(deps)],
    () => now,
  );
  const failed = await jobs.read('account', jobId);
  expect(failed).toMatchObject({
    snapshot: { status: 'failed', result: null, canRetry: true },
  });
  if (failed.status !== 'success') throw new Error('Expected failed snapshot');
  const command = {
    jobId,
    operationId: randomUUID(),
    expectedRevision: failed.snapshot.revision,
    action: 'retry' as const,
  };
  const retries = await Promise.all([
    jobs.command('account', command),
    jobs.command('account', command),
  ]);
  expect(retries[0]).toEqual(retries[1]);
  await runDemandGeneration(deps, fake(), { jobId, attempt: 1 });
  expect(await service.read('account', jobId)).toBeNull();
  await runDemandGeneration(deps, fake(), { jobId, attempt: 2 });
  expect(await service.read('account', jobId)).toMatchObject({
    status: 'draft',
    revision: 1,
  });
});
it('rolls back enqueue failure, and cancellation fences late model output', async () => {
  const before = await connection.db.select().from(demandRoots);
  await expect(
    createDemandService({
      ...deps,
      enqueue: async (tx, job) => {
        await deps.enqueue(tx, job);
        throw new Error('synthetic queue failure');
      },
    }).create('account', input()),
  ).rejects.toThrow('synthetic queue failure');
  expect(await connection.db.select().from(demandRoots)).toHaveLength(
    before.length,
  );
  const service = createDemandService(deps);
  const created = await service.create('account', input());
  const jobId = created.snapshot.jobId;
  const jobs = createJobService(
    createJobStore(connection.db),
    [demandJobPolicy(deps)],
    () => now,
  );
  await runDemandGeneration(
    deps,
    {
      async generateStructured(request) {
        const running = await jobs.read('account', jobId);
        if (running.status !== 'success')
          throw new Error('Expected running snapshot');
        await jobs.command('account', {
          jobId,
          action: 'cancel',
          operationId: randomUUID(),
          expectedRevision: running.snapshot.revision,
        });
        return fake().generateStructured(request);
      },
    },
    { jobId, attempt: 1 },
  );
  expect(await jobs.read('account', jobId)).toMatchObject({
    snapshot: { status: 'cancelled', result: null },
  });
  expect(await service.read('account', jobId)).toBeNull();
});

it('fences revocation during generation and unknown outcomes cannot be retried', async () => {
  const service = createDemandService(deps);
  const first = await service.create('account', input());
  await runDemandGeneration(
    deps,
    {
      async generateStructured(request) {
        allowed = false;
        return fake().generateStructured(request);
      },
    },
    { jobId: first.snapshot.jobId, attempt: 1 },
  );
  allowed = true;
  expect(await service.read('account', first.snapshot.jobId)).toBeNull();
  const jobs = createJobService(
    createJobStore(connection.db),
    [demandJobPolicy(deps)],
    () => now,
  );
  expect(await jobs.read('account', first.snapshot.jobId)).toMatchObject({
    snapshot: { status: 'failed', result: null },
  });
  const second = await service.create('account', input());
  await runDemandGeneration(
    deps,
    {
      async generateStructured() {
        throw new Error('synthetic response lost');
      },
    },
    { jobId: second.snapshot.jobId, attempt: 1 },
  );
  const unknown = await jobs.read('account', second.snapshot.jobId);
  expect(unknown).toMatchObject({
    snapshot: { status: 'failed', result: null, canRetry: false },
  });
  if (unknown.status !== 'success') throw new Error('Expected failed snapshot');
  expect(
    await jobs.command('account', {
      jobId: second.snapshot.jobId,
      action: 'retry',
      operationId: randomUUID(),
      expectedRevision: unknown.snapshot.revision,
    }),
  ).toEqual({ status: 'forbidden' });
});
it('ignores concurrent running redelivery without spoiling the original result', async () => {
  const service = createDemandService(deps);
  const created = await service.create('account', input());
  const jobId = created.snapshot.jobId;
  let calls = 0;
  await runDemandGeneration(
    deps,
    {
      async generateStructured(request) {
        calls++;
        await runDemandGeneration(
          deps,
          {
            async generateStructured() {
              throw new Error('redelivery must not reach provider');
            },
          },
          { jobId, attempt: 1 },
        );
        return fake().generateStructured(request);
      },
    },
    { jobId, attempt: 1 },
  );
  expect(calls).toBe(1);
  const jobs = createJobService(
    createJobStore(connection.db),
    [demandJobPolicy(deps)],
    () => now,
  );
  expect(await jobs.read('account', jobId)).toMatchObject({
    snapshot: { status: 'completed', canRetry: false },
  });
  expect(await service.read('account', jobId)).toMatchObject({
    status: 'draft',
    revision: 1,
  });
});

it('serializes distinct confirmation requests at the business revision boundary', async () => {
  const service = createDemandService(deps);
  const created = await service.create('account', input());
  const demandId = created.snapshot.jobId;
  await runDemandGeneration(deps, fake(), { jobId: demandId, attempt: 1 });
  const results = await Promise.allSettled([
    service.change(
      'account',
      { operationId: randomUUID(), demandId, expectedRevision: 1 },
      { action: 'confirm' },
    ),
    service.change(
      'account',
      { operationId: randomUUID(), demandId, expectedRevision: 1 },
      { action: 'confirm' },
    ),
  ]);
  expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((item) => item.status === 'rejected')).toHaveLength(1);
  expect(
    await connection.db
      .select()
      .from(demandVersions)
      .where(eq(demandVersions.demandId, demandId)),
  ).toHaveLength(2);
});

it('conflicts on reused request keys across payloads and actions without writing new versions', async () => {
  const service = createDemandService(deps);
  const request = input();
  const created = await service.create('account', request);
  const demandId = created.snapshot.jobId;
  await runDemandGeneration(deps, fake(), { jobId: demandId, attempt: 1 });
  const original = await service.read('account', demandId);
  await expect(
    service.create('account', { ...request, inputText: '演示：另一个需求' }),
  ).rejects.toBeInstanceOf(DemandConflictError);
  await expect(
    service.change(
      'account',
      { operationId: request.operationId, demandId, expectedRevision: 1 },
      { action: 'confirm' },
    ),
  ).rejects.toBeInstanceOf(DemandConflictError);
  const edit = { operationId: randomUUID(), demandId, expectedRevision: 1 };
  const change = {
    action: 'edit' as const,
    requirements: [
      { id: 'r', text: '演示：交付经验', priority: 'required' as const },
    ],
  };
  const edited = await service.change('account', edit, change);
  expect(await service.change('account', edit, change)).toEqual({
    ...edited,
    replayed: true,
  });
  await expect(
    service.change('account', edit, {
      ...change,
      requirements: [{ ...change.requirements[0], text: '演示：技术沟通' }],
    }),
  ).rejects.toBeInstanceOf(DemandConflictError);
  await expect(
    service.change('account', edit, { action: 'confirm' }),
  ).rejects.toBeInstanceOf(DemandConflictError);
  await expect(
    service.change('account', { ...edit, expectedRevision: 2 }, change),
  ).rejects.toBeInstanceOf(DemandConflictError);
  await expect(
    service.create('account', { ...request, operationId: edit.operationId }),
  ).rejects.toBeInstanceOf(DemandConflictError);
  expect(await service.create('account', request)).toEqual({
    ...created,
    replayed: true,
  });
  expect(await service.read('account', demandId, 1)).toEqual(original);
  expect(await service.read('account', demandId)).toEqual(edited.demand);
  expect(
    await connection.db
      .select()
      .from(demandVersions)
      .where(eq(demandVersions.demandId, demandId)),
  ).toHaveLength(2);
  expect(
    (await boss.findJobs<{ jobId: string }>(queue)).filter(
      (job) => job.data.jobId === demandId,
    ),
  ).toHaveLength(1);
  allowed = false;
  await expect(service.change('account', edit, change)).rejects.toBeInstanceOf(
    DemandAccessError,
  );
  await expect(service.create('account', request)).rejects.toBeInstanceOf(
    DemandAccessError,
  );
});

it('scopes request keys to the current account', async () => {
  const service = createDemandService(deps);
  const request = input();
  const [first, second] = await Promise.all([
    service.create('account', request),
    service.create('other-account', request),
  ]);
  expect(first.snapshot.jobId).not.toBe(second.snapshot.jobId);
  expect(first.replayed).toBe(false);
  expect(second.replayed).toBe(false);
  expect(await service.create('other-account', request)).toEqual({
    ...second,
    replayed: true,
  });
});

it.each(['completed', 'outcome_unknown'] as const)(
  'replays an accepted retry after %s without enqueue, and still rechecks current permissions',
  async (outcome) => {
    const service = createDemandService(deps);
    const created = await service.create('account', input());
    const jobId = created.snapshot.jobId;
    await runDemandGeneration(
      deps,
      {
        async generateStructured() {
          return {
            ok: false,
            kind: 'network',
            retryable: true,
            metadata: metadataFor({ promptVersion: DEMAND_PROMPT_VERSION }),
          };
        },
      },
      { jobId, attempt: 1 },
    );
    const jobs = createJobService(
      createJobStore(connection.db),
      [demandJobPolicy(deps)],
      () => now,
    );
    const failed = await jobs.read('account', jobId);
    if (failed.status !== 'success')
      throw new Error('Expected failed snapshot');
    const command = {
      jobId,
      operationId: randomUUID(),
      expectedRevision: failed.snapshot.revision,
      action: 'retry' as const,
    };
    const accepted = await jobs.command('account', command);
    expect(accepted).toMatchObject({
      status: 'success',
      snapshot: { status: 'queued', attempt: 2 },
    });
    await runDemandGeneration(
      deps,
      outcome === 'completed'
        ? fake()
        : {
            async generateStructured() {
              throw new Error('synthetic response lost after retry');
            },
          },
      { jobId, attempt: 2 },
    );
    const settled = await jobs.read('account', jobId);
    expect(settled).toMatchObject({
      status: 'success',
      snapshot: {
        status: outcome === 'completed' ? 'completed' : 'failed',
        attempt: 2,
        canRetry: false,
      },
    });
    expect(await jobs.command('account', command)).toEqual(accepted);
    expect(await jobs.read('account', jobId)).toEqual(settled);
    expect(
      await jobs.command('account', { ...command, action: 'cancel' }),
    ).toEqual({ status: 'conflict' });
    expect(
      await jobs.command('account', {
        ...command,
        expectedRevision: command.expectedRevision + 1,
      }),
    ).toEqual({ status: 'conflict' });
    if (settled.status !== 'success')
      throw new Error('Expected settled snapshot');
    expect(
      await jobs.command('account', {
        ...command,
        operationId: randomUUID(),
        expectedRevision: settled.snapshot.revision,
      }),
    ).toEqual({ status: 'forbidden' });
    allowed = false;
    expect(await jobs.command('account', command)).toEqual({
      status: 'forbidden',
    });
    allowed = true;
    expect(await jobs.command('account', command)).toEqual(accepted);
    expect(
      (await boss.findJobs<{ jobId: string }>(queue)).filter(
        (job) => job.data.jobId === jobId,
      ),
    ).toHaveLength(2);
    if (outcome === 'completed') {
      expect(await service.read('account', jobId)).toMatchObject({
        revision: 1,
        status: 'draft',
      });
    } else {
      expect(await service.read('account', jobId)).toBeNull();
    }
  },
);
