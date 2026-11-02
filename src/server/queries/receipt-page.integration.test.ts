import { eq } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  businessAt,
  nativeDatabase,
  seedNativeCase,
  seedNativeRules,
  syntheticBatchClient,
  wallAt,
} from '../../../tests/fixtures/bow-845/native';
import { recordArrangeQueue } from '../jobs/record-arrange';
import { accountBindings, grants, people } from '../modules/directory';
import { createRecordArrangeApplication } from '../usecases/record-arrange-application';
import { readReceiptView } from './receipt-page';

vi.mock('server-only', () => ({}));

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

/** A mentor hands in one sentence; the synthetic model arranges two drafts. */
async function arranged() {
  const facts = await seedNativeCase(connection.db);
  const model = syntheticBatchClient({ twoEvents: true });
  const app = createRecordArrangeApplication({
    db: connection.db,
    boss,
    client: model.client,
    businessNow: () => businessAt,
    now: () => new Date(wallAt),
  });
  const created = await app.requests.create(facts.account, facts.input);
  if (created.status !== 'success' || !created.result.jobId)
    throw new Error('queued native intake required');
  await app.runner.run(created.result.jobId, 1);
  const read = await app.requests.readBatch(facts.account, {
    batchId: created.result.batchId,
  });
  if (read.status !== 'success') throw new Error('arranged batch required');
  return { ...facts, receipt: read.result };
}

it('names the batch, its submitter and people, and lets the evaluator confirm', async () => {
  const h = await arranged();
  const drafts = h.receipt.draftSet?.drafts ?? [];
  expect(drafts.length).toBe(2);
  const { view, viewerName } = await readReceiptView(
    connection.db,
    h.account,
    businessAt,
    h.receipt,
  );
  const [evaluator] = await connection.db
    .select({ name: people.name })
    .from(people)
    .where(eq(people.id, h.evaluator));
  expect(viewerName).toBe(evaluator!.name);
  expect(view).toMatchObject({
    receipt: h.receipt,
    title: '演示记录节点',
    entry: 'web',
    tool: null,
    submittedBy: evaluator!.name,
  });
  expect(Date.parse(view.submittedAt)).not.toBeNaN();
  expect(Object.keys(view.people)).toEqual(h.receipt.personIds);
  expect(view.people[h.target]).toMatchObject({ meta: '演示', demo: true });
  // Every dimension a draft scores has a name.
  for (const draft of drafts)
    for (const score of draft.scores)
      expect(view.dimensions[score.dimensionId]).toBeTruthy();
  for (const draft of drafts)
    expect(view.confirmers[draft.draftId]).toEqual({
      mine: true,
      name: evaluator!.name,
    });
});

it('shows HR whose confirmation each draft waits for, without letting HR confirm it', async () => {
  const h = await arranged();
  const hrAccount = h.prefix + '-hr-account';
  await connection.db.insert(people).values({
    id: h.prefix + '-hr',
    name: '演示人力' + h.prefix,
    organizationId: h.prefix,
    demo: true,
  });
  await connection.db.insert(accountBindings).values({
    accountId: hrAccount,
    personId: h.prefix + '-hr',
    isSystemAdmin: false,
  });
  await connection.db.insert(grants).values({
    id: h.prefix + '-hr-grant',
    accountId: hrAccount,
    role: 'hr',
    scope: 'cohort',
    cohortId: h.cohort,
    validFrom: '2026-01-01',
  });
  const { view, viewerName } = await readReceiptView(
    connection.db,
    hrAccount,
    businessAt,
    h.receipt,
  );
  expect(viewerName).toBe('演示人力' + h.prefix);
  for (const draft of h.receipt.draftSet?.drafts ?? [])
    expect(view.confirmers[draft.draftId]).toEqual({
      mine: false,
      name: '演示评价人' + h.prefix,
    });
});

it('falls back to plain words when the batch has no recorded intake or visible evaluator', async () => {
  const h = await arranged();
  const { view } = await readReceiptView(
    connection.db,
    h.outsiderAccount,
    businessAt,
    { ...h.receipt, batchId: 'no-such-batch', projectId: null },
  );
  expect(view.submittedBy).toBe('提交人');
  expect(view.submittedAt).toBe(new Date(businessAt).toISOString());
  for (const draft of h.receipt.draftSet?.drafts ?? [])
    expect(view.confirmers[draft.draftId]).toEqual({
      mine: false,
      name: '评价人',
    });
});
