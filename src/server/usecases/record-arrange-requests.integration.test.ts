import { randomUUID } from 'node:crypto';
import { PgBoss, fromDrizzle } from 'pg-boss';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import {
  nativeDatabase,
  seedNativeRules,
  seedNativeCase,
  syntheticBatchClient,
  businessAt,
  wallAt,
} from '../../../tests/fixtures/bow-845/native';
import { createRecordArrangeApplication } from './record-arrange-application';
import { createRecordArrangeRequests } from './record-arrange-requests';
import {
  arrangeInputs,
  arrangeOperations,
} from '../modules/records/arrange/input-state/schema';
import {
  recordDraftBatches,
  recordDrafts,
  storeTrustedRecordDraftBatch,
  events,
  eventSources,
  fragments,
  originals,
  originalVersions,
} from '../modules/records';
import { evaluationRelations } from '../modules/programs';
import { accountBindings, grants, people } from '../modules/directory';
import { projects } from '../modules/staffing';
import {
  anchors,
  ruleVersionApplicability,
} from '../modules/evaluation-system';
import { jobSnapshots } from '../jobs/schema';
import { recordArrangeQueue } from '../jobs/record-arrange';
import { MODELINK_MODEL, validModelinkInput } from '../integrations/maas';
import {
  createRecordArrangeModelClient,
  createRecordArrangeWorker,
} from './record-arrange-worker';
import {
  modelBatchSchema,
  batchMessages,
  BATCH_PROMPT_VERSION,
} from '../modules/records/arrange/batch-prompt';
import { materialBatchReceiptSchema } from '../../contracts/materials';
import { recordBatchDraftSetSchema } from '../../contracts/record';
import { loadRecordBatchSnapshot } from './record-arrange-context';
import { parseBatchMetadata } from './record-batch-arrange-state';
import { prepareBatch } from '../modules/records/arrange/batch';
import { readBatchArrangeRules } from '../modules/records/arrange/batch-rules';

