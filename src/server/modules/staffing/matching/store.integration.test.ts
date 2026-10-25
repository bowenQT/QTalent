import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PgBoss, fromDrizzle } from 'pg-boss';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { createDatabase } from '../../../db/client';
import { organizations, people, accountBindings } from '../../directory';
import { projects } from '../schema';
import { demandRoots, demandVersions } from '../demand/schema';
import { metadataFor } from '../../../integrations/maas';
import {
  createStaffingMatchUsecase,
  createStaffingMatchEvidenceLoader,
  createStaffingMatchRuntime,
} from '../../../usecases/staffing-match';
import { matchingFixture } from '../../../../../tests/fixtures/staffing-matching';
import { jobSnapshots } from '../../../jobs/schema';
import { createJobService } from '../../../jobs/service';
import { createJobStore } from '../../../jobs/repository';
import { JevError } from '../../../integrations/jev';
import { staffingMatchJobPolicy } from '../../../jobs/staffing-match';
import { createPostgresMatchStore, loadMatchRun } from './store';
import { matchRuns, matchOperations } from './schema';

const database = `qtalent_matching_${randomUUID().replaceAll('-', '')}_test`;
const queue = 'staffing-match-transaction-test';
let admin: Pool | undefined,
  connection: ReturnType<typeof createDatabase> | undefined,
  boss: PgBoss | undefined;
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source)
    throw new Error(
      'TEST_DATABASE_URL required; real matching migrations/PG cannot be replaced by fake or skip',
    );
  const url = new URL(source);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Only isolated loopback test databases are allowed');
  admin = new Pool({ connectionString: source, connectionTimeoutMillis: 3000 });
  await admin.query(`CREATE DATABASE "${database}"`);
  url.pathname = '/' + database;
  connection = createDatabase(url.toString());
  await migrate(connection.db, {
    // A private native-generated dependency composition is allowed locally;
    // the default and CI still require the published serial migrations.
    migrationsFolder:
      process.env.BOW854_TEST_MIGRATIONS ?? 'src/server/db/migrations',
  });
  boss = new PgBoss({ connectionString: url.toString() });
  await boss.start();
  await boss.createQueue(queue);
  const db = connection.db,
    f = matchingFixture();
  await db
    .insert(organizations)
    .values({ id: 'matching-demo', name: '演示组织', shortName: '演示' });
  await db
    .insert(people)
    .values({ id: 'hr', name: '演示·HR', organizationId: 'matching-demo' });
  await db
    .insert(accountBindings)
    .values({ accountId: 'account-hr', personId: 'hr' });
  await db.insert(projects).values({
    id: 'project-a',
    name: '演示项目',
    type: '业务项目',
    status: '筹备中',
    goal: '演示',
    organizationId: 'matching-demo',
    cohortId: 'cohort-a',
    creatorId: 'hr',
    from: '2026-01-01',
    to: '2026-12-31',
  });
  // These rows are genuine persistent dependency data. Evidence/model ports
  // remain synthetic; this suite verifies storage and queue atomicity only.
  await db.insert(demandRoots).values({
    id: f.demand.id,
    projectId: f.demand.projectId,
    initiatorAccountId: 'account-hr',
    initiatorPersonId: 'hr',
    inputText: f.demand.inputText,
    currentRevision: 2,
    createdAt: '2026-09-01T10:00:00.000Z',
    promptVersion: 'staffing-demand-v1',
  });
  await db.insert(demandVersions).values({
    demandId: f.demand.id,
    revision: 2,
    demand: f.demand,
    promptVersion: 'staffing-demand-v1',
    modelMetadata: metadataFor({ promptVersion: 'staffing-demand-v1' }),
    actorAccountId: 'account-hr',
    createdAt: '2026-09-01T10:00:00.000Z',
  });
}, 30000);
afterAll(async () => {
  await boss?.stop();
  await connection?.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    await admin.end();
  }
});
const started = z.object({
  status: z.literal('success'),
  runId: z.string(),
  replayed: z.boolean(),
});
function fixture(failQueue = false, queueName = queue) {
  const f = matchingFixture();
  const enqueue: Parameters<typeof createPostgresMatchStore>[1] = async (
    tx,
    job,
  ) => {
    const id = await boss!.send(
      queueName,
      { jobId: job.jobId, attempt: job.attempt },
      { db: fromDrizzle(tx, sql) },
    );
    if (!id || failQueue) throw new Error('enqueue rolled back');
  };
  const store = createPostgresMatchStore(connection!.db, enqueue);
  return {
    ...f,
    store,
    enqueue,
    service: createStaffingMatchUsecase({
      ...f.dependencies,
      store,
      id: randomUUID,
    }),
    input: {
      operationId: randomUUID(),
      demandId: 'demand-a',
      expectedRevision: 2,
    },
  };
}
it('atomically persists one run, job, operation and queue record for concurrent duplicate starts', async () => {
  const f = fixture(),
    results = await Promise.all([
      f.service.start('account-hr', f.input),
      f.service.start('account-hr', f.input),
    ]);
  const first = started.parse(results[0]),
    second = started.parse(results[1]);
  expect(first.runId).toBe(second.runId);
  expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
  expect(
    (await boss!.findJobs<{ jobId: string }>(queue)).filter(
      (job) => job.data.jobId === first.runId,
    ),
  ).toHaveLength(1);
  const loaded = await connection!.db.transaction((tx) =>
    loadMatchRun(tx, first.runId),
  );
  expect(loaded?.candidates).toHaveLength(4);
  expect(
    await connection!.db.transaction((tx) => loadMatchRun(tx, 'absent')),
  ).toBeNull();
});
it('rolls back all matching/job/operation and actual pg-boss queue writes after enqueue failure', async () => {
  const f = fixture(true);
  const before = await boss!.findJobs(queue);
  const runsBefore = await connection!.db
    .select({ count: sql<number>`count(*)::int` })
    .from(matchRuns);
  const jobsBefore = await connection!.db
    .select({ count: sql<number>`count(*)::int` })
    .from(jobSnapshots);
  await expect(f.service.start('account-hr', f.input)).rejects.toThrow(
    'enqueue rolled back',
  );
  expect(
    await connection!.db
      .select()
      .from(matchOperations)
      .where(eq(matchOperations.operationId, f.input.operationId)),
  ).toHaveLength(0);
  expect(await boss!.findJobs(queue)).toHaveLength(before.length);
  expect(
    await connection!.db
      .select({ count: sql<number>`count(*)::int` })
      .from(matchRuns),
  ).toEqual(runsBefore);
  expect(
    await connection!.db
      .select({ count: sql<number>`count(*)::int` })
      .from(jobSnapshots),
  ).toEqual(jobsBefore);
});
it('reauthorizes persistent cancellation replay and never enqueues retry/resume model work', async () => {
  const f = fixture(),
    result = started.parse(await f.service.start('account-hr', f.input));
  const shared = createJobService(
    createJobStore(connection!.db),
    [
      staffingMatchJobPolicy({
        loadRun: loadMatchRun,
        project: f.service.project,
        enqueue: f.enqueue,
      }),
    ],
    () => '2031-04-05T06:08:00.000Z',
  );
  const [job] = await connection!.db
    .select()
    .from(jobSnapshots)
    .where(eq(jobSnapshots.jobId, result.runId));
  const command = {
    jobId: result.runId,
    operationId: randomUUID(),
    expectedRevision: job!.revision,
  };
  expect(
    await shared.command('account-hr', { ...command, action: 'retry' }),
  ).toEqual({ status: 'forbidden' });
  expect(
    await shared.command('account-hr', { ...command, action: 'resume' }),
  ).toEqual({ status: 'forbidden' });
  expect(
    await shared.command('account-hr', { ...command, action: 'cancel' }),
  ).toMatchObject({
    status: 'success',
    snapshot: { cancelRequestedAt: '2031-04-05T06:08:00.000Z' },
  });
  await f.service.execute(result.runId, 2);
  expect(f.decide).not.toHaveBeenCalled();
  await f.service.execute(result.runId, 1);
  expect(await shared.read('account-hr', result.runId)).toMatchObject({
    status: 'success',
    snapshot: { status: 'cancelled' },
  });
  expect(
    (await boss!.findJobs<{ jobId: string }>(queue)).filter(
      (value) => value.data.jobId === result.runId,
    ),
  ).toHaveLength(2);
  f.context.grants[0]!.revokedAt = '2026-09-03';
  expect(
    await shared.command('account-hr', { ...command, action: 'cancel' }),
  ).toEqual({ status: 'forbidden' });
  expect(await shared.read('account-hr', result.runId)).toEqual({
    status: 'forbidden',
  });
});
it('finishes manual work through persisted resume without allowing public resume to resend Jev', async () => {
  const f = fixture();
  f.records.splice(
    0,
    f.records.length,
    ...f.records.filter((record) => record.subject.personId === 'demo-a'),
  );
  f.decide.mockRejectedValue(new JevError('timeout'));
  const result = started.parse(await f.service.start('account-hr', f.input));
  await f.service.execute(result.runId, 1);
  const shared = createJobService(
    createJobStore(connection!.db),
    [
      staffingMatchJobPolicy({
        loadRun: loadMatchRun,
        project: f.service.project,
        enqueue: f.enqueue,
      }),
    ],
    () => '2031-04-05T06:08:00.000Z',
  );
  const [job] = await connection!.db
    .select()
    .from(jobSnapshots)
    .where(eq(jobSnapshots.jobId, result.runId));
  expect(job!.status).toBe('awaiting_manual');
  expect(
    await shared.command('account-hr', {
      jobId: result.runId,
      action: 'resume',
      operationId: randomUUID(),
      expectedRevision: job!.revision,
    }),
  ).toEqual({ status: 'forbidden' });
  expect(
    await f.service.judge('account-hr', result.runId, {
      operationId: randomUUID(),
      demandId: 'demand-a',
      expectedRevision: 2,
      personId: 'demo-a',
      requirementId: 'required-a',
      conclusion: 'insufficient',
      rationale: '演示：核对后仍缺个人行为证据',
      sources: [],
    }),
  ).toMatchObject({
    status: 'success',
    match: { humanJudgment: { judgedBy: { id: 'hr' } } },
  });
  expect(await shared.read('account-hr', result.runId)).toMatchObject({
    status: 'success',
    snapshot: { status: 'completed' },
  });
  expect(f.decide).toHaveBeenCalledTimes(1);
  expect(
    (await boss!.findJobs<{ jobId: string }>(queue)).filter(
      (value) => value.data.jobId === result.runId,
    ),
  ).toHaveLength(1);
});
it('locks canonical cells so two different human operations cannot overwrite one another', async () => {
  const f = fixture(),
    result = started.parse(await f.service.start('account-hr', f.input));
  await f.service.execute(result.runId, 1);
  const input = {
    operationId: randomUUID(),
    demandId: 'demand-a',
    expectedRevision: 2,
    personId: 'demo-a',
    requirementId: 'required-a',
    conclusion: 'insufficient',
    rationale: '演示：人工核查后资料不足',
    sources: [],
  };
  const inputs = [input, { ...input, operationId: randomUUID() }];
  const outcomes = await Promise.all(
    inputs.map((value) => f.service.judge('account-hr', result.runId, value)),
  );
  expect(outcomes.map((value) => value.status).sort()).toEqual([
    'conflict',
    'success',
  ]);
  const winner =
    inputs[outcomes.findIndex((value) => value.status === 'success')];
  expect(
    await f.service.judge('account-hr', result.runId, winner),
  ).toMatchObject({ status: 'success', replayed: true });
});
it('uses foreign keys and payload identity checks rather than accepting mismatched persistent resources', async () => {
  const f = fixture(),
    result = started.parse(await f.service.start('account-hr', f.input));
  const [row] = await connection!.db
    .select()
    .from(matchRuns)
    .where(eq(matchRuns.id, result.runId));
  await expect(
    connection!.db
      .update(matchRuns)
      .set({ demandId: 'missing' })
      .where(eq(matchRuns.id, result.runId)),
  ).rejects.toThrow();
  await expect(
    connection!.db
      .update(matchRuns)
      .set({ payload: { ...row!.payload, id: 'other-run' } })
      .where(eq(matchRuns.id, result.runId)),
  ).rejects.toThrow();
  expect(await f.service.read('account-hr', result.runId)).toMatchObject({
    status: 'success',
  });
});
it('registers and executes the actual pg-boss consumer with only synthetic Jev work', async () => {
  const f = matchingFixture();
  let getterCalls = 0;
  const runtime = createStaffingMatchRuntime({
    ...f.dependencies,
    db: connection!.db,
    id: randomUUID,
    boss: async (queueName) => {
      getterCalls++;
      await boss!.createQueue(queueName);
      return boss!;
    },
  });
  expect(getterCalls).toBe(0);
  expect(f.decide).not.toHaveBeenCalled();
  await runtime.registerWorker(boss!);
  const result = started.parse(
    await runtime.service.start('account-hr', {
      operationId: randomUUID(),
      demandId: 'demand-a',
      expectedRevision: 2,
    }),
  );
  await expect
    .poll(
      async () =>
        (
          await connection!.db
            .select()
            .from(jobSnapshots)
            .where(eq(jobSnapshots.jobId, result.runId))
        )[0]?.status,
      { timeout: 15000, interval: 200 },
    )
    .toBe('completed');
  expect(f.decide).toHaveBeenCalledTimes(4);
  expect(getterCalls).toBe(1);
  const shared = createJobService(
    createJobStore(connection!.db),
    [runtime.policy],
    () => '2031-04-05T06:08:00.000Z',
  );
  expect(await shared.read('account-hr', result.runId)).toMatchObject({
    status: 'success',
    snapshot: { result: { candidates: expect.any(Array) } },
  });
}, 20000);
it('reads matching material in an actual repeatable-read, read-only snapshot using existing domain readers', async () => {
  const seen: string[] = [];
  const load = createStaffingMatchEvidenceLoader({
    db: connection!.db,
    readConfirmations: async (tx, data) => {
      expect(data.context.account.id).toBe('account-hr');
      expect(
        data.directory.people.find((person) => person.id === 'hr')?.name,
      ).toBe('演示·HR');
      const result = await tx.execute(
        sql`select current_setting('transaction_isolation') as isolation, current_setting('transaction_read_only') as readonly`,
      );
      seen.push(
        String(result.rows[0]!.isolation),
        String(result.rows[0]!.readonly),
      );
      return [];
    },
    projectSources: async (data) => {
      expect(data.fragments).toHaveLength(0);
      return { sources: [], details: [] };
    },
  });
  const value = await load('account-hr', '2026-09-04');
  expect(value.actor).toEqual({ id: 'hr', name: '演示·HR' });
  expect(value.snapshot.context.now).toBe('2026-09-04');
  expect(seen).toEqual(['repeatable read', 'on']);
});
it('prevents the confirmation adapter from writing through the read-only evidence transaction', async () => {
  const load = createStaffingMatchEvidenceLoader({
    db: connection!.db,
    readConfirmations: async (tx) => {
      await tx.insert(organizations).values({
        id: 'readonly-probe',
        name: '演示禁止写入',
        shortName: '演示',
      });
      return [];
    },
    projectSources: async () => ({ sources: [], details: [] }),
  });
  await expect(load('account-hr', '2026-09-04')).rejects.toMatchObject({
    cause: { code: '25006' },
  });
  expect(
    await connection!.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, 'readonly-probe')),
  ).toHaveLength(0);
});
it('rolls back a runtime start when pg-boss declines the enqueue instead of returning a job identity', async () => {
  const f = matchingFixture(),
    operationId = randomUUID();
  const runtime = createStaffingMatchRuntime({
    ...f.dependencies,
    db: connection!.db,
    id: randomUUID,
    boss: async (queueName) => {
      await boss!.createQueue(queueName);
      return boss!;
    },
  });
  const before = await connection!.db
    .select({ count: sql<number>`count(*)::int` })
    .from(matchRuns);
  const send = vi.spyOn(boss!, 'send').mockResolvedValueOnce(null);
  try {
    await expect(
      runtime.service.start('account-hr', {
        operationId,
        demandId: 'demand-a',
        expectedRevision: 2,
      }),
    ).rejects.toThrow('Matching enqueue rejected');
  } finally {
    send.mockRestore();
  }
  expect(
    await connection!.db
      .select({ count: sql<number>`count(*)::int` })
      .from(matchRuns),
  ).toEqual(before);
  expect(
    await connection!.db
      .select()
      .from(matchOperations)
      .where(eq(matchOperations.operationId, operationId)),
  ).toHaveLength(0);
  expect(f.decide).not.toHaveBeenCalled();
});
