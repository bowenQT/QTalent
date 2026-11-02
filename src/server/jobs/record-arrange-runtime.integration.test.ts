import { randomUUID } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, afterAll, afterEach, expect, it, vi } from 'vitest';
import {
  nativeDatabase,
  seedNativeRules,
  seedNativeCase,
  syntheticBatchClient,
  businessAt,
  wallAt,
} from '../../../tests/fixtures/bow-845/native';
import { createRecordArrangeApplication } from '../usecases/record-arrange-application';
import { arrangeInputs } from '../modules/records/arrange/input-state/schema';
import { evaluationRelations } from '../modules/programs';
import { jobSnapshots } from './schema';
import { newJob } from './state';
import { grants } from '../modules/directory';
import { projects } from '../modules/staffing';
import {
  createStaffingDemandRuntime,
  staffingDemandQueue,
} from '../usecases/staffing-demand-runtime';
import { metadataFor, MODELINK_MODEL } from '../integrations/maas';
import { recordArrangeQueue } from './record-arrange';
import { parseBatchMetadata } from '../usecases/record-batch-arrange-state';
import type { JobCommand } from '../../contracts/jobs';

// Only external request identity and process dependencies are substituted.
// The public action/query, registry, policy, transaction and pg-boss are real.
const boundary = vi.hoisted(() => ({
  db: undefined as unknown,
  account: null as string | null,
  producer: vi.fn(),
}));
vi.mock('../db/client', async (original) => ({
  ...(await original<typeof import('../db/client')>()),
  getDatabase: () => boundary.db,
}));
vi.mock('../env', () => ({
  getEnv: () => ({ APP_ENV: 'test', ACCESS_ENFORCED: false }),
}));
vi.mock('../auth', () => ({
  getSession: async () =>
    boundary.account ? { user: { id: boundary.account } } : null,
}));
vi.mock('../access', () => ({ verifyAccessRequest: async () => undefined }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../platform/jobs/app-runtime', () => ({
  getAppJobProducer: boundary.producer,
}));
import { commandJobAction } from '../actions/jobs';
import { readJobForCurrentUser } from '../queries/jobs';
import { GET, POST } from '../../app/api/jobs/[jobId]/route';

