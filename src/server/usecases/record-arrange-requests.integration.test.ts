import { randomUUID } from 'node:crypto';
import { PgBoss, fromDrizzle } from 'pg-boss';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, afterAll, expect, it } from 'vitest';
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
} from '../modules/records';
import { evaluationRelations } from '../modules/programs';
import { accountBindings, grants, people } from '../modules/directory';
import { projects } from '../modules/staffing';
import { jobSnapshots } from '../jobs/schema';
import { recordArrangeQueue } from '../jobs/record-arrange';
import { createModelinkMaasClient, MODELINK_MODEL } from '../integrations/maas';
import {
  modelBatchSchema,
  BATCH_PROMPT_VERSION,
} from '../modules/records/arrange/batch-prompt';
import { materialBatchReceiptSchema } from '../../contracts/materials';
import { recordBatchDraftSetSchema } from '../../contracts/record';

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
  const client = createModelinkMaasClient(
    {
      apiKey: 'synthetic-offline-845-key',
      maxAttempts: 1,
      attemptTimeoutMs: 30000,
      totalTimeoutMs: 45000,
      maxTokens: 8192,
      maxResponseBytes: 1048576,
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
  const app = createRecordArrangeApplication({
    db: connection.db,
    boss,
    client,
    businessNow: () => businessAt,
    now: () => new Date(wallAt),
  });
  const created = await submitted({ ...h, app });
  expect(await app.runner.run(created.jobId, 1)).toBe('awaiting_manual');
  expect(sends).toBe(1);
  expect(jsonBytes).toBeGreaterThan(Buffer.byteLength(h.text));
  expect(jsonBytes).toBeLessThan(262144);
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
  const client = createModelinkMaasClient(
    { apiKey: 'synthetic-offline-845-key', maxAttempts: 1 },
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
it('registers the actual pg-boss consumer and reaches native awaiting_manual without direct worker invocation', async () => {
  // Test-only queue cleanup removes messages already exercised by direct runner
  // tests. The last case then proves one fresh actual delivery, not a mock send.
  await boss.deleteQueuedJobs(recordArrangeQueue);
  const h = await setup();
  const created = await submitted(h);
  await h.app.register();
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
