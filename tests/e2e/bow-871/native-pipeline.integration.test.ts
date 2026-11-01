import { createHash, randomUUID } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { createDatabase } from '../../../src/server/db/client';
import { accountBindings } from '../../../src/server/modules/directory';
import { evaluationRelations } from '../../../src/server/modules/programs';
import {
  events,
  eventSources,
  recordSaves,
  fragments,
  originalVersions,
  originals,
  recordDrafts,
} from '../../../src/server/modules/records';
import {
  aiSuggestions,
  confirmations,
} from '../../../src/server/modules/talent';
import { arrangeInputs } from '../../../src/server/modules/records/arrange/input-state/schema';
import { jobSnapshots } from '../../../src/server/jobs/schema';
import { recordArrangeQueue } from '../../../src/server/jobs/record-arrange';
import { createRecordArrangeWorker } from '../../../src/server/usecases/record-arrange-worker';
import {
  saveRecordDraft,
  undoRecordSave,
} from '../../../src/server/usecases/record-save';
import { MODELINK_MODEL } from '../../../src/server/integrations/maas';
import {
  recordSaveInputSchema,
  type RecordBatchDraft,
} from '../../../src/contracts/record';
import {
  nativeDatabase,
  seedNativeCase,
  seedNativeRules,
  businessAt,
  wallAt,
} from '../../fixtures/bow-845/native';

// Only the external model HTTP response is synthetic. Producers, pg-boss workers,
// current account/node facts, original bytes, draft/save/undo and all SQL are real.
let connection: Awaited<ReturnType<typeof nativeDatabase>>;
const bosses: PgBoss[] = [];
const extraConnections: ReturnType<typeof createDatabase>[] = [];
beforeAll(async () => {
  connection = await nativeDatabase();
  await seedNativeRules(connection.db);
}, 30_000);
afterEach(async () => {
  for (const boss of bosses.splice(0)) {
    await boss.deleteQueuedJobs(recordArrangeQueue);
    await boss.stop();
  }
  for (const extra of extraConnections.splice(0)) await extra.pool.end();
});
afterAll(async () => {
  await connection?.close();
});