let connection: Awaited<ReturnType<typeof nativeDatabase>>;
let boss: PgBoss;
beforeAll(async () => {
  connection = await nativeDatabase();
  // Hard failure when the actual X1/846/845 migrations are not supplied.
  await connection.db.select().from(arrangeInputs).limit(1);
  await connection.db.select().from(recordDraftBatches).limit(1);
  await seedNativeRules(connection.db);
  boss = new PgBoss({ connectionString: connection.testUrl });
  boss.on('error', () => undefined);
  await boss.start();
  await boss.createQueue(recordArrangeQueue, { retryLimit: 0 });
}, 30000);
afterAll(async () => {
  await boss?.stop();
  await connection?.close();
});
async function setup(
  options: Parameters<typeof syntheticBatchClient>[0] = {},
  id?: () => string,
) {
  const facts = await seedNativeCase(connection.db);
  const model = syntheticBatchClient(options);
  let business = businessAt;
  const app = createRecordArrangeApplication({
    db: connection.db,
    boss,
    client: model.client,
    businessNow: () => business,
    now: () => new Date(wallAt),
    ...(id ? { newId: id } : {}),
  });
  return {
    ...facts,
    ...model,
    app,
    advanceBusiness: (value: string) => {
      business = value;
    },
  };
}
async function submitted(h: Awaited<ReturnType<typeof setup>>) {
  const result = await h.app.requests.create(h.account, h.input);
  expect(result.status).toBe('success');
  if (result.status !== 'success')
    throw new Error('synthetic intake did not succeed');
  materialBatchReceiptSchema.parse(result.result);
  const [input] = await connection.db
    .select()
    .from(arrangeInputs)
    .where(eq(arrangeInputs.batchId, result.result.batchId));
  return { receipt: result.result, input: input!, jobId: input!.jobId };
}
async function state(jobId: string) {
  const [job] = await connection.db
    .select()
    .from(jobSnapshots)
    .where(eq(jobSnapshots.jobId, jobId));
  return job!;
}
it('initial page lists actual writable nodes and rejects an unauthorized target/project', async () => {
  const h = await setup();
  const page = await h.app.requests.page(h.account, {
    personId: h.target,
    projectId: null,
  });
  expect(page.status).toBe('success');
  if (page.status !== 'success') throw new Error('fixture');
  expect(page.context.evaluationNodes.map((node) => node.id)).toContain(h.node);
  expect(page.context.evaluationNodes.map((node) => node.id)).not.toContain(
    h.otherNode,
  );
  expect(
    await h.app.requests.page(h.account, {
      personId: h.other,
      projectId: null,
    }),
  ).toEqual({ status: 'not_found' });
  expect(
    await h.app.requests.page(h.account, {
      personId: h.target,
      projectId: 'missing',
    }),
  ).toEqual({ status: 'not_found' });
});
it('persists trusted four facts, original bytes and one real queue message under concurrent replay', async () => {
  const h = await setup();
  const results = await Promise.all([
    h.app.requests.create(h.account, h.input),
    h.app.requests.create(h.account, h.input),
  ]);
  expect(results.map((result) => result.status)).toEqual([
    'success',
    'success',
  ]);
  if (results[0].status !== 'success' || results[1].status !== 'success')
    throw new Error('fixture');
  expect(results[0].result.batchId).toBe(results[1].result.batchId);
  expect([results[0].replayed, results[1].replayed].sort()).toEqual([
    false,
    true,
  ]);
  const rows = await connection.db
    .select()
    .from(arrangeInputs)
    .where(eq(arrangeInputs.creatorAccountId, h.account));
  expect(rows).toHaveLength(1);
  const input = rows[0]!;
  expect(input.batchId).toBe(results[0].result.batchId);
  expect(input.evaluationNodeId).toBe(h.node);
  expect(input.boundAt?.toISOString()).toBe(businessAt);
  expect(input.occurredOn).toBe('2026-09-04');
  expect(input.createdAt.toISOString()).toBe(wallAt);
  expect(input.originalInput.text).toBe(h.text.trim());
  const [fragment] = await connection.db
    .select()
    .from(fragments)
    .where(eq(fragments.id, input.inputSource!.fragmentId));
  expect(fragment!.excerpt).toBe(h.text);
  expect(
    (
      await connection.db.execute(
        sql`select count(*)::int as n from pgboss.job where data->>'jobId'=${input.jobId}`,
      )
    ).rows[0],
  ).toEqual({ n: 1 });
  expect(
    await h.app.requests.create(h.account, {
      ...h.input,
      text: h.text + 'changed',
    }),
  ).toMatchObject({ status: 'conflict' });
  expect(h.calls()).toBe(0);
});
it('concurrent distinct intakes by the same account commit without upgrading a shared account FK lock', async () => {
  const h = await setup();
  const result = await Promise.all([
    h.app.requests.create(h.account, h.input),
    h.app.requests.create(h.account, { ...h.input, operationId: randomUUID() }),
  ]);
  expect(result.map((value) => value.status)).toEqual(['success', 'success']);
  if (result[0].status !== 'success' || result[1].status !== 'success')
    throw new Error('fixture');
  expect(result[0].result.batchId).not.toBe(result[1].result.batchId);
  expect(
    await connection.db
      .select()
      .from(arrangeInputs)
      .where(eq(arrangeInputs.creatorAccountId, h.account)),
  ).toHaveLength(2);
  expect(h.calls()).toBe(0);
});
it('unknown people remain a real pending intake; old node-less or stale selection cannot dispatch or rewrite it', async () => {
  const h = await setup();
  const pending = await h.app.requests.create(h.account, {
    ...h.input,
    personIds: [],
  });
  expect(pending.status).toBe('success');
  if (pending.status !== 'success') throw new Error('fixture');
  expect(pending.result).toMatchObject({
    status: 'needs_review',
    jobId: null,
    draftSet: null,
  });
  expect(pending.result.items[0]).toMatchObject({
    kind: 'unknown_person',
    state: 'pending',
    revision: 1,
  });
  expect(pending.result.items[0]).not.toHaveProperty('score');
  const [input] = await connection.db
    .select()
    .from(arrangeInputs)
    .where(eq(arrangeInputs.batchId, pending.result.batchId));
  expect(await h.app.runner.run(input!.jobId, 1)).toBe('ignored');
  expect(
    await h.app.requests.select(h.account, {
      operation_id: randomUUID(),
      draftId: input!.id,
      expected_input_version: input!.inputVersion,
      personIds: [h.target],
      projectId: null,
    }),
  ).toMatchObject({ status: 'validation_error' });
  expect(
    (
      await connection.db
        .select()
        .from(arrangeInputs)
        .where(eq(arrangeInputs.id, input!.id))
    )[0]!.personIds,
  ).toEqual([]);
  expect(h.calls()).toBe(0);
});
it('keeps explicit project choice and denies a missing/inaccessible one instead of writing a fake null', async () => {
  const h = await setup();
  const projectId = h.prefix + '-project';
  await connection.db.insert(grants).values({
    id: h.prefix + '-hr',
    accountId: h.account,
    role: 'hr',
    scope: 'cohort',
    cohortId: h.cohort,
    validFrom: '2026-01-01',
  });
  await connection.db.insert(projects).values({
    id: projectId,
    name: '演示课题',
    type: '课题',
    status: '进行中',
    goal: '演示目标',
    organizationId: h.prefix,
    cohortId: h.cohort,
    isTopic: true,
    creatorId: h.evaluator,
    from: '2026-01-01',
    to: '2026-12-31',
  });
  const create = await h.app.requests.create(h.account, {
    ...h.input,
    projectId,
  });
  expect(create.status).toBe('success');
  if (create.status !== 'success') throw new Error('fixture');
  const [input] = await connection.db
    .select()
    .from(arrangeInputs)
    .where(eq(arrangeInputs.batchId, create.result.batchId));
  expect(input!.projectId).toBe(projectId);
  expect(await h.app.runner.run(input!.jobId, 1)).toBe('awaiting_manual');
  const drafts = await connection.db
    .select()
    .from(recordDrafts)
    .where(eq(recordDrafts.batchId, create.result.batchId));
  expect(drafts[0]!.draft.projectId).toBe(projectId);
  expect(
    await h.app.requests.create(h.account, {
      ...h.input,
      operationId: randomUUID(),
      projectId: 'missing-project',
    }),
  ).toMatchObject({ status: 'forbidden' });
});
it('replaces the node-less legacy write path explicitly, without accepting client permission facts', async () => {
  const h = await setup();
  expect(
    await h.app.requests.create(h.account, {
      operation_id: h.input.operationId,
      text: h.text,
      personId: h.target,
      projectId: null,
      attachmentIds: [],
    }),
  ).toMatchObject({ status: 'validation_error' });
  expect(
    await h.app.requests.create(h.account, {
      ...h.input,
      actorAccountId: h.account,
      writeAllowed: true,
    }),
  ).toMatchObject({ status: 'validation_error' });
  expect(
    await h.app.requests.create(h.account, {
      ...h.input,
      evaluationNodeId: h.otherNode,
    }),
  ).toMatchObject({ status: 'forbidden' });
  expect(await h.app.requests.create(h.outsiderAccount, h.input)).toMatchObject(
    { status: 'forbidden' },
  );
  expect(h.calls()).toBe(0);
  expect(
    await connection.db
      .select()
      .from(arrangeInputs)
      .where(eq(arrangeInputs.creatorAccountId, h.account)),
  ).toHaveLength(0);
});
it('rolls back source, operation, job and the actual transactional pg-boss send when enqueue fails', async () => {
  const h = await setup();
  const requests = createRecordArrangeRequests({
    db: connection.db,
    businessNow: () => businessAt,
    now: () => new Date(wallAt),
    enqueue: async (tx, job) => {
      await boss.send(
        recordArrangeQueue,
        { jobId: job.jobId, attempt: job.attempt },
        { db: fromDrizzle(tx, sql), retryLimit: 0 },
      );
      throw new Error('synthetic enqueue failure');
    },
  });
  const beforeJobs = await connection.db.execute(
    sql`select count(*)::int as n from pgboss.job`,
  );
  const beforeFragments = await connection.db.select().from(fragments);
  await expect(requests.create(h.account, h.input)).rejects.toThrow(
    'synthetic enqueue failure',
  );
  expect(
    await connection.db
      .select()
      .from(arrangeInputs)
      .where(eq(arrangeInputs.creatorAccountId, h.account)),
  ).toHaveLength(0);
  expect(
    await connection.db
      .select()
      .from(arrangeOperations)
      .where(eq(arrangeOperations.actorAccountId, h.account)),
  ).toHaveLength(0);
  expect(await connection.db.select().from(fragments)).toHaveLength(
    beforeFragments.length,
  );
  expect(
    (
      await connection.db.execute(
        sql`select count(*)::int as n from pgboss.job`,
      )
    ).rows,
  ).toEqual(beforeJobs.rows);
});
it('does not fabricate recording/upload facts or rewrite verified source attribution', async () => {
  const h = await setup();
  expect(
    await h.app.requests.createFromSources(h.account, {
      origin: 'recording',
      originalInput: h.input,
      sources: [],
    }),
  ).toMatchObject({ status: 'validation_error' });
  expect(
    await connection.db
      .select()
      .from(arrangeInputs)
      .where(eq(arrangeInputs.creatorAccountId, h.account)),
  ).toHaveLength(0);
  expect(h.calls()).toBe(0);
});
it('rechecks current relation before replay and filters before returning any batch counters', async () => {
  const h = await setup();
  const created = await submitted(h);
  await connection.db
    .update(evaluationRelations)
    .set({ validTo: businessAt })
    .where(eq(evaluationRelations.id, h.relation));
  expect(await h.app.requests.create(h.account, h.input)).toMatchObject({
    status: 'not_found',
  });
  const read = await h.app.requests.readBatch(h.account, {
    batchId: created.receipt.batchId,
  });
  expect(read).toMatchObject({ status: 'not_found' });
  expect(read).not.toHaveProperty('result');
  expect(h.calls()).toBe(0);
});
it('runs two deliveries once and commits native846 drafts and the unique job manifest atomically', async () => {
  const h = await setup({ twoEvents: true });
  const created = await submitted(h);
  const result = await Promise.all([
    h.app.runner.run(created.jobId, 1),
    h.app.runner.run(created.jobId, 1),
  ]);
  expect(result).toContain('awaiting_manual');
  expect(h.calls()).toBe(1);
  const job = await state(created.jobId);
  expect(job.status).toBe('awaiting_manual');
  expect(job.result).not.toHaveProperty('phase');
  expect(job.result).not.toHaveProperty('draftSet');
  const metadata = job.result as {
    trace: {
      boundAt: string;
      occurredOn: string;
      dimensionVersionId: string;
      anchorVersionId: string;
    };
    manifest: { eventKey: string; draftId: string; witnesses: unknown[] }[];
  };
  expect(metadata.trace).toMatchObject({
    boundAt: businessAt,
    occurredOn: '2026-09-04',
    dimensionVersionId: 'rubric-v1',
    anchorVersionId: 'rubric-v1',
  });
  expect(metadata.manifest).toHaveLength(2);
  const rows = await connection.db
    .select()
    .from(recordDrafts)
    .where(eq(recordDrafts.batchId, created.receipt.batchId));
  expect(rows).toHaveLength(2);
  expect(new Set(rows.map((row) => row.draftId))).toEqual(
    new Set(metadata.manifest.map((row) => row.draftId)),
  );
  expect(
    rows.every(
      (row) => row.draft.origin === 'ai_suggestion' && row.revision === 1,
    ),
  ).toBe(true);
  expect(
    await connection.db
      .select()
      .from(events)
      .where(eq(events.personId, h.target)),
  ).toHaveLength(0);
  const read = await h.app.requests.readBatch(h.account, {
    batchId: created.receipt.batchId,
  });
  expect(read.status).toBe('success');
  if (read.status !== 'success') throw new Error('fixture');
  expect(read.result).toMatchObject({
    status: 'awaiting_confirmation',
    jobId: null,
    counts: { events: { total: 2, awaiting_confirmation: 2, confirmed: 0 } },
  });
  const ids = read.result.draftSet!.drafts.map((row) => row.draftId);
  expect(await h.app.runner.run(created.jobId, 1)).toBe('awaiting_manual');
  expect(h.calls()).toBe(1);
  const replay = await h.app.requests.readBatch(h.account, {
    batchId: created.receipt.batchId,
  });
  if (replay.status !== 'success') throw new Error('fixture');
  expect(replay.result.draftSet!.drafts.map((row) => row.draftId)).toEqual(ids);
});
it('uses saved business time and source date after the current rule category has advanced', async () => {
  const h = await setup();
  const created = await submitted(h);
  h.advanceBusiness('2026-10-04T08:00:00.000Z');
  expect(await h.app.runner.run(created.jobId, 1)).toBe('awaiting_manual');
  const [batch] = await connection.db
    .select()
    .from(recordDraftBatches)
    .where(eq(recordDraftBatches.batchId, created.receipt.batchId));
  const drafts = await connection.db
    .select()
    .from(recordDrafts)
    .where(eq(recordDrafts.batchId, created.receipt.batchId));
  expect(batch!.occurredOn).toBe('2026-09-04');
  expect(batch!.createdAt.toISOString()).toBe(wallAt);
  expect(drafts[0]!.draft).toMatchObject({
    dimensionVersionId: 'rubric-v1',
    anchorVersionId: 'rubric-v1',
  });
});
it('does not store a structurally valid but forged model citation', async () => {
  const h = await setup({ invalid: true });
  const created = await submitted(h);
  expect(await h.app.runner.run(created.jobId, 1)).toBe('failed');
  expect(
    await connection.db
      .select()
      .from(recordDraftBatches)
      .where(eq(recordDraftBatches.batchId, created.receipt.batchId)),
  ).toHaveLength(0);
  expect((await state(created.jobId)).result).toMatchObject({
    failure: { kind: 'invalid_response', retryable: false },
    manifest: [],
  });
});
it('current revocation during the model call fences the final real write', async () => {
  const h = await setup({
    before: async () => {
      await during();
    },
  });
  const created = await submitted(h);
  const during = () =>
    connection.db
      .update(evaluationRelations)
      .set({ revokedAt: businessAt })
      .where(eq(evaluationRelations.id, h.relation))
      .then(() => undefined);
  expect(await h.app.runner.run(created.jobId, 1)).toBe('failed');
  expect(
    await connection.db
      .select()
      .from(recordDraftBatches)
      .where(eq(recordDraftBatches.batchId, created.receipt.batchId)),
  ).toHaveLength(0);
  expect((await state(created.jobId)).result).toMatchObject({
    failure: { kind: 'input_changed', retryable: false },
  });
});
it('a current cancellation through the real842 service wins before draft persistence', async () => {
  const h = await setup({
    before: async () => {
      await cancel();
    },
  });
  const created = await submitted(h);
  const cancel = async () => {
    const current = await state(created.jobId);
    const response = await h.app.requests.command(h.account, {
      jobId: created.jobId,
      action: 'cancel',
      operationId: randomUUID(),
      expectedRevision: current.revision,
    });
    expect(response.status).toBe('success');
  };
  expect(await h.app.runner.run(created.jobId, 1)).toBe('cancelled');
  expect(
    await connection.db
      .select()
      .from(recordDraftBatches)
      .where(eq(recordDraftBatches.batchId, created.receipt.batchId)),
  ).toHaveLength(0);
  expect(h.calls()).toBe(1);
});
it('permits only a proven-not-sent explicit network retry and keeps native metadata across842 reset', async () => {
  const h = await setup({ noSendFailure: true });
  const created = await submitted(h);
  expect(await h.app.runner.run(created.jobId, 1)).toBe('failed');
  const failed = await state(created.jobId);
  const retried = await h.app.requests.command(h.account, {
    jobId: created.jobId,
    action: 'retry',
    operationId: randomUUID(),
    expectedRevision: failed.revision,
  });
  expect(retried.status).toBe('success');
  expect((await state(created.jobId)).result).toMatchObject({
    actorPersonId: h.evaluator,
    operationId: h.input.operationId,
    failure: { kind: 'network', retryable: true },
  });
  expect(await h.app.runner.run(created.jobId, 2)).toBe('awaiting_manual');
  expect(h.calls()).toBe(2);
  expect(await h.app.runner.run(created.jobId, 1)).toBe('ignored');
  expect(h.calls()).toBe(2);
});
it('native846 insertion and the job result roll back together on an actual unique-row collision', async () => {
  let collision = false;
  const conflictId = randomUUID();
  const h = await setup({}, () => (collision ? conflictId : randomUUID()));
  const created = await submitted(h);
  const reference = {
    ...created.input.inputSource!,
    location: { kind: 'document' as const, paragraph: 'input' },
  };
  const foreignBatchId = randomUUID();
  const foreign = recordBatchDraftSetSchema.parse({
    batchId: foreignBatchId,
    revision: 1,
    drafts: [
      {
        batchId: foreignBatchId,
        evaluationNodeId: h.node,
        draftId: conflictId,
        revision: 1,
        origin: 'ai_suggestion',
        projectId: null,
        personIds: [h.target],
        sourceReferences: [reference],
        dimensionVersionId: 'rubric-v1',
        anchorVersionId: 'rubric-v1',
        sbi: {
          title: '演示先存草稿',
          situation: '',
          behavior: '演示',
          impact: '',
        },
        scores: [],
      },
    ],
    duplicateCandidates: [],
  });
  await connection.db.transaction((tx) =>
    storeTrustedRecordDraftBatch(tx, {
      draftSet: foreign,
      originalInput: created.input.originalInput,
      occurredOn: created.input.occurredOn!,
      modelVersion: 'google/gemini-3.8-flash',
      createdByAccountId: h.account,
      createdAt: new Date(wallAt),
    }),
  );
  collision = true;
  expect(await h.app.runner.run(created.jobId, 1)).toBe('failed');
  expect(
    await connection.db
      .select()
      .from(recordDraftBatches)
      .where(eq(recordDraftBatches.batchId, created.receipt.batchId)),
  ).toHaveLength(0);
  expect((await state(created.jobId)).result).toMatchObject({ manifest: [] });
  expect(h.calls()).toBe(1);
  expect(await h.app.runner.run(created.jobId, 1)).toBe('ignored');
  expect(h.calls()).toBe(1);
});
it('a current no-review flag blocks reading and model dispatch', async () => {
  const h = await setup();
  const created = await submitted(h);
  await connection.db
    .update(people)
    .set({ noReview: true })
    .where(eq(people.id, h.target));
  expect(
    await h.app.requests.readBatch(h.account, {
      batchId: created.receipt.batchId,
    }),
  ).toMatchObject({ status: 'not_found' });
  expect(await h.app.runner.run(created.jobId, 1)).toBe('failed');
  expect(h.calls()).toBe(0);
});
it('an account rebinding cannot transfer an accepted batch even with a new valid node relation', async () => {
  const h = await setup();
  const created = await submitted(h);
  await connection.db.insert(evaluationRelations).values({
    id: h.prefix + '-new-evaluator',
    evaluationNodeId: h.node,
    personId: h.target,
    evaluatorId: h.other,
    kind: 'evaluator',
    validFrom: '2026-01-01T00:00:00Z',
  });
  await connection.db
    .update(accountBindings)
    .set({ personId: h.other })
    .where(eq(accountBindings.accountId, h.account));
  expect(
    await h.app.requests.readBatch(h.account, {
      batchId: created.receipt.batchId,
    }),
  ).toMatchObject({ status: 'not_found' });
  expect(await h.app.requests.create(h.account, h.input)).toMatchObject({
    status: 'not_found',
  });
  expect(await h.app.runner.run(created.jobId, 1)).toBe('failed');
  expect(h.calls()).toBe(0);
});
it('rejects an input budget overflow before creating sources or dispatching a model', async () => {
  const h = await setup();
  expect(
    await h.app.requests.create(h.account, {
      ...h.input,
      text: '字'.repeat(80001),
    }),
  ).toMatchObject({ status: 'validation_error' });
  expect(
    await connection.db
      .select()
      .from(arrangeInputs)
      .where(eq(arrangeInputs.creatorAccountId, h.account)),
  ).toHaveLength(0);
  expect(h.calls()).toBe(0);
});
async function intakeRowCounts() {
  const result = await connection.db.execute(sql`
    select
      (select count(*) from ${originals}) as originals,
      (select count(*) from ${originalVersions}) as versions,
      (select count(*) from ${fragments}) as fragments,
      (select count(*) from ${jobSnapshots}) as jobs,
      (select count(*) from ${arrangeInputs}) as inputs,
      (select count(*) from ${arrangeOperations}) as operations,
      (select count(*) from pgboss.job) as queued
  `);
  return result.rows[0];
}
it.each([
  ['quotes', '"'],
  ['backslashes', '\\'],
  ['newlines', '\n'],
])(
  'rejects encoded %s overflow without persistent intake or queue side effects',
  async (_label, character) => {
    const h = await setup();
    const text = '演示：' + character.repeat(100000);
    expect(Buffer.byteLength(text)).toBeLessThan(240000);
    const before = await intakeRowCounts();
    const result = await h.app.requests.create(h.account, { ...h.input, text });
    expect(result).toMatchObject({
      status: 'validation_error',
      fieldErrors: { text: [expect.any(String)] },
      input: { text },
    });
    expect(await intakeRowCounts()).toEqual(before);
    expect(h.calls()).toBe(0);
  },
);
it('uses exact encoded boundary with saved rules and preserves accepted replay after rule growth', async () => {
  const h = await setup();
  const [anchor] = await connection.db
    .select()
    .from(anchors)
    .where(eq(anchors.id, '845-old-1'));
  if (!anchor) throw new Error('native rule fixture required');
  try {
    // Exercise real frozen-rule overhead, not a guessed text-only allowance.
    await connection.db
      .update(anchors)
      .set({ text: anchor.text + '"\\\n'.repeat(1000) })
      .where(eq(anchors.id, anchor.id));
    const original = await submitted(h);
    const prepared = await connection.db.transaction(async (tx) => {
      const metadata = parseBatchMetadata((await state(original.jobId)).result);
      if (!metadata) throw new Error('native metadata required');
      const snapshot = await loadRecordBatchSnapshot(
        tx,
        original.input,
        metadata,
        businessAt,
        1,
      );
      const rules = await readBatchArrangeRules(tx, businessAt);
      if (!snapshot || !rules) throw new Error('native preparation required');
      expect(rules.anchorVersionId).toBe('rubric-v1');
      const result = prepareBatch(snapshot, rules);
      if (result.status !== 'ready')
        throw new Error('native preparation failed');
      return result.value;
    });
    const fits = (text: string) =>
      validModelinkInput({
        messages: batchMessages({
          ...prepared,
          sources: prepared.sources.map((source) => ({ ...source, text })),
        }),
        promptVersion: BATCH_PROMPT_VERSION,
        schema: modelBatchSchema,
      });
    let low = 0,
      high = 100000;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (fits('演示：' + '"'.repeat(middle))) low = middle;
      else high = middle;
    }
    let text = '演示：' + '"'.repeat(low);
    for (let padding = 0; padding < 3 && fits(text + 'x'); padding++)
      text += 'x';
    expect(fits(text)).toBe(true);
    expect(fits(text + 'x')).toBe(false);
    expect(Buffer.byteLength(text + 'x')).toBeLessThan(240000);
    const acceptedInput = { ...h.input, operationId: randomUUID(), text };
    const accepted = await h.app.requests.create(h.account, acceptedInput);
    expect(accepted.status).toBe('success');
    const before = await intakeRowCounts();
    expect(
      await h.app.requests.create(h.account, {
        ...acceptedInput,
        operationId: randomUUID(),
        text: text + 'x',
      }),
    ).toMatchObject({
      status: 'validation_error',
      input: { text: text + 'x' },
    });
    expect(await intakeRowCounts()).toEqual(before);
    await connection.db
      .update(anchors)
      .set({ text: anchor.text + '"'.repeat(100000) })
      .where(eq(anchors.id, anchor.id));
    expect(await h.app.requests.create(h.account, acceptedInput)).toMatchObject(
      {
        status: 'success',
        replayed: true,
      },
    );
    expect(await intakeRowCounts()).toEqual(before);
    expect(h.calls()).toBe(0);
  } finally {
    await connection.db
      .update(anchors)
      .set({ text: anchor.text })
      .where(eq(anchors.id, anchor.id));
  }
});
it('does not fill missing legacy batch/time/node facts with current values', async () => {
  const h = await setup();
  const created = await submitted(h);
  await connection.db
    .update(arrangeInputs)
    .set({ boundAt: null })
    .where(eq(arrangeInputs.id, created.input.id));
  expect(
    await h.app.requests.readBatch(h.account, {
      batchId: created.receipt.batchId,
    }),
  ).toMatchObject({ status: 'not_found' });
  expect(await h.app.runner.run(created.jobId, 1)).toBe('failed');
  expect(h.calls()).toBe(0);
  expect(
    await connection.db
      .select()
      .from(recordDraftBatches)
      .where(eq(recordDraftBatches.batchId, created.receipt.batchId)),
  ).toHaveLength(0);
});
it('does not model new text mentioning a current directory person outside the selected node', async () => {
  const h = await setup();
  const [hidden] = await connection.db
    .select()
    .from(people)
    .where(eq(people.id, h.other));
  expect(
    await h.app.requests.create(h.account, {
      ...h.input,
      text: h.text + hidden!.name,
    }),
  ).toMatchObject({ status: 'forbidden' });
  expect(h.calls()).toBe(0);
});
it('a later real source link to a cross-node person revokes the entire text before counters or model dispatch', async () => {
  const h = await setup();
  const created = await submitted(h);
  const eventId = randomUUID();
  // This is a synthetic pre-existing related fact for a negative privacy test,
  // never an event inserted by the arrangement application to acquire permission.
  await connection.db.insert(events).values({
    id: eventId,
    evaluationNodeId: h.otherNode,
    personId: h.other,
    recorderId: h.evaluator,
    projectId: null,
    occurredOn: '2026-09-04',
    title: '演示关联事实',
    situation: '演示情境',
    behavior: '演示行为',
    impact: '',
    ruleVersionId: 'rubric-v1',
    demo: true,
  });
  await connection.db
    .insert(eventSources)
    .values({ eventId, ...created.input.inputSource! });
  expect(
    await h.app.requests.readBatch(h.account, {
      batchId: created.receipt.batchId,
    }),
  ).toMatchObject({ status: 'not_found' });
  expect(await h.app.runner.run(created.jobId, 1)).toBe('failed');
  expect(h.calls()).toBe(0);
});
it('an immutable source digest change during the call prevents the native final draft write', async () => {
  const h = await setup({
    before: async () => {
      const [row] = await connection.db
        .select()
        .from(arrangeInputs)
        .where(eq(arrangeInputs.creatorAccountId, h.account));
      await connection.db
        .update(fragments)
        .set({ excerpt: '演示：来源已被非法改写' })
        .where(eq(fragments.id, row!.inputSource!.fragmentId));
    },
  });
  const created = await submitted(h);
  expect(await h.app.runner.run(created.jobId, 1)).toBe('failed');
  expect(h.calls()).toBe(1);
  expect(
    await connection.db
      .select()
      .from(recordDraftBatches)
      .where(eq(recordDraftBatches.batchId, created.receipt.batchId)),
  ).toHaveLength(0);
  expect((await state(created.jobId)).result).toMatchObject({ manifest: [] });
});
it('composes the actual Modelink factory and JSON protocol with native persistence using only a local synthetic HTTP response', async () => {
  const h = await setup();
  let sends = 0;
  let jsonBytes = 0;
  const app = createRecordArrangeWorker(
    {
      db: connection.db,
      boss,
      environment: { MODELINK_API_KEY: 'synthetic-offline-845-key' },
      businessNow: () => businessAt,
      now: () => new Date(wallAt),
    },
    {
      fetch: async (_url, init) => {
        sends++;
        const body = String(init!.body);
        jsonBytes = Buffer.byteLength(body);
        const wire = JSON.parse(body);
        expect(wire).toMatchObject({
          model: MODELINK_MODEL,
          response_format: { type: 'json_object' },
          stream: false,
          max_tokens: 8192,
        });
        const generated = await h.client.generateStructured({
          messages: wire.messages,
          schema: modelBatchSchema,
          promptVersion: BATCH_PROMPT_VERSION,
        });
        if (!generated.ok) throw new Error('synthetic local model failed');
        return new Response(
          JSON.stringify({
            id: 'synthetic-offline-845',
            model: MODELINK_MODEL,
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  role: 'assistant',
                  content: JSON.stringify(generated.value),
                },
              },
            ],
          }),
        );
      },
    },
  );
  const created = await submitted({ ...h, app });
  expect(await app.runner.run(created.jobId, 1)).toBe('awaiting_manual');
  expect(sends).toBe(1);
  expect(jsonBytes).toBeGreaterThan(Buffer.byteLength(h.text));
  expect(jsonBytes).toBeLessThan(262144);
  // Size only: never print text, request headers or the JSON body.
  console.info('BOW-845 synthetic native request JSON bytes:', jsonBytes);
  expect(
    await connection.db
      .select()
      .from(recordDrafts)
      .where(eq(recordDrafts.batchId, created.receipt.batchId)),
  ).toHaveLength(1);
});
it('a real transport outcome_unknown is terminal and cannot be replayed as a no-send retry', async () => {
  const h = await setup();
  let sends = 0;
  const client = createRecordArrangeModelClient(
    { MODELINK_API_KEY: 'synthetic-offline-845-key' },
    {
      fetch: async () => {
        sends++;
        throw new TypeError('synthetic in-flight failure');
      },
    },
  );
  const app = createRecordArrangeApplication({
    db: connection.db,
    boss,
    client,
    businessNow: () => businessAt,
    now: () => new Date(wallAt),
  });
  const created = await submitted({ ...h, app });
  expect(await app.runner.run(created.jobId, 1)).toBe('failed');
  const failed = await state(created.jobId);
  expect(failed.result).toMatchObject({
    failure: { kind: 'outcome_unknown', retryable: false },
    manifest: [],
  });
  expect(
    await app.requests.command(h.account, {
      jobId: created.jobId,
      action: 'retry',
      operationId: randomUUID(),
      expectedRevision: failed.revision,
    }),
  ).toMatchObject({ status: 'forbidden' });
  expect(await app.runner.run(created.jobId, 1)).toBe('ignored');
  expect(sends).toBe(1);
});
it('projects the native job through842 with current authorization and rejects unsupported controls', async () => {
  const h = await setup();
  const created = await submitted(h);
  expect(await h.app.requests.read(h.account, created.jobId)).toMatchObject({
    status: 'success',
  });
  expect(await h.app.requests.read(h.outsiderAccount, created.jobId)).toEqual({
    status: 'forbidden',
  });
  const job = await state(created.jobId);
  expect(
    await h.app.requests.command(h.account, {
      jobId: created.jobId,
      action: 'resume',
      operationId: randomUUID(),
      expectedRevision: job.revision,
    }),
  ).toEqual({ status: 'forbidden' });
  expect(await h.app.runner.run(created.jobId, 1)).toBe('awaiting_manual');
  expect(await h.app.requests.read(h.account, created.jobId)).toMatchObject({
    status: 'success',
    snapshot: { status: 'awaiting_manual', canRetry: false, canCancel: false },
  });
  expect(h.calls()).toBe(1);
});

