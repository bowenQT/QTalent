import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PgBoss, fromDrizzle } from 'pg-boss';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { createDatabase } from '../../../db/client';
import { organizations, people, accountBindings } from '../../directory';
import { projects } from '../schema';
import { demandRoots, demandVersions } from '../demand/schema';
import { metadataFor } from '../../../integrations/maas';
import { createStaffingMatchUsecase } from '../../../usecases/staffing-match';
import { matchingFixture } from '../../../../../tests/fixtures/staffing-matching';
import { jobSnapshots } from '../../../jobs/schema';
import {
  staffingMatchQueue,
  registerStaffingMatch,
} from '../../../jobs/staffing-match';
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
    migrationsFolder: 'src/server/db/migrations',
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
  const store = createPostgresMatchStore(connection!.db, async (tx, job) => {
    const id = await boss!.send(
      queueName,
      { jobId: job.jobId, attempt: job.attempt },
      { db: fromDrizzle(tx, sql) },
    );
    if (!id || failQueue) throw new Error('enqueue rolled back');
  });
  return {
    ...f,
    store,
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
  const f = fixture(false, staffingMatchQueue);
  await registerStaffingMatch(boss!, f.service.execute);
  const result = started.parse(await f.service.start('account-hr', f.input));
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
}, 20000);