async function newBoss() {
  const boss = new PgBoss({ connectionString: connection.testUrl });
  // Do not print connection-bearing error details. A worker error is observed by
  // the deadline/assertions below, never converted into a successful empty list.
  boss.on('error', () => undefined);
  await boss.start();
  bosses.push(boss);
  await boss.createQueue(recordArrangeQueue, { retryLimit: 0 });
  return boss;
}
async function eventually(check: () => Promise<boolean>, label: string) {
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Native pipeline deadline: ' + label);
}
async function job(id: string) {
  const [value] = await connection.db
    .select()
    .from(jobSnapshots)
    .where(eq(jobSnapshots.jobId, id));
  if (!value) throw new Error('Missing actual job');
  return value;
}
async function setup(
  options: {
    twoEvents?: boolean;
    beforeResponse?: () => Promise<void>;
    badCitation?: boolean;
    newId?: () => string;
  } = {},
) {
  const facts = await seedNativeCase(connection.db);
  let calls = 0;
  let business = businessAt;
  let wall = Date.parse(wallAt);
  const requests: unknown[] = [];
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    calls++;
    const wire = JSON.parse(String(init?.body));
    const input = JSON.parse(
      wire.messages.find((m: { role: string }) => m.role === 'user').content,
    );
    requests.push(input);
    await options.beforeResponse?.();
    const source = input.sources[0];
    const anchor = input.anchors.find((a: { value: number }) => a.value === 3);
    const quotes = options.twoEvents
      ? ['补齐回滚步骤', '记录边界触发条件']
      : ['补齐回滚步骤'];
    const response = {
      events: quotes.map((quote, index) => ({
        eventKey: 'offline-' + index,
        personIds: input.personIds,
        sbi: {
          title: '演示回归事件' + index,
          situation: '',
          behavior: quote,
          impact: '',
        },
        evidence: [
          {
            reference: options.badCitation
              ? { ...source.reference, fragmentId: 'untrusted-model-fragment' }
              : source.reference,
            quote,
          },
        ],
        scores: input.personIds.map((personId: string) => ({
          state: 'suggested',
          personId,
          dimensionId: anchor.dimensionId,
          value: 3,
          anchor: {
            id: anchor.id,
            text: anchor.text,
            ruleVersion: anchor.versionId,
          },
          citations: [
            {
              reference: options.badCitation
                ? {
                    ...source.reference,
                    fragmentId: 'untrusted-model-fragment',
                  }
                : source.reference,
              quote,
            },
          ],
        })),
      })),
      similarGroups: [],
    };
    return new Response(
      JSON.stringify({
        model: MODELINK_MODEL,
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: JSON.stringify(response) },
          },
        ],
      }),
    );
  };
  const construct = (db: typeof connection.db, boss: PgBoss) =>
    createRecordArrangeWorker(
      {
        db,
        boss,
        environment: { MODELINK_API_KEY: 'synthetic-offline-bow871' },
        ...(options.newId ? { newId: options.newId } : {}),
        businessNow: () => business,
        now: () => new Date(wall),
      },
      { fetch },
    );
  const boss = await newBoss();
  const app = construct(connection.db, boss);
  return {
    ...facts,
    app,
    boss,
    construct,
    requests,
    calls: () => calls,
    clock: {
      businessNow: () => business,
      wallNow: () => new Date(wall).toISOString(),
    },
    advanceBusiness: (value: string) => {
      business = value;
    },
    advanceWall: (ms: number) => {
      wall += ms;
    },
  };
}
type Harness = Awaited<ReturnType<typeof setup>>;
async function submit(h: Harness) {
  const result = await h.app.requests.create(h.account, h.input);
  expect(result.status).toBe('success');
  if (result.status !== 'success') throw new Error('Native intake failed');
  const [row] = await connection.db
    .select()
    .from(arrangeInputs)
    .where(eq(arrangeInputs.batchId, result.result.batchId));
  if (!row) throw new Error('Native intake absent');
  return { batchId: result.result.batchId, jobId: row.jobId, row };
}
async function drafts(batchId: string) {
  return connection.db
    .select()
    .from(recordDrafts)
    .where(eq(recordDrafts.batchId, batchId))
    .orderBy(recordDrafts.draftId);
}
function saveInput(draft: RecordBatchDraft, operationId = randomUUID()) {
  return recordSaveInputSchema.parse({
    operation_id: operationId,
    expected_revision: draft.revision,
    draftId: draft.draftId,
    personIds: draft.personIds,
    projectId: draft.projectId,
    sbi: draft.sbi,
    decisions: draft.scores.map((score) => ({
      personId: score.personId,
      dimensionId: score.dimensionId,
      action: 'confirm',
    })),
  });
}
async function delivered(h: Harness) {
  const submitted = await submit(h);
  await h.app.register();
  await eventually(
    async () => (await job(submitted.jobId)).status === 'awaiting_manual',
    'actual queue delivery',
  );
  return { ...submitted, drafts: await drafts(submitted.batchId) };
}

