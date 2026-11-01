import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from 'vitest';
import { createDatabase, getDatabase } from '../db/client';
import { requireSession } from '../auth/next';
import { accountBindings, people } from '../modules/directory';
import {
  evaluationRelations,
  evaluationWorkItems,
  insertEvaluationWorkItem,
} from '../modules/programs';
import {
  events,
  eventParticipants,
  fragments,
  eventSources,
  recordDraftBatches,
  recordDrafts,
  recordDraftEvents,
  recordSaves,
  recordOperations,
} from '../modules/records';
import { aiSuggestions, confirmations, scoreReviews } from '../modules/talent';
import { readEffectiveRuleVersion } from '../modules/evaluation-system';
import * as audit from '../platform/audit';
import {
  recordSaveInputSchema,
  recordSaveResultSchema,
  recordUndoResultSchema,
} from '../../contracts/record';
import { saveRecordAction, undoRecordAction } from '../actions/record';
import { saveRecordDraft, undoRecordSave } from './record-save';
import {
  businessNow,
  seedRecordRules,
  seedRecordCase,
} from '../../../tests/fixtures/bow-846/native';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../auth/next', () => ({ requireSession: vi.fn() }));
vi.mock('../db/client', async (original) => ({
  ...(await original<typeof import('../db/client')>()),
  getDatabase: vi.fn(),
}));
vi.mock('../env', () => ({ getEnv: () => ({ APP_ENV: 'test' }) }));
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
const databaseName =
  'qtalent_record_native_' + randomUUID().replaceAll('-', '') + '_test';
const db = () => connection!.db;
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source) throw new Error('Real PostgreSQL requires TEST_DATABASE_URL');
  const url = new URL(source);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Dedicated local test database required');
  admin = new Pool({ connectionString: source });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  url.pathname = '/' + databaseName;
  connection = createDatabase(url.toString());
  await migrate(db(), { migrationsFolder: 'src/server/db/migrations' });
  const tables = await db().execute<{ ready: boolean }>(
    sql`select to_regclass('records_saves') is not null as ready`,
  );
  if (!tables.rows[0].ready)
    throw new Error('BOW-846 formal migration is not published');
  await seedRecordRules(db());
}, 30_000);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDatabase).mockImplementation(db);
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await connection?.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await admin.end();
  }
});
async function native(options: Parameters<typeof seedRecordCase>[1] = {}) {
  return seedRecordCase(db(), options);
}
function edited(
  f: Awaited<ReturnType<typeof native>>,
  value: number,
  reason = '',
) {
  return recordSaveInputSchema.parse({
    ...f.input,
    decisions: [{ ...f.input.decisions[0], action: 'edit', value, reason }],
  });
}
async function snapshot() {
  const result = await db().execute(sql`select
    (select count(*) from ${recordSaves})::int as saves,
    (select count(*) from ${recordOperations})::int as operations,
    (select count(*) from ${events})::int as events,
    (select count(*) from ${eventSources})::int as sources,
    (select count(*) from ${recordDraftEvents})::int as mappings,
    (select count(*) from ${confirmations})::int as confirmations,
    (select count(*) from ${aiSuggestions})::int as suggestions,
    (select count(*) from ${scoreReviews})::int as reviews,
    (select count(*) from audit_events)::int as audits`);
  return result.rows[0];
}
async function rowsForSave(saveId: string) {
  const [saved] = await db()
    .select()
    .from(recordSaves)
    .where(eq(recordSaves.saveId, saveId));
  const human = await db()
    .select()
    .from(confirmations)
    .where(inArray(confirmations.id, saved.receipt.confirmationIds));
  return { saved, human };
}

