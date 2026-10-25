import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PgBoss, fromDrizzle } from 'pg-boss';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { createDatabase } from '../db/client';
import { importDemo } from '../db/import';
import { readPrototypeSeed, mapPrototypeSeed } from '../db/seed';
import { createRecordArrangeApplication } from './record-arrange-application';
import { createRecordArrangeRequests } from './record-arrange-requests';
import { createFakeMaas } from '../integrations/maas';
import { recordSelectionRequiredSchema } from '../../contracts/record';
import { canReadProject } from '../authz';
import {
  arrangeInputs,
  arrangeOperations,
} from '../modules/records/arrange/input-state/schema';
import { recordDrafts } from '../modules/records/save-state/schema';
import { jobSnapshots } from '../jobs/schema';
import { recordArrangeQueue } from '../jobs/record-arrange';
import { grants } from '../modules/directory';
import {
  events,
  originals,
  originalVersions,
  fragments,
} from '../modules/records';
import { loadArrangeActor, writableSubject } from './record-arrange-context';
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase>;
let boss: PgBoss;
const database = `qtalent_arrange_inputs_${randomUUID().replaceAll('-', '')}_test`;
const text = '今天补写了回滚步骤。';
const client = createFakeMaas({
  sbi: { title: '回滚步骤（演示）', situation: '', behavior: text, impact: '' },
  scores: [],
});
const now = () => new Date('2026-10-25T16:00:00Z');
const today = () => '2026-09-04';
let personId: string;
beforeAll(async () => {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw)
    throw new Error(
      'TEST_DATABASE_URL required for actual845 input/selection/writer transactions',
    );
  const url = new URL(raw);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Only isolated loopback _test databases allowed');
  admin = new Pool({ connectionString: raw, connectionTimeoutMillis: 3000 });
  await admin.query(`CREATE DATABASE "${database}"`);
  url.pathname = `/${database}`;
  connection = createDatabase(url.toString());
  await migrate(connection.db, {
    migrationsFolder: 'src/server/db/migrations',
  });
  // A missing serially generated migration is a hard failure, never a mock/skip.
  await connection.db.select().from(arrangeInputs).limit(1);
  await connection.db.select().from(recordDrafts).limit(1);
  await importDemo(
    connection.db,
    mapPrototypeSeed(readPrototypeSeed(process.cwd())),
    'isolated-arrange-test-only',
  );
  boss = new PgBoss({ connectionString: url.toString() });
  await boss.start();
  await boss.createQueue(recordArrangeQueue, { retryLimit: 0 });
  personId = await connection.db.transaction(async (tx) => {
    const actor = await loadArrangeActor(tx, 'demo-hrbp', today());
    const person = actor.directory.people.find((p) =>
      writableSubject(actor, p.id),
    );
    if (!person)
      throw new Error('synthetic current-cohort rater fixture missing');
    return person.id;
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
function application() {
  return createRecordArrangeApplication({
    db: connection.db,
    boss,
    client,
    environment: 'test',
    businessDate: today,
    now,
  });
}
function input(selected: string | null = personId) {
  return {
    operation_id: randomUUID(),
    text,
    attachmentIds: [],
    personId: selected,
    projectId: null,
  };
}
it('initial page context lists only current writable targets and rechecks requested context', async () => {
  const app = application();
  const page = await app.requests.page('demo-hrbp', {
    personId,
    projectId: null,
  });
  expect(page).toMatchObject({
    status: 'success',
    context: { accountId: 'demo-hrbp', selectedPersonId: personId },
  });
  if (page.status !== 'success')
    throw new Error('expected current page context');
  expect(page.context.people).toContainEqual(
    expect.objectContaining({ id: personId }),
  );
  expect(page.context).not.toHaveProperty('grants');
  expect(
    await app.requests.page('demo-hrbp', {
      personId: 'missing',
      projectId: null,
    }),
  ).toEqual({ status: 'not_found' });
});
it('first submission is persisted and enqueued once; same operation replay remains authorized', async () => {
  const app = application(),
    raw = input();
  const results = await Promise.all([
    app.requests.create('demo-hrbp', raw),
    app.requests.create('demo-hrbp', raw),
  ]);
  expect(results.map((r) => r.status)).toEqual(['success', 'success']);
  const [a, b] = results;
  if (a!.status !== 'success' || b!.status !== 'success')
    throw new Error('expected jobs');
  expect(a!.result.jobId).toBe(b!.result.jobId);
  expect(
    results.filter((r) => r.status === 'success' && r.replayed),
  ).toHaveLength(1);
  expect(
    (await boss.findJobs<{ jobId: string }>(recordArrangeQueue)).filter(
      (j) => j.data.jobId === a!.result.jobId,
    ),
  ).toHaveLength(1);
  expect(
    await app.requests.create('demo-hrbp', { ...raw, text: text + '改写' }),
  ).toMatchObject({ status: 'conflict' });
});
it('unbound input exposes candidates, selection creates one new job/draft, actual846 stores only the draft', async () => {
  const app = application();
  const originalInput = input(null);
  const created = await app.requests.create('demo-hrbp', originalInput);
  if (created.status !== 'success') throw new Error('expected queued input');
  const originalEvents = await connection.db.select().from(events);
  expect(await app.runner.run(created.result.jobId, 1)).toBe('awaiting_manual');
  const pending = await app.requests.read('demo-hrbp', created.result.jobId);
  if (
    pending.status !== 'success' ||
    !pending.snapshot.result ||
    typeof pending.snapshot.result !== 'object' ||
    !('state' in pending.snapshot.result) ||
    pending.snapshot.result.state !== 'selection_required'
  )
    throw new Error('expected public selection');
  const data = recordSelectionRequiredSchema.parse(pending.snapshot.result);
  expect(data.people.length).toBeGreaterThan(0);
  expect(data).not.toHaveProperty('sbi');
  const choice = {
    operation_id: randomUUID(),
    draftId: data.draftId,
    expected_input_version: data.inputVersion,
    personIds: [personId],
    projectId: null,
  };
  const selected = await app.requests.select('demo-hrbp', choice);
  if (selected.status !== 'success') throw new Error('expected selected job');
  expect(selected.result.jobId).not.toBe(created.result.jobId);
  expect(await app.requests.create('demo-hrbp', originalInput)).toMatchObject({
    status: 'success',
    replayed: true,
    result: { jobId: created.result.jobId, status: 'cancelled', result: null },
  });
  expect(await app.runner.run(created.result.jobId, 1)).toBe('ignored');
  expect(await app.requests.select('demo-hrbp', choice)).toMatchObject({
    status: 'success',
    replayed: true,
    result: { jobId: selected.result.jobId },
  });
  expect(
    await app.requests.select('demo-hrbp', {
      ...choice,
      operation_id: randomUUID(),
    }),
  ).toMatchObject({ status: 'conflict' });
  expect(await app.runner.run(selected.result.jobId, 1)).toBe(
    'awaiting_manual',
  );
  const [job] = await connection.db
    .select()
    .from(jobSnapshots)
    .where(eq(jobSnapshots.jobId, selected.result.jobId));
  expect(job).toMatchObject({
    result: { state: 'draft', promptVersion: 'record-arrange.v1' },
  });
  const [draft] = await connection.db
    .select()
    .from(recordDrafts)
    .where(eq(recordDrafts.id, job!.resourceId));
  expect(draft).toMatchObject({ revision: 1, creatorAccountId: 'demo-hrbp' });
  expect(await connection.db.select().from(events)).toHaveLength(
    originalEvents.length,
  );
});
it('explicit person selection can also resolve a mentioned project without inventing SBI', async () => {
  const app = application();
  const actor = await connection.db.transaction((tx) =>
    loadArrangeActor(tx, 'demo-hrbp', today()),
  );
  const project = actor.staffing.projects.find(
    (p) => p.name.trim() && canReadProject(actor.context, p),
  );
  if (!project) throw new Error('synthetic project fixture missing');
  const created = await app.requests.create('demo-hrbp', {
    ...input(null),
    text: `${project.name}：${text}`,
  });
  if (created.status !== 'success') throw new Error('expected queued input');
  await app.runner.run(created.result.jobId, 1);
  const pending = await app.requests.read('demo-hrbp', created.result.jobId);
  if (pending.status !== 'success')
    throw new Error('expected project selection');
  const data = recordSelectionRequiredSchema.parse(pending.snapshot.result);
  expect(data.project.state).toBe('needs_selection');
  const selected = await app.requests.select('demo-hrbp', {
    operation_id: randomUUID(),
    draftId: data.draftId,
    expected_input_version: data.inputVersion,
    personIds: [personId],
    projectId: project.id,
  });
  expect(selected).toMatchObject({ status: 'success' });
});
it('concurrent different selection operations consume a pending version only once', async () => {
  const app = application();
  const created = await app.requests.create('demo-hrbp', input(null));
  if (created.status !== 'success') throw new Error('expected input');
  await app.runner.run(created.result.jobId, 1);
  const [row] = await connection.db
    .select()
    .from(arrangeInputs)
    .where(eq(arrangeInputs.jobId, created.result.jobId));
  const body = {
    draftId: row!.id,
    expected_input_version: row!.inputVersion,
    personIds: [personId],
    projectId: null,
  };
  const results = await Promise.all([
    app.requests.select('demo-hrbp', { ...body, operation_id: randomUUID() }),
    app.requests.select('demo-hrbp', { ...body, operation_id: randomUUID() }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual(['conflict', 'success']);
});
it('enqueue failure rolls back input, original text, operation, job and actual pg-boss insertion', async () => {
  const counts = async () =>
    Promise.all([
      connection.db.select().from(arrangeInputs),
      connection.db.select().from(arrangeOperations),
      connection.db.select().from(originals),
      connection.db.select().from(jobSnapshots),
      boss.findJobs(recordArrangeQueue),
    ]).then((rows) => rows.map((r) => r.length));
  const before = await counts();
  const service = createRecordArrangeRequests({
    db: connection.db,
    environment: 'test',
    businessDate: today,
    now,
    enqueue: async (tx, job) => {
      await boss.send(
        recordArrangeQueue,
        { jobId: job.jobId, attempt: job.attempt },
        { db: fromDrizzle(tx, sql), retryLimit: 0 },
      );
      throw new Error('synthetic enqueue rollback');
    },
  });
  await expect(service.create('demo-hrbp', input())).rejects.toThrow(
    'synthetic enqueue rollback',
  );
  expect(await counts()).toEqual(before);
});
it('recording selection does not rewrite verified fragment attribution', async () => {
  const app = application();
  const fragmentId = randomUUID(),
    originalId = randomUUID(),
    originalVersionId = randomUUID();
  await connection.db.transaction(async (tx) => {
    await tx.insert(originals).values({ id: originalId, title: '合成录音' });
    await tx.insert(originalVersions).values({
      id: originalVersionId,
      originalId,
      version: 1,
      contentDigest: 'synthetic-recording',
    });
    await tx.insert(fragments).values({
      id: fragmentId,
      originalVersionId,
      excerpt: text,
      location: { kind: 'recording', startMs: 100, endMs: 200 },
    });
  });
  const actor = await connection.db.transaction((tx) =>
    loadArrangeActor(tx, 'demo-hrbp', today()),
  );
  const subject = writableSubject(actor, personId)!;
  const created = await app.requests.createFromSources('demo-hrbp', {
    origin: 'recording',
    originalInput: input(null),
    sources: [
      {
        fragmentId,
        originalVersionId,
        subjects: [subject],
        attributedPersonIds: [],
        kind: 'evaluation',
        requiredKinds: [],
      },
    ],
  });
  if (created.status !== 'success') throw new Error('expected source input');
  await app.runner.run(created.result.jobId, 1);
  const [old] = await connection.db
    .select()
    .from(arrangeInputs)
    .where(eq(arrangeInputs.jobId, created.result.jobId));
  const selected = await app.requests.select('demo-hrbp', {
    operation_id: randomUUID(),
    draftId: old!.id,
    expected_input_version: old!.inputVersion,
    personIds: [personId],
    projectId: null,
  });
  if (selected.status !== 'success') throw new Error('expected choice');
  const [next] = await connection.db
    .select()
    .from(arrangeInputs)
    .where(eq(arrangeInputs.jobId, selected.result.jobId));
  expect(next!.sourceContexts[0]!.attributedPersonIds).toEqual([]);
});
it('revocation prevents replay of an existing input operation', async () => {
  const app = application(),
    raw = input();
  expect(await app.requests.create('demo-hrbp', raw)).toMatchObject({
    status: 'success',
  });
  const old = await connection.db
    .select()
    .from(grants)
    .where(eq(grants.accountId, 'demo-hrbp'));
  try {
    await connection.db
      .update(grants)
      .set({ revokedAt: today() })
      .where(eq(grants.accountId, 'demo-hrbp'));
    expect(await app.requests.create('demo-hrbp', raw)).toMatchObject({
      status: 'forbidden',
    });
  } finally {
    for (const grant of old)
      await connection.db
        .update(grants)
        .set({ revokedAt: grant.revokedAt })
        .where(eq(grants.id, grant.id));
  }
});