it('validates batch lookup and refuses blank text and unavailable media without dispatch', async () => {
  const h = await setup();
  expect(
    await h.app.requests.readBatch(h.account, { batchId: '' }),
  ).toMatchObject({ status: 'validation_error' });
  expect(
    await h.app.requests.readBatch(h.account, { batchId: randomUUID() }),
  ).toMatchObject({ status: 'not_found' });
  expect(
    await h.app.requests.create(h.account, { ...h.input, text: '  ' }),
  ).toMatchObject({ status: 'validation_error' });
  expect(
    await h.app.requests.createFromSources(h.account, {
      origin: 'attachment',
      originalInput: h.input,
      sources: [],
    }),
  ).toMatchObject({ status: 'validation_error' });
  expect(
    await h.app.requests.page(h.outsiderAccount, {
      personId: null,
      projectId: null,
    }),
  ).toEqual({
    status: 'forbidden',
  });
  expect(h.calls()).toBe(0);
});

it.each([
  'owner',
  'source-date',
  'input-text',
  'node',
  'person',
  'source-reference',
  'manifest-count',
  'manifest-id',
  'metadata',
] as const)(
  'does not disclose a persisted batch after its actual %s facts diverge',
  async (change) => {
    const h = await setup();
    const created = await submitted(h);
    expect(await h.app.runner.run(created.jobId, 1)).toBe('awaiting_manual');
    const [row] = await connection.db
      .select()
      .from(recordDrafts)
      .where(eq(recordDrafts.batchId, created.receipt.batchId));
    if (!row) throw new Error('native draft missing');
    // Simulate a competing/broken trusted writer. These are real database rows,
    // not new authority facts or a fake successful human confirmation.
    if (change === 'owner') {
      await connection.db
        .update(recordDraftBatches)
        .set({ createdByAccountId: h.outsiderAccount })
        .where(eq(recordDraftBatches.batchId, created.receipt.batchId));
    } else if (change === 'source-date') {
      await connection.db
        .update(recordDraftBatches)
        .set({ occurredOn: '2026-09-05' })
        .where(eq(recordDraftBatches.batchId, created.receipt.batchId));
    } else if (change === 'input-text') {
      await connection.db
        .update(recordDraftBatches)
        .set({
          originalInput: {
            ...created.input.originalInput,
            text: '演示：其他来源',
          },
        })
        .where(eq(recordDraftBatches.batchId, created.receipt.batchId));
    } else if (
      change === 'manifest-count' ||
      change === 'manifest-id' ||
      change === 'metadata'
    ) {
      const job = await state(created.jobId);
      const metadata = job.result as { manifest: Array<{ draftId: string }> };
      const value =
        change === 'metadata'
          ? {}
          : {
              ...metadata,
              manifest:
                change === 'manifest-count'
                  ? []
                  : metadata.manifest.map((entry) => ({
                      ...entry,
                      draftId: randomUUID(),
                    })),
            };
      await connection.db
        .update(jobSnapshots)
        .set({ result: value })
        .where(eq(jobSnapshots.jobId, created.jobId));
    } else {
      const draft = structuredClone(row.draft);
      if (change === 'node') draft.evaluationNodeId = h.otherNode;
      if (change === 'person') draft.personIds = [h.other];
      if (change === 'source-reference')
        draft.sourceReferences[0]!.fragmentId = randomUUID();
      await connection.db
        .update(recordDrafts)
        .set({ draft })
        .where(eq(recordDrafts.draftId, row.draftId));
    }
    expect(
      await h.app.requests.readBatch(h.account, {
        batchId: created.receipt.batchId,
      }),
    ).toMatchObject({ status: 'not_found' });
    expect(await h.app.requests.read(h.account, created.jobId)).toEqual({
      status: 'forbidden',
    });
    expect(await h.app.requests.create(h.account, h.input)).toMatchObject({
      status: 'not_found',
    });
    expect(h.calls()).toBe(1);
  },
);