it('真实队列→两份AI草稿→当前人确认→五秒内撤销，建议和正式结论始终分开', async () => {
  const h = await setup({ twoEvents: true });
  const result = await delivered(h);
  expect(h.calls()).toBe(1);
  expect(result.drafts).toHaveLength(2);
  expect(
    await connection.db
      .select()
      .from(events)
      .where(eq(events.personId, h.target)),
  ).toHaveLength(0);
  const first = result.drafts[0]!.draft;
  const secondBefore = result.drafts[1]!;
  expect(first.origin).toBe('ai_suggestion');
  const originalRef = first.sourceReferences[0]!;
  const [fragment] = await connection.db
    .select()
    .from(fragments)
    .where(eq(fragments.id, originalRef.fragmentId));
  const [original] = await connection.db
    .select()
    .from(originalVersions)
    .where(eq(originalVersions.id, originalRef.originalVersionId));
  expect(fragment.excerpt).toBe(h.text);
  expect(original.contentDigest).toBe(
    createHash('sha256').update(h.text).digest('hex'),
  );
  const command = saveInput(first);
  const saved = await saveRecordDraft(
    connection.db,
    h.account,
    command,
    h.clock,
  );
  expect(saved.result.confirmationIds).toHaveLength(1);
  const [confirmation] = await connection.db
    .select()
    .from(confirmations)
    .where(eq(confirmations.id, saved.result.confirmationIds[0]!));
  expect(confirmation).toMatchObject({
    evaluatorId: h.evaluator,
    value: 3,
    active: true,
    ruleVersionId: 'rubric-v1',
  });
  const retainedAI = await connection.db
    .select()
    .from(aiSuggestions)
    .where(eq(aiSuggestions.eventId, saved.result.events[0]!.eventId));
  expect(retainedAI).toHaveLength(1);
  expect(
    await saveRecordDraft(connection.db, h.account, command, h.clock),
  ).toEqual({ ...saved, replayed: true });
  h.advanceWall(4999);
  const undoInput = { operation_id: randomUUID(), saveId: saved.result.saveId };
  const undone = await undoRecordSave(
    connection.db,
    h.account,
    undoInput,
    h.clock,
  );
  expect(undone.result.withdrawnConfirmationIds).toEqual(
    saved.result.confirmationIds,
  );
  const [afterConfirmation] = await connection.db
    .select()
    .from(confirmations)
    .where(eq(confirmations.id, confirmation.id));
  expect(afterConfirmation.active).toBe(false);
  const [afterEvent] = await connection.db
    .select()
    .from(events)
    .where(eq(events.id, saved.result.events[0]!.eventId));
  expect(afterEvent.withdrawnAt).not.toBeNull();
  expect(
    await connection.db
      .select()
      .from(aiSuggestions)
      .where(eq(aiSuggestions.eventId, afterEvent.id)),
  ).toEqual(retainedAI);
  expect(
    (await drafts(result.batchId)).find(
      (row) => row.draftId === secondBefore.draftId,
    ),
  ).toEqual(secondBefore);
  h.advanceWall(6000);
  expect(
    await undoRecordSave(connection.db, h.account, undoInput, h.clock),
  ).toEqual({ ...undone, replayed: true });
  expect(h.calls()).toBe(1);
}, 25_000);

it('持久队列在消费者重建后交付；重复投递不重跑模型或改变稳定草稿ID', async () => {
  const h = await setup();
  const result = await submit(h);
  expect(h.calls()).toBe(0);
  await h.boss.stop();
  bosses.splice(bosses.indexOf(h.boss), 1);
  const freshDb = createDatabase(connection.testUrl);
  extraConnections.push(freshDb);
  const boss = await newBoss();
  const restarted = h.construct(freshDb.db, boss);
  await restarted.register();
  await eventually(
    async () => (await job(result.jobId)).status === 'awaiting_manual',
    'durable restart delivery',
  );
  const before = await drafts(result.batchId);
  expect(before).toHaveLength(1);
  const duplicate = await boss.send(
    recordArrangeQueue,
    { jobId: result.jobId, attempt: 1 },
    { retryLimit: 0 },
  );
  expect(duplicate).toBeTruthy();
  await eventually(async () => {
    const rows = await connection.db.execute(
      sql`select state from pgboss.job where id=${duplicate}`,
    );
    return rows.rows[0]?.state === 'completed';
  }, 'duplicate actual delivery');
  expect(h.calls()).toBe(1);
  expect(await drafts(result.batchId)).toEqual(before);
  expect(
    await connection.db
      .select()
      .from(events)
      .where(eq(events.personId, h.target)),
  ).toHaveLength(0);
}, 25_000);

