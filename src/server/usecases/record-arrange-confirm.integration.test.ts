import { randomUUID } from 'node:crypto';
import { PgBoss } from 'pg-boss';
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
import { saveRecordDraft } from './record-save';
import {
  arrangeInputs,
  recordDrafts,
  events,
  recordSaves,
} from '../modules/records';
import { evaluationRelations } from '../modules/programs';
import { recordArrangeQueue } from '../jobs/record-arrange';
import type { RecordSaveInput } from '../../contracts/record';
let connection: Awaited<ReturnType<typeof nativeDatabase>>;
let boss: PgBoss;
beforeAll(async () => {
  connection = await nativeDatabase();
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
async function arranged() {
  const facts = await seedNativeCase(connection.db);
  const model = syntheticBatchClient();
  const app = createRecordArrangeApplication({
    db: connection.db,
    boss,
    client: model.client,
    businessNow: () => businessAt,
    now: () => new Date(wallAt),
  });
  const created = await app.requests.create(facts.account, facts.input);
  if (created.status !== 'success') throw new Error('Synthetic intake failed');
  const [intake] = await connection.db
    .select()
    .from(arrangeInputs)
    .where(eq(arrangeInputs.batchId, created.result.batchId));
  expect(await app.runner.run(intake!.jobId, 1)).toBe('awaiting_manual');
  const [stored] = await connection.db
    .select()
    .from(recordDrafts)
    .where(eq(recordDrafts.batchId, created.result.batchId));
  const draft = stored!.draft;
  const input: RecordSaveInput = {
    operation_id: randomUUID(),
    expected_revision: draft.revision,
    draftId: draft.draftId,
    personIds: draft.personIds,
    projectId: draft.projectId,
    sbi: draft.sbi,
    decisions: draft.scores.map((score) => ({
      personId: score.personId,
      dimensionId: score.dimensionId,
      action: 'unknown' as const,
      reason: '资料不足（演示）',
    })),
  };
  expect(
    await connection.db
      .select()
      .from(events)
      .where(eq(events.personId, facts.target)),
  ).toHaveLength(0);
  return {
    ...facts,
    app,
    model,
    draft,
    input,
    intake: intake!,
    clock: { businessNow: () => businessAt, wallNow: () => wallAt },
  };
}
it('confirms an actual newly arranged text without a synthetic pre-existing event', async () => {
  const h = await arranged();
  const saved = await saveRecordDraft(
    connection.db,
    h.account,
    h.input,
    h.clock,
  );
  expect(saved.result.events).toHaveLength(1);
  const [event] = await connection.db
    .select()
    .from(events)
    .where(eq(events.id, saved.result.events[0]!.eventId));
  expect(event).toMatchObject({
    personId: h.target,
    evaluationNodeId: h.node,
    withdrawnAt: null,
  });
  const [ledger] = await connection.db
    .select()
    .from(recordSaves)
    .where(eq(recordSaves.saveId, saved.result.saveId));
  expect(ledger!.draftSnapshot.anchorVersionId).toBe('rubric-v1');
  expect(
    (await saveRecordDraft(connection.db, h.account, h.input, h.clock))
      .replayed,
  ).toBe(true);
  expect(h.model.calls()).toBe(1);
  const receipt = await h.app.requests.readBatch(h.account, {
    batchId: h.draft.batchId,
  });
  expect(receipt.status).toBe('success');
  if (receipt.status !== 'success')
    throw new Error('Confirmed batch unavailable');
  expect(receipt.result).toMatchObject({
    status: 'completed',
    counts: { events: { total: 1, confirmed: 1, awaiting_confirmation: 0 } },
  });
});
it('reads intake subjects beyond AI attribution and rejects an inaccessible original subject', async () => {
  const h = await arranged();
  const contexts = structuredClone(h.intake.sourceContexts);
  contexts[0]!.subjects.push({
    personId: h.other,
    evaluationNodeId: h.otherNode,
    cohortId: h.cohort,
  });
  await connection.db
    .update(arrangeInputs)
    .set({ sourceContexts: contexts })
    .where(eq(arrangeInputs.id, h.intake.id));
  await expect(
    saveRecordDraft(connection.db, h.account, h.input, h.clock),
  ).rejects.toMatchObject({
    status: 'forbidden',
    reason: 'source_not_visible',
  });
  expect(
    await connection.db
      .select()
      .from(events)
      .where(eq(events.personId, h.target)),
  ).toHaveLength(0);
});
it('checks current node authority again on idempotent replay', async () => {
  const h = await arranged();
  await saveRecordDraft(connection.db, h.account, h.input, h.clock);
  await connection.db
    .update(evaluationRelations)
    .set({ validTo: businessAt })
    .where(eq(evaluationRelations.id, h.relation));
  await expect(
    saveRecordDraft(connection.db, h.account, h.input, h.clock),
  ).rejects.toMatchObject({ status: 'forbidden' });
});

it('preserves intake content restrictions before there is any event', async () => {
  const h = await arranged();
  const contexts = structuredClone(h.intake.sourceContexts);
  contexts[0]!.requiredKinds = ['management-observation'];
  await connection.db
    .update(arrangeInputs)
    .set({ sourceContexts: contexts })
    .where(eq(arrangeInputs.id, h.intake.id));
  await expect(
    saveRecordDraft(connection.db, h.account, h.input, h.clock),
  ).rejects.toMatchObject({
    status: 'forbidden',
    reason: 'source_not_visible',
  });
});
it('a valid formal event cannot hide incomplete intake provenance on replay', async () => {
  const h = await arranged();
  await saveRecordDraft(connection.db, h.account, h.input, h.clock);
  const contexts = structuredClone(h.intake.sourceContexts);
  contexts[0]!.subjects = [];
  await connection.db
    .update(arrangeInputs)
    .set({ sourceContexts: contexts })
    .where(eq(arrangeInputs.id, h.intake.id));
  await expect(
    saveRecordDraft(connection.db, h.account, h.input, h.clock),
  ).rejects.toMatchObject({
    status: 'unavailable',
    reason: 'complete_sources_required',
  });
});
it('rejects changed original bytes even if the AI draft and its quote remain', async () => {
  const h = await arranged();
  await connection.db
    .update(arrangeInputs)
    .set({
      originalInput: { ...h.intake.originalInput, text: '另一份原文（演示）' },
    })
    .where(eq(arrangeInputs.id, h.intake.id));
  await expect(
    saveRecordDraft(connection.db, h.account, h.input, h.clock),
  ).rejects.toMatchObject({ status: 'unavailable' });
});
it('reloads committed intake subjects after waiting for concurrent intake DML', async () => {
  const h = await arranged();
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>((resolve) => (entered = resolve)),
    held = new Promise<void>((resolve) => (release = resolve));
  const writing = connection.db.transaction(async (tx) => {
    const contexts = structuredClone(h.intake.sourceContexts);
    contexts[0]!.subjects.push({
      personId: h.other,
      evaluationNodeId: h.otherNode,
      cohortId: h.cohort,
    });
    await tx
      .update(arrangeInputs)
      .set({ sourceContexts: contexts })
      .where(eq(arrangeInputs.id, h.intake.id));
    entered();
    await held;
  });
  await ready;
  const saving = saveRecordDraft(
    connection.db,
    h.account,
    h.input,
    h.clock,
  ).then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  try {
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      const rows = await connection.db.execute(
        sql`select exists(select 1 from pg_locks where relation='records_arrange_inputs'::regclass and mode='ShareLock' and not granted) as waiting`,
      );
      if (rows.rows[0]?.waiting) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
  } finally {
    release();
    await writing;
  }
  expect(await saving).toMatchObject({
    error: { status: 'forbidden', reason: 'source_not_visible' },
  });
  expect(
    await connection.db
      .select()
      .from(events)
      .where(eq(events.personId, h.target)),
  ).toHaveLength(0);
});
it('does not accept a changed retained AI body as merely a confirmation revision', async () => {
  const h = await arranged();
  const saved = await saveRecordDraft(
    connection.db,
    h.account,
    h.input,
    h.clock,
  );
  const [row] = await connection.db
    .select()
    .from(recordDrafts)
    .where(eq(recordDrafts.draftId, h.draft.draftId));
  await connection.db
    .update(recordDrafts)
    .set({
      draft: {
        ...row!.draft,
        sbi: { ...row!.draft.sbi, title: '篡改草稿（演示）' },
      },
    })
    .where(eq(recordDrafts.draftId, h.draft.draftId));
  await expect(
    h.app.requests.readBatch(h.account, { batchId: h.draft.batchId }),
  ).rejects.toThrow('confirmation_snapshot_changed');
  const [retained] = await connection.db
    .select()
    .from(recordSaves)
    .where(eq(recordSaves.saveId, saved.result.saveId));
  expect(retained!.draftSnapshot.sbi.title).toBe(h.draft.sbi.title);
});