it('rejects an invalid server business clock without substituting wall time or creating sources', async () => {
  const h = await setup();
  const requests = createRecordArrangeRequests({
    db: connection.db,
    businessNow: () => 'invalid',
    now: () => new Date(wallAt),
    enqueue: async () => {
      throw new Error('must not enqueue');
    },
  });
  await expect(requests.create(h.account, h.input)).rejects.toThrow(
    'business_clock_required',
  );
  expect(
    await connection.db
      .select()
      .from(arrangeInputs)
      .where(eq(arrangeInputs.creatorAccountId, h.account)),
  ).toHaveLength(0);
});

it('keeps the input unsubmitted when no dimension rule applies at its actual save time', async () => {
  const h = await setup();
  await connection.db
    .update(ruleVersionApplicability)
    .set({ effectiveUntil: new Date(businessAt) })
    .where(eq(ruleVersionApplicability.periodId, '845-rubric-v1'));
  try {
    expect(await h.app.requests.create(h.account, h.input)).toMatchObject({
      status: 'validation_error',
      fieldErrors: { rules: expect.any(Array) },
    });
    expect(
      await connection.db
        .select()
        .from(arrangeInputs)
        .where(eq(arrangeInputs.creatorAccountId, h.account)),
    ).toHaveLength(0);
    expect(h.calls()).toBe(0);
  } finally {
    await connection.db
      .update(ruleVersionApplicability)
      .set({ effectiveUntil: new Date('2026-10-01T00:00:00Z') })
      .where(eq(ruleVersionApplicability.periodId, '845-rubric-v1'));
  }
});