it.each(['binding', 'revoked', 'expired'] as const)(
  '队列执行前当前%s变化，旧操作不能使用旧许可外发',
  async (change) => {
    const h = await setup();
    const result = await submit(h);
    if (change === 'binding')
      await connection.db
        .update(accountBindings)
        .set({ personId: h.other })
        .where(eq(accountBindings.accountId, h.account));
    if (change === 'revoked')
      await connection.db
        .update(evaluationRelations)
        .set({ revokedAt: businessAt })
        .where(eq(evaluationRelations.id, h.relation));
    if (change === 'expired')
      await connection.db
        .update(evaluationRelations)
        .set({ validTo: businessAt })
        .where(eq(evaluationRelations.id, h.relation));
    await h.app.register();
    await eventually(
      async () => (await job(result.jobId)).status === 'failed',
      'current permission rejection',
    );
    expect(h.calls()).toBe(0);
    expect(await drafts(result.batchId)).toHaveLength(0);
    expect(await h.app.requests.create(h.account, h.input)).not.toHaveProperty(
      'status',
      'success',
    );
  },
  25_000,
);

it('跨节点目标不落原件/任务；实际模型返回伪造来源不能写草稿或正式事件', async () => {
  const h = await setup({ badCitation: true });
  expect(
    await h.app.requests.create(h.account, {
      ...h.input,
      evaluationNodeId: h.otherNode,
    }),
  ).not.toHaveProperty('status', 'success');
  expect(
    await connection.db
      .select()
      .from(arrangeInputs)
      .where(eq(arrangeInputs.creatorAccountId, h.account)),
  ).toHaveLength(0);
  const result = await submit(h);
  await h.app.register();
  await eventually(
    async () => (await job(result.jobId)).status === 'failed',
    'invalid citation rejection',
  );
  expect(h.calls()).toBe(1);
  expect(await drafts(result.batchId)).toHaveLength(0);
  expect(
    await connection.db
      .select()
      .from(events)
      .where(eq(events.personId, h.target)),
  ).toHaveLength(0);
}, 25_000);

it('真实队列缺失导致整组producer事务回滚，恢复队列后原操作只产生一份任务', async () => {
  const h = await setup();
  async function counts() {
    return (
      await connection.db.execute(sql`select
      (select count(*) from ${arrangeInputs})::int as inputs,
      (select count(*) from ${jobSnapshots})::int as jobs,
      (select count(*) from ${originals})::int as originals,
      (select count(*) from ${originalVersions})::int as versions,
      (select count(*) from ${fragments})::int as fragments`)
    ).rows[0];
  }
  const before = await counts();
  await h.boss.deleteQueue(recordArrangeQueue);
  try {
    await expect(h.app.requests.create(h.account, h.input)).rejects.toThrow();
    expect(await counts()).toEqual(before);
    expect(h.calls()).toBe(0);
  } finally {
    await h.boss.createQueue(recordArrangeQueue, { retryLimit: 0 });
  }
  const result = await delivered(h);
  expect(result.drafts).toHaveLength(1);
  expect(h.calls()).toBe(1);
  expect(await h.app.requests.create(h.account, h.input)).toMatchObject({
    status: 'success',
    replayed: true,
  });
  expect(
    (
      await connection.db.execute(
        sql`select count(*)::int as n from pgboss.job where data->>'jobId'=${result.jobId}`,
      )
    ).rows[0],
  ).toEqual({ n: 1 });
}, 25_000);

it('模型等待期间真实关系撤销，已返回的合成模型内容不得落草稿', async () => {
  let relation = '';
  const h = await setup({
    beforeResponse: async () => {
      await connection.db
        .update(evaluationRelations)
        .set({ revokedAt: businessAt })
        .where(eq(evaluationRelations.id, relation));
    },
  });
  relation = h.relation;
  const result = await submit(h);
  await h.app.register();
  await eventually(
    async () => (await job(result.jobId)).status === 'failed',
    'post-model revocation',
  );
  expect(h.calls()).toBe(1);
  expect(await drafts(result.batchId)).toHaveLength(0);
  expect(
    await connection.db
      .select()
      .from(events)
      .where(eq(events.personId, h.target)),
  ).toHaveLength(0);
}, 25_000);