let connection: Awaited<ReturnType<typeof nativeDatabase>>;
let boss: PgBoss;
beforeAll(async () => {
  connection = await nativeDatabase();
  boundary.db = connection.db;
  await seedNativeRules(connection.db);
  boss = new PgBoss({ connectionString: connection.testUrl });
  boss.on('error', () => undefined);
  await boss.start();
  await boss.createQueue(recordArrangeQueue, { retryLimit: 0 });
  boundary.producer.mockImplementation(async () => boss);
}, 30000);
afterEach(() => {
  boundary.account = null;
  boundary.producer.mockImplementation(async () => boss);
});
afterAll(async () => {
  await boss?.stop();
  await connection?.close();
});
async function setup(options: Parameters<typeof syntheticBatchClient>[0] = {}) {
  const facts = await seedNativeCase(connection.db);
  const model = syntheticBatchClient(options);
  const app = createRecordArrangeApplication({
    db: connection.db,
    boss,
    client: model.client,
    businessNow: () => businessAt,
    now: () => new Date(wallAt),
  });
  const created = await app.requests.create(facts.account, facts.input);
  if (created.status !== 'success') throw new Error('Synthetic intake failed');
  const [input] = await connection.db
    .select()
    .from(arrangeInputs)
    .where(eq(arrangeInputs.batchId, created.result.batchId));
  boundary.account = facts.account;
  return { ...facts, ...model, app, jobId: input!.jobId };
}
async function state(id: string) {
  const [row] = await connection.db
    .select()
    .from(jobSnapshots)
    .where(eq(jobSnapshots.jobId, id));
  return row!;
}
async function command(
  jobId: string,
  action: JobCommand['action'],
): Promise<JobCommand> {
  return {
    jobId,
    action,
    operationId: randomUUID(),
    expectedRevision: (await state(jobId)).revision,
  };
}
function context(jobId: string) {
  return { params: Promise.resolve({ jobId }) };
}
function post(body: JobCommand) {
  return POST(
    new Request('http://localhost/api/jobs/' + body.jobId, {
      method: 'POST',
      headers: {
        origin: 'http://localhost',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
    context(body.jobId),
  );
}
it('reads and cancels an authorized real arrangement through the public query and HTTP route', async () => {
  const h = await setup();
  expect(await readJobForCurrentUser(h.jobId)).toMatchObject({
    status: 'success',
    snapshot: { kind: 'record_organize', canCancel: true },
  });
  const response = await GET(
    new Request('http://localhost/api/jobs/' + h.jobId),
    context(h.jobId),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store, private');
  const cancelled = await post(await command(h.jobId, 'cancel'));
  expect(cancelled.status).toBe(200);
  expect(await h.app.runner.run(h.jobId, 1)).toBe('cancelled');
  expect(h.calls()).toBe(0);
});
it('retries a proven-not-sent failure through the public action with metadata and one transactional enqueue retained', async () => {
  const h = await setup({ noSendFailure: true });
  expect(await h.app.runner.run(h.jobId, 1)).toBe('failed');
  const retry = await command(h.jobId, 'retry');
  const before = parseBatchMetadata((await state(h.jobId)).result);
  expect(await commandJobAction(retry)).toMatchObject({
    status: 'success',
    snapshot: { attempt: 2, status: 'queued' },
  });
  expect(parseBatchMetadata((await state(h.jobId)).result)).toMatchObject({
    actorPersonId: h.evaluator,
    operationId: before!.operationId,
  });
  const queued = await connection.db.execute(
    sql`select count(*)::int as count from pgboss.job where name = ${recordArrangeQueue} and data->>'jobId' = ${h.jobId} and data->>'attempt' = '2'`,
  );
  expect(queued.rows[0]).toMatchObject({ count: 1 });
  expect(await h.app.runner.run(h.jobId, 2)).toBe('awaiting_manual');
  expect(h.calls()).toBe(2);
  expect(await commandJobAction(await command(h.jobId, 'retry'))).toEqual({
    status: 'forbidden',
  });
});
it('keeps current authorization at public boundaries and refuses both outsiders and revoked relationships', async () => {
  const h = await setup();
  const cancel = await command(h.jobId, 'cancel');
  boundary.account = null;
  expect(await commandJobAction(cancel)).toEqual({ status: 'unauthenticated' });
  boundary.account = h.outsiderAccount;
  expect(await readJobForCurrentUser(h.jobId)).toEqual({ status: 'forbidden' });
  expect((await post(cancel)).status).toBe(403);
  boundary.account = h.account;
  await connection.db
    .update(evaluationRelations)
    .set({ revokedAt: '2026-09-03T00:00:00Z' })
    .where(eq(evaluationRelations.id, h.relation));
  expect(await readJobForCurrentUser(h.jobId)).toEqual({ status: 'forbidden' });
  expect(await commandJobAction(cancel)).toEqual({ status: 'forbidden' });
  expect((await state(h.jobId)).cancelRequestedAt).toBeNull();
  expect(h.calls()).toBe(0);
});
it('rejects stale commands and unsupported controls without changing the real job', async () => {
  const h = await setup();
  const before = await state(h.jobId);
  const stale = {
    ...(await command(h.jobId, 'cancel')),
    expectedRevision: before.revision + 1,
  };
  expect(await commandJobAction(stale)).toEqual({ status: 'conflict' });
  expect(await commandJobAction(await command(h.jobId, 'resume'))).toEqual({
    status: 'forbidden',
  });
  expect(await state(h.jobId)).toEqual(before);
});
it('rolls back the public retry state and metadata if the external producer fails', async () => {
  const h = await setup({ noSendFailure: true });
  expect(await h.app.runner.run(h.jobId, 1)).toBe('failed');
  const before = await state(h.jobId);
  boundary.producer.mockRejectedValueOnce(
    new Error('Synthetic unavailable queue'),
  );
  expect((await post(await command(h.jobId, 'retry'))).status).toBe(503);
  expect(await state(h.jobId)).toEqual(before);
  expect(await commandJobAction(await command(h.jobId, 'retry'))).toMatchObject(
    { status: 'success', snapshot: { attempt: 2 } },
  );
});

it('preserves existing demand retries and read-only example projection in the shared registry', async () => {
  const h = await seedNativeCase(connection.db);
  boundary.account = h.account;
  await connection.db.insert(grants).values({
    id: h.prefix + '-manager',
    accountId: h.account,
    role: 'manager',
    scope: 'company',
    validFrom: '2026-01-01',
  });
  const projectId = h.prefix + '-project';
  await connection.db.insert(projects).values({
    id: projectId,
    name: '演示项目',
    type: '业务项目',
    status: '筹备中',
    goal: '演示回归',
    organizationId: h.prefix,
    cohortId: h.cohort,
    creatorId: h.evaluator,
    from: '2026-01-01',
    to: '2026-12-31',
  });
  await boss.createQueue(staffingDemandQueue);
  const demand = createStaffingDemandRuntime({
    db: connection.db,
    boss,
    now: () => businessAt,
    maas: {
      async generateStructured(input) {
        return {
          ok: false,
          kind: 'network',
          retryable: true,
          metadata: metadataFor(input, MODELINK_MODEL),
        };
      },
    },
  });
  const created = await demand.service.create(h.account, {
    operationId: randomUUID(),
    projectId,
    inputText: '演示：需要工程负责人',
  });
  const jobId = created.snapshot.jobId;
  await demand.run({ jobId, attempt: 1 });
  expect(await readJobForCurrentUser(jobId)).toMatchObject({
    status: 'success',
    snapshot: { kind: 'staffing_demand', status: 'failed', canRetry: true },
  });
  expect(await commandJobAction(await command(jobId, 'retry'))).toMatchObject({
    status: 'success',
    snapshot: { kind: 'staffing_demand', status: 'queued', attempt: 2 },
  });
  expect((await state(jobId)).result).toBeNull();
  expect(boundary.producer).toHaveBeenCalledWith(staffingDemandQueue);
  const exampleId = randomUUID();
  await connection.db.insert(jobSnapshots).values({
    ...newJob(
      {
        jobId: exampleId,
        kind: 'test-job',
        resourceId: projectId,
        inputVersion: 'demo-v1',
      },
      wallAt,
    ),
    result: { units: [{ id: 'demo-unit', label: '演示处理' }] },
  });
  expect(await readJobForCurrentUser(exampleId)).toMatchObject({
    status: 'success',
    snapshot: {
      kind: 'test-job',
      result: { units: [{ id: 'demo-unit', label: '演示处理' }] },
      canCancel: false,
      canRetry: false,
    },
  });
  expect(await commandJobAction(await command(exampleId, 'cancel'))).toEqual({
    status: 'forbidden',
  });
});