it('ignores unknown and superseded queue deliveries without invoking the model', async () => {
  const h = await setup();
  expect(await h.app.runner.run(randomUUID(), 1)).toBe('ignored');
  const created = await submitted(h);
  const replacement = await h.app.requests.create(h.account, {
    ...h.input,
    operationId: randomUUID(),
  });
  if (replacement.status !== 'success') throw new Error('fixture');
  const [next] = await connection.db
    .select()
    .from(arrangeInputs)
    .where(eq(arrangeInputs.batchId, replacement.result.batchId));
  await connection.db
    .update(arrangeInputs)
    .set({ supersededByInputId: next!.id })
    .where(eq(arrangeInputs.id, created.input.id));
  expect(await h.app.runner.run(created.jobId, 1)).toBe('ignored');
  expect(
    await h.app.requests.readBatch(h.account, {
      batchId: created.receipt.batchId,
    }),
  ).toMatchObject({ status: 'not_found' });
  expect(h.calls()).toBe(0);
});

it('rejects a producer attribution that disagrees with immutable intake people before modeling', async () => {
  const h = await setup();
  const created = await submitted(h);
  await connection.db
    .update(arrangeInputs)
    .set({
      sourceContexts: created.input.sourceContexts.map((source) => ({
        ...source,
        attributedPersonIds: [h.other],
      })),
    })
    .where(eq(arrangeInputs.id, created.input.id));
  expect(await h.app.runner.run(created.jobId, 1)).toBe('failed');
  expect(h.calls()).toBe(0);
  expect(
    await h.app.requests.readBatch(h.account, {
      batchId: created.receipt.batchId,
    }),
  ).toMatchObject({ status: 'not_found' });
});