it.each(['binding', 'revoked'] as const)(
  '已生成草稿后%s变化，当前确认和旧创建操作均不能越权',
  async (change) => {
    const h = await setup();
    const result = await delivered(h);
    if (change === 'binding')
      await connection.db
        .update(accountBindings)
        .set({ personId: h.other })
        .where(eq(accountBindings.accountId, h.account));
    else
      await connection.db
        .update(evaluationRelations)
        .set({ revokedAt: businessAt })
        .where(eq(evaluationRelations.id, h.relation));
    await expect(
      saveRecordDraft(
        connection.db,
        h.account,
        saveInput(result.drafts[0]!.draft),
        h.clock,
      ),
    ).rejects.toMatchObject({ status: 'forbidden' });
    expect(await h.app.requests.create(h.account, h.input)).not.toHaveProperty(
      'status',
      'success',
    );
    expect(
      await connection.db
        .select()
        .from(recordSaves)
        .where(eq(recordSaves.actorAccountId, h.account)),
    ).toHaveLength(0);
    expect(
      await connection.db
        .select()
        .from(events)
        .where(eq(events.personId, h.target)),
    ).toHaveLength(0);
    expect(h.calls()).toBe(1);
  },
  25_000,
);

it('排队期间当前规则已前进，确认仍保留保存时版本；恰五秒不撤销历史确认', async () => {
  const h = await setup();
  const submitted = await submit(h);
  h.advanceBusiness('2026-10-04T08:00:00.000Z');
  await h.app.register();
  await eventually(
    async () => (await job(submitted.jobId)).status === 'awaiting_manual',
    'frozen rule delivery',
  );
  const draft = (await drafts(submitted.batchId))[0]!.draft;
  expect(draft).toMatchObject({
    dimensionVersionId: 'rubric-v1',
    anchorVersionId: 'rubric-v1',
  });
  const saved = await saveRecordDraft(
    connection.db,
    h.account,
    saveInput(draft),
    h.clock,
  );
  h.advanceWall(5000);
  await expect(
    undoRecordSave(
      connection.db,
      h.account,
      { operation_id: randomUUID(), saveId: saved.result.saveId },
      h.clock,
    ),
  ).rejects.toMatchObject({ status: 'conflict' });
  const [confirmation] = await connection.db
    .select()
    .from(confirmations)
    .where(eq(confirmations.id, saved.result.confirmationIds[0]!));
  expect(confirmation).toMatchObject({
    active: true,
    ruleVersionId: 'rubric-v1',
  });
  const [savedEvent] = await connection.db
    .select()
    .from(events)
    .where(eq(events.id, saved.result.events[0]!.eventId));
  expect(savedEvent).toMatchObject({
    withdrawnAt: null,
    occurredOn: '2026-09-04',
    ruleVersionId: 'rubric-v1',
  });
  expect(h.calls()).toBe(1);
}, 25_000);

it('草稿引用后新增范围外共享主体，完整真实来源图阻止确认，不只检查AI目标', async () => {
  const h = await setup();
  const result = await delivered(h);
  const draft = result.drafts[0]!.draft;
  const sharedEvent = randomUUID();
  // Controlled durable shared source fact, not a replacement authorization callback.
  await connection.db.insert(events).values({
    id: sharedEvent,
    evaluationNodeId: h.otherNode,
    personId: h.other,
    recorderId: h.other,
    projectId: null,
    occurredOn: '2026-09-04',
    title: '演示共享来源',
    situation: '',
    behavior: '演示范围外主体的同源记录',
    impact: '',
    ruleVersionId: 'rubric-v1',
    demo: true,
  });
  await connection.db.insert(eventSources).values({
    eventId: sharedEvent,
    fragmentId: draft.sourceReferences[0]!.fragmentId,
    originalVersionId: draft.sourceReferences[0]!.originalVersionId,
  });
  await expect(
    saveRecordDraft(connection.db, h.account, saveInput(draft), h.clock),
  ).rejects.toMatchObject({ status: 'forbidden' });
  expect(
    await connection.db
      .select()
      .from(recordSaves)
      .where(eq(recordSaves.actorAccountId, h.account)),
  ).toHaveLength(0);
  expect(
    await connection.db
      .select()
      .from(events)
      .where(eq(events.personId, h.target)),
  ).toHaveLength(0);
  expect(h.calls()).toBe(1);
}, 25_000);