it('uses the actual session action, database, transaction and independent wall clock', async () => {
  const f = await native();
  vi.mocked(requireSession).mockResolvedValue({
    user: { id: f.account.one },
  } as Awaited<ReturnType<typeof requireSession>>);
  const before = Date.now();
  const result = await saveRecordAction(f.input);
  expect(recordSaveResultSchema.safeParse(result).success).toBe(true);
  if (result.status !== 'success')
    throw new Error('Expected native action save');
  expect(Date.parse(result.result.savedAt)).toBeGreaterThanOrEqual(before);
  expect(
    Date.parse(result.result.undoUntil) - Date.parse(result.result.savedAt),
  ).toBe(5000);
  const undo = await undoRecordAction({
    operation_id: f.id + '-action-undo',
    saveId: result.result.saveId,
  });
  expect(recordUndoResultSchema.safeParse(undo).success).toBe(true);
  expect(undo).toHaveProperty('status', 'success');
});
it('persists native event, source mappings, immutable AI and human confirmation without a profile snapshot', async () => {
  const f = await native();
  const result = await saveRecordDraft(db(), f.account.one, f.input, f.clock);
  const { saved, human } = await rowsForSave(result.result.saveId);
  expect(saved.actorPersonId).toBe(f.person['rater-one']);
  expect(saved.draftSnapshot.anchorVersionId).toBe('rubric-v1');
  expect(saved.receipt).toEqual(result.result);
  expect(human).toHaveLength(1);
  expect(human[0]).toMatchObject({
    evaluatorId: f.person['rater-one'],
    modifiedBy: f.person['rater-one'],
    value: 3,
    revision: 1,
    previousId: null,
    active: true,
    sourceCategory: 'original',
    ruleVersionId: 'rubric-v1',
  });
  const [event] = await db()
    .select()
    .from(events)
    .where(eq(events.id, result.result.events[0].eventId));
  expect(event).toMatchObject({
    evaluationNodeId: f.node,
    personId: f.person.one,
    situation: '',
    behavior: f.input.sbi.behavior,
    withdrawnAt: null,
  });
  const originals = await db()
    .select()
    .from(aiSuggestions)
    .where(eq(aiSuggestions.eventId, event.id));
  expect(originals[0]).toMatchObject({
    modelVersion: 'synthetic-model-846',
    value: 3,
    status: 'scored',
  });
  expect(
    await db()
      .select()
      .from(eventSources)
      .where(eq(eventSources.eventId, event.id)),
  ).toEqual([
    {
      eventId: event.id,
      fragmentId: f.fragmentId,
      originalVersionId: f.versionId,
    },
  ]);
});
it('retains the draft rule version after the next version becomes effective', async () => {
  const f = await native();
  expect(
    await readEffectiveRuleVersion(db(), {
      category: 'dimension_anchors',
      at: businessNow,
    }),
  ).toMatchObject({ status: 'success', version: { versionId: 'rubric-v2' } });
  const result = await saveRecordDraft(
    db(),
    f.account.one,
    edited(f, 5, '演示人工说明'),
    f.clock,
  );
  const { human } = await rowsForSave(result.result.saveId);
  expect(human[0]).toMatchObject({
    ruleVersionId: 'rubric-v1',
    anchorId: 'native-v1-5',
    value: 5,
  });
});
it('serializes identical operations and replays the exact durable receipt', async () => {
  const f = await native();
  const before = await snapshot();
  const results = await Promise.all([
    saveRecordDraft(db(), f.account.one, f.input, f.clock),
    saveRecordDraft(db(), f.account.one, f.input, f.clock),
  ]);
  expect(results.map((row) => row.replayed).sort()).toEqual([false, true]);
  expect(results[0].result).toEqual(results[1].result);
  const after = await snapshot();
  expect(Number(after.audits) - Number(before.audits)).toBe(1);
  expect(Number(after.confirmations) - Number(before.confirmations)).toBe(1);
  expect(Number(after.saves) - Number(before.saves)).toBe(1);
});
it('rejects same operation with a different semantic payload, including concurrent requests', async () => {
  const f = await native();
  const settled = await Promise.allSettled([
    saveRecordDraft(db(), f.account.one, edited(f, 1), f.clock),
    saveRecordDraft(db(), f.account.one, edited(f, 5), f.clock),
  ]);
  expect(settled.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
  expect(settled.find((row) => row.status === 'rejected')).toMatchObject({
    reason: { status: 'conflict' },
  });
});
it('fences old draft revisions and different operation IDs at the business uniqueness key', async () => {
  const f = await native();
  const saved = await saveRecordDraft(db(), f.account.one, f.input, f.clock);
  const before = await snapshot();
  await expect(
    saveRecordDraft(
      db(),
      f.account.one,
      { ...f.input, operation_id: f.id + '-stale' },
      f.clock,
    ),
  ).rejects.toMatchObject({
    status: 'conflict',
    reason: 'draft_revision_changed',
  });
  await expect(
    saveRecordDraft(
      db(),
      f.account.one,
      {
        ...f.input,
        operation_id: f.id + '-duplicate',
        expected_revision: saved.result.revision,
      },
      f.clock,
    ),
  ).rejects.toMatchObject({
    status: 'conflict',
    reason: 'confirmation_already_exists',
  });
  expect(await snapshot()).toEqual(before);
});
it.each([
  [1, '', 0],
  [2, '', 1],
  [3, '', 1],
  [2, '  ', 1],
  [2, '演示理由', 0],
  [3, '演示理由', 0],
] as const)(
  'applies the AI difference boundary %s with reason %j',
  async (difference, reason, expected) => {
    const f = await native();
    // Baseline AI 3; difference 3 uses a trusted AI 4 snapshot/anchor.
    if (difference === 3) {
      const draft = structuredClone(f.draft);
      const score = draft.scores[0];
      if (score.state !== 'suggested')
        throw new Error('Expected synthetic AI score');
      score.value = 4;
      score.anchor = {
        id: 'native-v1-4',
        text: '演示旧版锚点 4',
        ruleVersion: 'rubric-v1',
      };
      await db()
        .update(recordDrafts)
        .set({ draft })
        .where(eq(recordDrafts.draftId, draft.draftId));
    }
    const result = await saveRecordDraft(
      db(),
      f.account.one,
      edited(f, difference === 1 ? 2 : 1, reason),
      f.clock,
    );
    expect(result.result.reviewItemIds).toHaveLength(expected);
  },
);
it('keeps unknown scores null and does not manufacture either gap review', async () => {
  const f = await native({ unknown: true });
  const result = await saveRecordDraft(db(), f.account.one, f.input, f.clock);
  const { human } = await rowsForSave(result.result.saveId);
  expect(human[0]).toMatchObject({
    status: 'unknown',
    value: null,
    anchorId: null,
  });
  expect(result.result.reviewItemIds).toEqual([]);
});
it('records the second evaluator, creates a version-linked gap, and undo preserves the first event', async () => {
  const f = await native();
  const first = await saveRecordDraft(db(), f.account.one, f.input, f.clock);
  const second = await saveRecordDraft(
    db(),
    f.account.two,
    {
      ...edited(f, 1, '演示不同判断'),
      operation_id: f.id + '-second',
      expected_revision: first.result.revision,
    },
    f.clock,
  );
  expect(second.result.events).toEqual(first.result.events);
  expect(second.result.reviewItemIds).toHaveLength(1);
  const [review] = await db()
    .select()
    .from(scoreReviews)
    .where(eq(scoreReviews.id, second.result.reviewItemIds[0]));
  expect(
    new Set([review.confirmationId, review.counterpartConfirmationId]),
  ).toEqual(
    new Set([
      first.result.confirmationIds[0],
      second.result.confirmationIds[0],
    ]),
  );
  await expect(
    undoRecordSave(
      db(),
      f.account.one,
      { operation_id: f.id + '-first-undo', saveId: first.result.saveId },
      f.clock,
    ),
  ).rejects.toMatchObject({ status: 'conflict' });
  const undo = await undoRecordSave(
    db(),
    f.account.two,
    { operation_id: f.id + '-second-undo', saveId: second.result.saveId },
    f.clock,
  );
  expect(undo.result.withdrawnEvents).toEqual([]);
  const firstRows = await rowsForSave(first.result.saveId);
  expect(firstRows.human[0].active).toBe(true);
  const [event] = await db()
    .select()
    .from(events)
    .where(eq(events.id, first.result.events[0].eventId));
  expect(event.withdrawnAt).toBeNull();
  expect(
    (
      await db()
        .select()
        .from(scoreReviews)
        .where(eq(scoreReviews.id, review.id))
    )[0].withdrawnAt,
  ).not.toBeNull();
});
it('reconfirms after the second evaluator undoes, preserving every inactive revision and stale undo replay', async () => {
  const f = await native();
  const first = await saveRecordDraft(db(), f.account.one, f.input, f.clock);
  let saved = await saveRecordDraft(
    db(),
    f.account.two,
    {
      ...f.input,
      operation_id: f.id + '-second',
      expected_revision: first.result.revision,
    },
    f.clock,
  );
  for (const revision of [2, 3]) {
    const previousId = saved.result.confirmationIds[0];
    const undoInput = {
      operation_id: f.id + '-undo-' + revision,
      saveId: saved.result.saveId,
    };
    const undone = await undoRecordSave(
      db(),
      f.account.two,
      undoInput,
      f.clock,
    );
    const [draft] = await db()
      .select()
      .from(recordDrafts)
      .where(eq(recordDrafts.draftId, f.draft.draftId));
    saved = await saveRecordDraft(
      db(),
      f.account.two,
      {
        ...f.input,
        operation_id: f.id + '-reconfirm-' + revision,
        expected_revision: draft.revision,
      },
      f.clock,
    );
    const { human } = await rowsForSave(saved.result.saveId);
    expect(human[0]).toMatchObject({
      revision,
      previousId,
      previousRevision: revision - 1,
      evaluatorId: f.person['rater-two'],
      active: true,
      value: 3,
    });
    const [previous] = await db()
      .select()
      .from(confirmations)
      .where(eq(confirmations.id, previousId));
    expect(previous).toMatchObject({
      active: false,
      revision: revision - 1,
      value: 3,
    });
    expect(
      await undoRecordSave(db(), f.account.two, undoInput, f.clock),
    ).toEqual({ ...undone, replayed: true });
    expect((await rowsForSave(saved.result.saveId)).human[0].active).toBe(true);
  }
  const human = await db()
    .select()
    .from(confirmations)
    .where(eq(confirmations.eventId, first.result.events[0].eventId));
  expect(
    human.filter((row) => row.evaluatorId === f.person['rater-two']),
  ).toHaveLength(3);
  expect(human.filter((row) => row.active)).toHaveLength(2);
  expect((await rowsForSave(first.result.saveId)).human[0].active).toBe(true);
});
it('keeps an unexplained AI gap on reconfirmation and accepts only one concurrent new revision', async () => {
  const f = await native();
  const first = await saveRecordDraft(db(), f.account.one, f.input, f.clock);
  const second = await saveRecordDraft(
    db(),
    f.account.two,
    {
      ...f.input,
      operation_id: f.id + '-second',
      expected_revision: first.result.revision,
    },
    f.clock,
  );
  await undoRecordSave(
    db(),
    f.account.two,
    { operation_id: f.id + '-second-undo', saveId: second.result.saveId },
    f.clock,
  );
  const [draft] = await db()
    .select()
    .from(recordDrafts)
    .where(eq(recordDrafts.draftId, f.draft.draftId));
  const command = { ...edited(f, 1), expected_revision: draft.revision };
  const results = await Promise.allSettled(
    ['a', 'b'].map((suffix) =>
      saveRecordDraft(
        db(),
        f.account.two,
        { ...command, operation_id: f.id + '-again-' + suffix },
        f.clock,
      ),
    ),
  );
  const successful = results.filter((result) => result.status === 'fulfilled');
  expect(successful).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(
    1,
  );
  const result = successful[0];
  if (result.status !== 'fulfilled')
    throw new Error('Expected one accepted reconfirmation');
  const { human, saved } = await rowsForSave(result.value.result.saveId);
  expect(human[0]).toMatchObject({
    revision: 2,
    previousId: second.result.confirmationIds[0],
    value: 1,
  });
  expect(saved.input.decisions[0]).toMatchObject({
    action: 'edit',
    reason: '',
  });
  const reviews = await db()
    .select()
    .from(scoreReviews)
    .where(eq(scoreReviews.saveId, saved.saveId));
  expect(reviews.map((row) => row.reason).sort()).toEqual([
    'ai_changed_without_reason',
    'score_gap',
  ]);
});
it('restores the second evaluator own completed task to pending before reconfirmation', async () => {
  const f = await native();
  const first = await saveRecordDraft(db(), f.account.one, f.input, f.clock);
  const task = await db().transaction((tx) =>
    insertEvaluationWorkItem(
      tx,
      {
        id: f.id + '-second-task',
        evaluationNodeId: f.node,
        personId: f.person.one,
        assignedRelationId: f.relationTwo,
        assignedEvaluatorId: f.person['rater-two'],
        kind: 'confirmation',
        resourceId: f.draft.draftId,
      },
      businessNow,
    ),
  );
  const second = await saveRecordDraft(
    db(),
    f.account.two,
    {
      ...f.input,
      operation_id: f.id + '-second',
      expected_revision: first.result.revision,
    },
    f.clock,
  );
  await undoRecordSave(
    db(),
    f.account.two,
    { operation_id: f.id + '-second-undo', saveId: second.result.saveId },
    f.clock,
  );
  const [restored] = await db()
    .select()
    .from(evaluationWorkItems)
    .where(eq(evaluationWorkItems.id, task.id));
  expect(restored).toMatchObject({
    state: 'pending',
    revision: task.revision + 2,
    assignedRelationId: f.relationTwo,
    assignedEvaluatorId: f.person['rater-two'],
  });
  const [draft] = await db()
    .select()
    .from(recordDrafts)
    .where(eq(recordDrafts.draftId, f.draft.draftId));
  const again = await saveRecordDraft(
    db(),
    f.account.two,
    {
      ...f.input,
      operation_id: f.id + '-second-again',
      expected_revision: draft.revision,
    },
    f.clock,
  );
  expect((await rowsForSave(again.result.saveId)).human[0].revision).toBe(2);
  const [completed] = await db()
    .select()
    .from(evaluationWorkItems)
    .where(eq(evaluationWorkItems.id, task.id));
  expect(completed).toMatchObject({
    state: 'completed',
    revision: task.revision + 3,
  });
});
it('lets a current evaluator confirm before another evaluator assigned task without consuming it', async () => {
  const f = await native();
  const task = await db().transaction((tx) =>
    insertEvaluationWorkItem(
      tx,
      {
        id: f.id + '-other-task',
        evaluationNodeId: f.node,
        personId: f.person.one,
        assignedRelationId: f.relationOne,
        assignedEvaluatorId: f.person['rater-one'],
        kind: 'confirmation',
        resourceId: f.draft.draftId,
      },
      businessNow,
    ),
  );
  const saved = await saveRecordDraft(
    db(),
    f.account.two,
    { ...f.input, operation_id: f.id + '-second-first' },
    f.clock,
  );
  expect(
    (await rowsForSave(saved.result.saveId)).saved.confirmationWork,
  ).toEqual([]);
  const [untouched] = await db()
    .select()
    .from(evaluationWorkItems)
    .where(eq(evaluationWorkItems.id, task.id));
  expect(untouched).toEqual(task);
  const owner = await saveRecordDraft(
    db(),
    f.account.one,
    { ...f.input, expected_revision: saved.result.revision },
    f.clock,
  );
  expect(
    (await rowsForSave(owner.result.saveId)).saved.confirmationWork,
  ).toMatchObject([{ id: task.id }]);
});
it.each([4999, 5000, 5001])(
  'uses the exact wall-clock undo boundary at %s ms',
  async (elapsed) => {
    const f = await native();
    const saved = await saveRecordDraft(db(), f.account.one, f.input, f.clock);
    f.setWall(elapsed);
    const pending = undoRecordSave(
      db(),
      f.account.one,
      { operation_id: f.id + '-undo', saveId: saved.result.saveId },
      f.clock,
    );
    if (elapsed < 5000) {
      const result = await pending;
      expect(result.result.originalInput.text).toBe(f.originalInput.text);
      expect(result.result.withdrawnEvents).toEqual(saved.result.events);
      expect(
        (
          await db()
            .select()
            .from(fragments)
            .where(eq(fragments.id, f.fragmentId))
        )[0].excerpt,
      ).toBe(f.draft.sbi.behavior);
    } else
      await expect(pending).rejects.toMatchObject({
        status: 'conflict',
        reason: 'undo_window_closed',
      });
  },
);
it('replays accepted save/undo after later eligibility changes but still checks current authority', async () => {
  const f = await native();
  const input = edited(f, 1);
  const saved = await saveRecordDraft(db(), f.account.one, input, f.clock);
  await db()
    .update(scoreReviews)
    .set({ status: 'resolved' })
    .where(eq(scoreReviews.saveId, saved.result.saveId));
  expect(
    (await saveRecordDraft(db(), f.account.one, input, f.clock)).replayed,
  ).toBe(true);
  await expect(
    undoRecordSave(
      db(),
      f.account.one,
      { operation_id: f.id + '-undo', saveId: saved.result.saveId },
      f.clock,
    ),
  ).rejects.toMatchObject({ status: 'conflict' });
  await db()
    .update(evaluationRelations)
    .set({ revokedAt: businessNow })
    .where(eq(evaluationRelations.id, f.relationOne));
  await expect(
    saveRecordDraft(db(), f.account.one, input, f.clock),
  ).rejects.toMatchObject({ status: 'forbidden' });
});
it('serializes second-rater confirmation against withdrawal of the first-created event', async () => {
  const f = await native();
  const first = await saveRecordDraft(db(), f.account.one, f.input, f.clock);
  const settled = await Promise.allSettled([
    saveRecordDraft(
      db(),
      f.account.two,
      {
        ...edited(f, 1),
        operation_id: f.id + '-second',
        expected_revision: first.result.revision,
      },
      f.clock,
    ),
    undoRecordSave(
      db(),
      f.account.one,
      { operation_id: f.id + '-undo', saveId: first.result.saveId },
      f.clock,
    ),
  ]);
  expect(settled.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
  const rows = await db()
    .select()
    .from(confirmations)
    .where(eq(confirmations.eventId, first.result.events[0].eventId));
  const [event] = await db()
    .select()
    .from(events)
    .where(eq(events.id, first.result.events[0].eventId));
  expect(rows.filter((row) => row.active)).toHaveLength(
    event.withdrawnAt === null ? 2 : 0,
  );
});
it('rejects takeover after the same account is rebound to another authorized evaluator', async () => {
  const f = await native();
  const saved = await saveRecordDraft(db(), f.account.one, f.input, f.clock);
  await db()
    .update(accountBindings)
    .set({ personId: f.person['rater-two'] })
    .where(eq(accountBindings.accountId, f.account.one));
  await expect(
    saveRecordDraft(db(), f.account.one, f.input, f.clock),
  ).rejects.toMatchObject({
    status: 'forbidden',
    reason: 'original_save_binding_required',
  });
  await expect(
    undoRecordSave(
      db(),
      f.account.one,
      { operation_id: f.id + '-takeover', saveId: saved.result.saveId },
      f.clock,
    ),
  ).rejects.toMatchObject({ status: 'forbidden' });
});
it.each(['outsider', 'admin'] as const)(
  'denies a %s even when the supplied draft and sources exist',
  async (kind) => {
    const f = await native();
    const before = await snapshot();
    await expect(
      saveRecordDraft(db(), f.account[kind], f.input, f.clock),
    ).rejects.toMatchObject({ status: 'forbidden' });
    expect(await snapshot()).toEqual(before);
  },
);
it('enforces a real project read check and refuses a client null substitution', async () => {
  const f = await native({ project: true });
  await expect(
    saveRecordDraft(db(), f.account.one, f.input, f.clock),
  ).rejects.toMatchObject({
    status: 'forbidden',
    reason: 'project_not_visible',
  });
  await expect(
    saveRecordDraft(
      db(),
      f.account.one,
      { ...f.input, projectId: null },
      f.clock,
    ),
  ).rejects.toMatchObject({
    status: 'conflict',
    reason: 'project_selection_changed',
  });
  const result = await saveRecordDraft(
    db(),
    f.account.manager,
    f.input,
    f.clock,
  );
  expect(
    (
      await db()
        .select()
        .from(events)
        .where(eq(events.id, result.result.events[0].eventId))
    )[0].projectId,
  ).toBe(f.projectId);
});
it('rejects a full shared quote when one current subject is outside the evaluator node scope', async () => {
  const f = await native();
  await db()
    .insert(eventParticipants)
    .values({ eventId: f.sourceEventId, personId: f.person.two });
  await expect(
    saveRecordDraft(db(), f.account.one, f.input, f.clock),
  ).rejects.toMatchObject({
    status: 'forbidden',
    reason: 'source_not_visible',
  });
});
it('returns unavailable rather than inventing a source node from a person/cohort', async () => {
  const f = await native();
  await db()
    .update(events)
    .set({ evaluationNodeId: null })
    .where(eq(events.id, f.sourceEventId));
  await expect(
    saveRecordDraft(db(), f.account.one, f.input, f.clock),
  ).rejects.toMatchObject({ status: 'unavailable' });
});
it('rolls native effects back when a real foreign key fails after the records phase', async () => {
  const f = await native({ invalidDimension: true });
  const before = await snapshot();
  await expect(
    saveRecordDraft(db(), f.account.one, f.input, f.clock),
  ).rejects.toThrow();
  expect(await snapshot()).toEqual(before);
  expect(
    (
      await db()
        .select()
        .from(recordDrafts)
        .where(eq(recordDrafts.draftId, f.draft.draftId))
    )[0].revision,
  ).toBe(1);
});
it('rolls the audit row and every effect back when the last boundary fails', async () => {
  const f = await native();
  const before = await snapshot();
  const record = audit.recordAudit;
  vi.spyOn(audit, 'recordAudit').mockImplementationOnce(async (...args) => {
    await record(...args);
    throw new Error('synthetic final-boundary failure');
  });
  await expect(
    saveRecordDraft(db(), f.account.one, f.input, f.clock),
  ).rejects.toThrow('synthetic final-boundary failure');
  expect(await snapshot()).toEqual(before);
});
it('keeps different event drafts for the same person independent', async () => {
  const f = await native({ secondDraft: true });
  const first = await saveRecordDraft(db(), f.account.one, f.input, f.clock);
  const second = await saveRecordDraft(
    db(),
    f.account.one,
    {
      ...f.input,
      draftId: f.otherDraft.draftId,
      operation_id: f.id + '-other-draft',
      sbi: f.otherDraft.sbi,
    },
    f.clock,
  );
  expect(first.result.events[0].eventId).not.toBe(
    second.result.events[0].eventId,
  );
  expect(first.result.events[0].personId).toBe(
    second.result.events[0].personId,
  );
});
it('completes a real assigned confirmation task atomically and cancels its withdrawn draft task', async () => {
  const f = await native();
  const task = await db().transaction((tx) =>
    insertEvaluationWorkItem(
      tx,
      {
        id: f.id + '-task',
        evaluationNodeId: f.node,
        personId: f.person.one,
        assignedRelationId: f.relationOne,
        assignedEvaluatorId: f.person['rater-one'],
        kind: 'confirmation',
        resourceId: f.draft.draftId,
      },
      businessNow,
    ),
  );
  const saved = await saveRecordDraft(db(), f.account.one, f.input, f.clock);
  const [row] = await db()
    .select()
    .from(recordSaves)
    .where(eq(recordSaves.saveId, saved.result.saveId));
  expect(row.confirmationWork).toEqual([
    {
      id: task.id,
      assignedRelationId: f.relationOne,
      assignedEvaluatorId: f.person['rater-one'],
      completedRevision: task.revision + 1,
    },
  ]);
  await undoRecordSave(
    db(),
    f.account.one,
    { operation_id: f.id + '-undo', saveId: saved.result.saveId },
    f.clock,
  );
  expect(
    (
      await db()
        .select()
        .from(evaluationWorkItems)
        .where(eq(evaluationWorkItems.id, task.id))
    )[0],
  ).toMatchObject({ state: 'cancelled', revision: task.revision + 2 });
});
it('cannot undo an original task after a later source-task revision', async () => {
  const f = await native();
  const taskId = f.id + '-task';
  await db().transaction((tx) =>
    insertEvaluationWorkItem(
      tx,
      {
        id: taskId,
        evaluationNodeId: f.node,
        personId: f.person.one,
        assignedRelationId: f.relationOne,
        assignedEvaluatorId: f.person['rater-one'],
        kind: 'confirmation',
        resourceId: f.draft.draftId,
      },
      businessNow,
    ),
  );
  const saved = await saveRecordDraft(db(), f.account.one, f.input, f.clock);
  await db()
    .update(evaluationWorkItems)
    .set({ revision: 3 })
    .where(eq(evaluationWorkItems.id, taskId));
  const before = await snapshot();
  await expect(
    undoRecordSave(
      db(),
      f.account.one,
      { operation_id: f.id + '-undo', saveId: saved.result.saveId },
      f.clock,
    ),
  ).rejects.toMatchObject({
    status: 'conflict',
    reason: 'confirmation_task_changed',
  });
  expect(await snapshot()).toEqual(before);
});

it('replays the accepted undo after the deadline without a second operation or audit row', async () => {
  const f = await native();
  const saved = await saveRecordDraft(db(), f.account.one, f.input, f.clock);
  const input = { operation_id: f.id + '-undo', saveId: saved.result.saveId };
  const first = await undoRecordSave(db(), f.account.one, input, f.clock);
  const before = await snapshot();
  f.setWall(5001);
  const replay = await undoRecordSave(db(), f.account.one, input, f.clock);
  expect(replay).toEqual({ ...first, replayed: true });
  expect(await snapshot()).toEqual(before);
  const operations = await db()
    .select()
    .from(recordOperations)
    .where(
      and(
        eq(recordOperations.actorAccountId, f.account.one),
        eq(recordOperations.action, 'undo'),
      ),
    );
  expect(operations).toHaveLength(1);
});
it("denies a different currently authorized evaluator from withdrawing someone else's save", async () => {
  const f = await native();
  const saved = await saveRecordDraft(db(), f.account.one, f.input, f.clock);
  await expect(
    undoRecordSave(
      db(),
      f.account.two,
      { operation_id: f.id + '-not-owner', saveId: saved.result.saveId },
      f.clock,
    ),
  ).rejects.toMatchObject({ status: 'forbidden' });
});
it.each(['revokedAt', 'validTo'] as const)(
  'checks current relation %s on a new native command',
  async (field) => {
    const f = await native();
    await db()
      .update(evaluationRelations)
      .set({ [field]: businessNow })
      .where(eq(evaluationRelations.id, f.relationOne));
    const before = await snapshot();
    await expect(
      saveRecordDraft(db(), f.account.one, f.input, f.clock),
    ).rejects.toMatchObject({ status: 'forbidden' });
    expect(await snapshot()).toEqual(before);
  },
);
it('does not treat a noReview subject as an allowed native confirmation', async () => {
  const f = await native();
  await db()
    .update(people)
    .set({ noReview: true })
    .where(eq(people.id, f.person.one));
  await expect(
    saveRecordDraft(db(), f.account.one, f.input, f.clock),
  ).rejects.toMatchObject({ status: 'forbidden' });
});
it('confirms one event while separate event drafts await their duplicate decision', async () => {
  const f = await native({ secondDraft: true });
  const third = {
    ...structuredClone(f.otherDraft),
    draftId: f.id + '-draft-three',
  };
  await db().insert(recordDrafts).values({
    draftId: third.draftId,
    batchId: third.batchId,
    revision: third.revision,
    draft: third,
  });
  await db()
    .update(recordDraftBatches)
    .set({
      duplicateCandidates: [
        {
          candidateId: f.id + '-duplicates',
          draftIds: [f.otherDraft.draftId, third.draftId],
          reason: '演示：仅另两件事待去重',
        },
      ],
    })
    .where(eq(recordDraftBatches.batchId, f.draft.batchId));
  const saved = await saveRecordDraft(db(), f.account.one, f.input, f.clock);
  expect(saved.result.events).toHaveLength(1);
  await expect(
    saveRecordDraft(
      db(),
      f.account.one,
      {
        ...f.input,
        operation_id: f.id + '-blocked-duplicate',
        draftId: f.otherDraft.draftId,
        sbi: f.otherDraft.sbi,
      },
      f.clock,
    ),
  ).rejects.toMatchObject({
    status: 'conflict',
    reason: 'duplicate_decision_required',
  });
});

it("does not substitute another current relation for the completed task's original bound relation", async () => {
  const f = await native();
  await db().transaction((tx) =>
    insertEvaluationWorkItem(
      tx,
      {
        id: f.id + '-task',
        evaluationNodeId: f.node,
        personId: f.person.one,
        assignedRelationId: f.relationOne,
        assignedEvaluatorId: f.person['rater-one'],
        kind: 'confirmation',
        resourceId: f.draft.draftId,
      },
      businessNow,
    ),
  );
  const saved = await saveRecordDraft(db(), f.account.one, f.input, f.clock);
  await db()
    .update(evaluationRelations)
    .set({ revokedAt: businessNow })
    .where(eq(evaluationRelations.id, f.relationOne));
  await db()
    .insert(evaluationRelations)
    .values({
      id: f.id + '-replacement-relation',
      evaluationNodeId: f.node,
      personId: f.person.one,
      evaluatorId: f.person['rater-one'],
      kind: 'evaluator',
      validFrom: businessNow,
    });
  const before = await snapshot();
  await expect(
    undoRecordSave(
      db(),
      f.account.one,
      { operation_id: f.id + '-undo', saveId: saved.result.saveId },
      f.clock,
    ),
  ).rejects.toMatchObject({
    status: 'forbidden',
    reason: 'confirmation_task_permission_changed',
  });
  expect(await snapshot()).toEqual(before);
});

it('R2 P1: successful undo action never discloses another subject batch input or attachments', async () => {
  const f = await native({ secondDraft: true });
  const hiddenText = '演示：仅另一主体可见的批次原话';
  const hiddenAttachment = f.id + '-private-other-attachment';
  const other = structuredClone(f.otherDraft);
  other.personIds = [f.person.two];
  other.scores = other.scores.map((score) => ({
    ...score,
    personId: f.person.two,
  }));
  await db()
    .update(recordDrafts)
    .set({ draft: other })
    .where(eq(recordDrafts.draftId, other.draftId));
  await db()
    .update(recordDraftBatches)
    .set({
      originalInput: {
        ...f.originalInput,
        text: hiddenText,
        attachmentIds: [hiddenAttachment],
      },
    })
    .where(eq(recordDraftBatches.batchId, f.draft.batchId));
  const first = await saveRecordDraft(db(), f.account.one, f.input, f.clock);
  vi.mocked(requireSession).mockResolvedValue({
    user: { id: f.account.two },
  } as Awaited<ReturnType<typeof requireSession>>);
  const second = await saveRecordAction({
    ...f.input,
    operation_id: f.id + '-second-action',
    expected_revision: first.result.revision,
  });
  if (second.status !== 'success')
    throw new Error('Expected authorized second evaluator save');
  const input = {
    operation_id: f.id + '-second-undo',
    saveId: second.result.saveId,
  };
  const undone = await undoRecordAction(input);
  expect(undone.status).toBe('success');
  expect(JSON.stringify(undone)).not.toContain(hiddenText);
  expect(JSON.stringify(undone)).not.toContain(hiddenAttachment);
  const replayed = await undoRecordAction(input);
  expect(replayed.status).toBe('success');
  expect(JSON.stringify(replayed)).not.toContain(hiddenText);
  expect(JSON.stringify(replayed)).not.toContain(hiddenAttachment);
});
it('R2 P2: later evaluator review dependency prevents a partial withdrawal', async () => {
  const f = await native();
  const first = await saveRecordDraft(db(), f.account.one, f.input, f.clock);
  const second = await saveRecordDraft(
    db(),
    f.account.two,
    {
      ...edited(f, 1, '演示B判断'),
      operation_id: f.id + '-B',
      expected_revision: first.result.revision,
    },
    f.clock,
  );
  const third = await saveRecordDraft(
    db(),
    f.account.manager,
    {
      ...edited(f, 4, '演示C判断'),
      operation_id: f.id + '-C',
      expected_revision: second.result.revision,
    },
    f.clock,
  );
  const before = await db()
    .select()
    .from(scoreReviews)
    .where(eq(scoreReviews.eventId, first.result.events[0].eventId));
  expect(
    before.some(
      (row) =>
        row.saveId === third.result.saveId &&
        [row.confirmationId, row.counterpartConfirmationId].includes(
          second.result.confirmationIds[0],
        ),
    ),
  ).toBe(true);
  await expect(
    undoRecordSave(
      db(),
      f.account.two,
      { operation_id: f.id + '-B-undo', saveId: second.result.saveId },
      f.clock,
    ),
  ).rejects.toMatchObject({
    status: 'conflict',
    reason: 'later_confirmation_or_review',
  });
  expect((await rowsForSave(second.result.saveId)).human[0].active).toBe(true);
  expect(
    await db()
      .select()
      .from(scoreReviews)
      .where(eq(scoreReviews.eventId, first.result.events[0].eventId)),
  ).toEqual(before);
  // Removing the actual later dependency releases only the earlier undo;
  // the inactive reviews stay as history, and old undo replay cannot touch
  // the evaluator's subsequent confirmation revision.
  await undoRecordSave(
    db(),
    f.account.manager,
    { operation_id: f.id + '-C-undo', saveId: third.result.saveId },
    f.clock,
  );
  const secondUndo = {
    operation_id: f.id + '-B-undo',
    saveId: second.result.saveId,
  };
  await undoRecordSave(db(), f.account.two, secondUndo, f.clock);
  const [currentDraft] = await db()
    .select()
    .from(recordDrafts)
    .where(eq(recordDrafts.draftId, f.draft.draftId));
  const reconfirmed = await saveRecordDraft(
    db(),
    f.account.two,
    {
      ...edited(f, 1, '演示B重新判断'),
      operation_id: f.id + '-B-reconfirm',
      expected_revision: currentDraft.revision,
    },
    f.clock,
  );
  const currentBeforeReplay = await snapshot();
  const replay = await undoRecordSave(db(), f.account.two, secondUndo, f.clock);
  expect(replay.replayed).toBe(true);
  expect(await snapshot()).toEqual(currentBeforeReplay);
  const [newConfirmation] = (await rowsForSave(reconfirmed.result.saveId))
    .human;
  expect(newConfirmation).toMatchObject({
    active: true,
    revision: 2,
    previousId: second.result.confirmationIds[0],
  });
});
it('R2 S1: withdrawing a draft resource cancels the other evaluator pending task atomically', async () => {
  const f = await native();
  const task = await db().transaction((tx) =>
    insertEvaluationWorkItem(
      tx,
      {
        id: f.id + '-other-pending',
        evaluationNodeId: f.node,
        personId: f.person.one,
        assignedRelationId: f.relationOne,
        assignedEvaluatorId: f.person['rater-one'],
        kind: 'confirmation',
        resourceId: f.draft.draftId,
      },
      businessNow,
    ),
  );
  const saved = await saveRecordDraft(db(), f.account.two, f.input, f.clock);
  const undone = await undoRecordSave(
    db(),
    f.account.two,
    { operation_id: f.id + '-undo-resource', saveId: saved.result.saveId },
    f.clock,
  );
  expect(undone.result.withdrawnEvents).toEqual(saved.result.events);
  const [current] = await db()
    .select()
    .from(evaluationWorkItems)
    .where(eq(evaluationWorkItems.id, task.id));
  expect(current).toMatchObject({
    state: 'cancelled',
    revision: task.revision + 1,
    assignedRelationId: task.assignedRelationId,
    assignedEvaluatorId: task.assignedEvaluatorId,
  });
});