it('refuses a structurally valid upload input before producing text sources or queue jobs', async () => {
  const h = await setup();
  expect(
    await h.app.requests.create(h.account, {
      ...h.input,
      files: [{ clientFileId: 'demo-file', uploadId: 'demo-upload' }],
    }),
  ).toMatchObject({
    status: 'validation_error',
    fieldErrors: { files: expect.any(Array) },
  });
  expect(
    await connection.db
      .select()
      .from(arrangeInputs)
      .where(eq(arrangeInputs.creatorAccountId, h.account)),
  ).toHaveLength(0);
  expect(h.calls()).toBe(0);
});

it('does not treat a retained partial job as a fresh model attempt after worker restart', async () => {
  const h = await setup();
  const created = await submitted(h);
  // A persisted interrupted platform state is not proof that nothing was sent.
  await connection.db
    .update(jobSnapshots)
    .set({ status: 'partial' })
    .where(eq(jobSnapshots.jobId, created.jobId));
  expect(await h.app.runner.run(created.jobId, 1)).toBe('ignored');
  expect((await state(created.jobId)).status).toBe('partial');
  expect(h.calls()).toBe(0);
});

it('rolls back intake when pg-boss declines the enqueue without throwing', async () => {
  const h = await setup();
  // Only the external queue return boundary is controlled. The source/job/input
  // writes and rollback below still execute against the real database.
  const send = vi.spyOn(boss, 'send').mockResolvedValueOnce(null);
  try {
    await expect(h.app.requests.create(h.account, h.input)).rejects.toThrow(
      'Record arrangement enqueue was not committed',
    );
    expect(
      await connection.db
        .select()
        .from(arrangeInputs)
        .where(eq(arrangeInputs.creatorAccountId, h.account)),
    ).toHaveLength(0);
    expect(h.calls()).toBe(0);
  } finally {
    send.mockRestore();
  }
});