it.each(['binding', 'revoked'] as const)(
  '已确认后%s变化，历史保存重放与撤销都重核当前许可且不改历史',
  async (change) => {
    const h = await setup();
    const result = await delivered(h);
    const command = saveInput(result.drafts[0]!.draft);
    const saved = await saveRecordDraft(
      connection.db,
      h.account,
      command,
      h.clock,
    );
    const before = await connection.db
      .select()
      .from(recordSaves)
      .where(eq(recordSaves.saveId, saved.result.saveId));
    const beforeConfirmations = await connection.db
      .select()
      .from(confirmations)
      .where(eq(confirmations.eventId, saved.result.events[0]!.eventId));
    if (change === 'binding')
      await connection.db
        .update(accountBindings)
        .set({ personId: h.other })
        .where(eq(accountBindings.accountId, h.account));
    else
      await connection.db
        .update(evaluationRelations)
        .set({ revokedAt: businessAt })
        .where(eq(evaluationRelations.id, h.relation));
    await expect(
      saveRecordDraft(connection.db, h.account, command, h.clock),
    ).rejects.toMatchObject({ status: 'forbidden' });
    await expect(
      undoRecordSave(
        connection.db,
        h.account,
        { operation_id: randomUUID(), saveId: saved.result.saveId },
        h.clock,
      ),
    ).rejects.toMatchObject({ status: 'forbidden' });
    expect(
      await connection.db
        .select()
        .from(recordSaves)
        .where(eq(recordSaves.saveId, saved.result.saveId)),
    ).toEqual(before);
    expect(
      await connection.db
        .select()
        .from(confirmations)
        .where(eq(confirmations.eventId, saved.result.events[0]!.eventId)),
    ).toEqual(beforeConfirmations);
    const read = await h.app.requests.readBatch(h.account, {
      batchId: result.batchId,
    });
    expect(read.status).not.toBe('success');
    expect(JSON.stringify(read)).not.toContain(h.text.trim());
    expect(h.calls()).toBe(1);
  },
  25_000,
);

it('真实worker末次写入发生唯一键冲突时整组草稿回滚，失败重投不盲重发模型', async () => {
  let collision: string | null = null;
  let replies = 0;
  let retainedDraft = '';
  const h = await setup({
    newId: () => collision ?? randomUUID(),
    beforeResponse: async () => {
      if (++replies === 2) collision = retainedDraft;
    },
  });
  const first = await delivered(h);
  retainedDraft = first.drafts[0]!.draftId;
  // A second real intake reaches the same actual consumer; only its final ID
  // allocator is fault-controlled to trigger the database's real unique index.
  h.input.operationId = randomUUID();
  const second = await submit(h);
  await eventually(
    async () => (await job(second.jobId)).status === 'failed',
    'actual persistence unique conflict',
  );
  expect(h.calls()).toBe(2);
  expect(await drafts(second.batchId)).toHaveLength(0);
  expect(await drafts(first.batchId)).toEqual(first.drafts);
  expect((await job(first.jobId)).status).toBe('awaiting_manual');
  collision = null;
  const duplicate = await h.boss.send(
    recordArrangeQueue,
    { jobId: second.jobId, attempt: 1 },
    { retryLimit: 0 },
  );
  expect(duplicate).toBeTruthy();
  await eventually(
    async () =>
      (
        await connection.db.execute(
          sql`select state from pgboss.job where id=${duplicate}`,
        )
      ).rows[0]?.state === 'completed',
    'failed job redelivery',
  );
  expect(h.calls()).toBe(2);
  expect(await drafts(second.batchId)).toHaveLength(0);
  expect(await drafts(first.batchId)).toEqual(first.drafts);
}, 25_000);