it('registers the actual pg-boss consumer and reaches native awaiting_manual without direct worker invocation', async () => {
  // Test-only queue cleanup removes messages already exercised by direct runner
  // tests. The last case then proves one fresh actual delivery, not a mock send.
  await boss.deleteQueuedJobs(recordArrangeQueue);
  const h = await setup();
  const worker = createRecordArrangeWorker(
    {
      db: connection.db,
      boss,
      environment: { MODELINK_API_KEY: 'synthetic-offline-845-key' },
      businessNow: () => businessAt,
      now: () => new Date(wallAt),
    },
    {
      fetch: async (_url, init) => {
        const wire = JSON.parse(String(init?.body));
        const response = await h.client.generateStructured({
          messages: wire.messages,
          schema: modelBatchSchema,
          promptVersion: BATCH_PROMPT_VERSION,
        });
        if (!response.ok) throw new Error('synthetic local model failed');
        return new Response(
          JSON.stringify({
            model: MODELINK_MODEL,
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  role: 'assistant',
                  content: JSON.stringify(response.value),
                },
              },
            ],
          }),
        );
      },
    },
  );
  const created = await submitted({ ...h, app: worker });
  await worker.register();
  const deadline = Date.now() + 15000;
  while (
    Date.now() < deadline &&
    (await state(created.jobId)).status !== 'awaiting_manual'
  )
    await new Promise((resolve) => setTimeout(resolve, 100));
  expect((await state(created.jobId)).status).toBe('awaiting_manual');
  expect(h.calls()).toBe(1);
  expect(
    await connection.db
      .select()
      .from(recordDrafts)
      .where(eq(recordDrafts.batchId, created.receipt.batchId)),
  ).toHaveLength(1);
}, 20000);
