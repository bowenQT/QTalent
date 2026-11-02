import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createClock } from '../../lib/clock';
import { selectionRevisionSchema } from '../../contracts/selection-standard';
import { requireSession } from '../auth/next';
import { createDatabase, getDatabase } from '../db/client';
import { importDemo } from '../db/import';
import { mapPrototypeSeed, readPrototypeSeed } from '../db/seed';
import { initializeStandardIterationDemo } from '../db/seed/standard-iteration-demo/init';
import { comparisonBatches } from '../modules/evaluation-system';
import { readComparisonDataset } from '../usecases/judgment-comparison-dataset';
import { nativeAttributionReadServices } from '../usecases/standard-attribution/batch-state';
import { createStandardAttributionUsecases } from '../usecases/standard-attribution/hypotheses';
import { createAttributionPostgresStore } from '../usecases/standard-attribution/postgres';
import {
  publishSelectionRevisionAction,
  saveSelectionRevisionAction,
  submitSelectionRevisionAction,
} from '../actions/selection-standard';
import { selectionLifecycle } from './rules';
import { getJudgePage } from './judge';

vi.mock('server-only', () => ({}));
vi.mock('../auth/next', () => ({ requireSession: vi.fn() }));
vi.mock('../db/client', async (original) => ({
  ...(await original<typeof import('../db/client')>()),
  getDatabase: vi.fn(),
}));
vi.mock('../env', () => ({ getEnv: () => ({ APP_ENV: 'test' }) }));

const databaseName =
  'qtalent_judge_demo_' + randomUUID().replaceAll('-', '') + '_test';
const businessClock = createClock('test');
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
let batchId = '';
let caseId = '';

function signIn(accountId: string) {
  vi.mocked(requireSession).mockResolvedValue({
    user: { id: accountId },
  } as Awaited<ReturnType<typeof requireSession>>);
}
function success<T extends { status: string }>(result: T) {
  if (result.status !== 'success')
    throw new Error('Expected success: ' + JSON.stringify(result));
  return result as Extract<T, { status: 'success' }>;
}

// The imported demo directory and the operator's --init: the sixth cohort's
// comparison batch, judged against xe-select-v1.
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source) throw new Error('Real PostgreSQL requires TEST_DATABASE_URL');
  const url = new URL(source);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Integration database must be loopback and end _test');
  admin = new Pool({ connectionString: source });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  url.pathname = '/' + databaseName;
  connection = createDatabase(url.toString());
  const db = connection.db;
  await migrate(db, { migrationsFolder: 'src/server/db/migrations' });
  vi.mocked(getDatabase).mockReturnValue(db);
  await importDemo(
    db,
    mapPrototypeSeed(readPrototypeSeed(process.cwd())),
    'Synthetic-test-password-only',
  );
  await initializeStandardIterationDemo(db, process.cwd(), 'demo-ceo', () =>
    businessClock.now(),
  );
  const [batch] = await db
    .select({ id: comparisonBatches.id })
    .from(comparisonBatches)
    .where(eq(comparisonBatches.cohortId, 'b-xe6'));
  batchId = batch.id;
  const data = await db.transaction((tx) => readComparisonDataset(tx, batchId));
  const unit = data?.cases.find((c) => c.front.state === 'present');
  if (!unit) throw new Error('--init stored no front judgment to cite');
  caseId = unit.id;
});
afterEach(() => {
  vi.useRealTimers();
});
afterAll(async () => {
  await connection?.pool.end();
  await admin?.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  await admin?.end();
});

it('assembles each audience from the stored batch, and HR keeps reading the version the batch was judged against after a newer one is published', async () => {
  signIn('demo-hrbp');
  const before = await getJudgePage();
  if (before.status !== 'hr') throw new Error('Expected the HR page');
  expect(before.page.batch).toMatchObject({
    id: batchId,
    selectionStandardVersionId: 'xe-select-v1',
  });
  expect(before.page.raters.length).toBeGreaterThan(0);
  expect(before.currentVersionId).toBe('xe-select-v1');
  expect(before).toMatchObject({ hypotheses: [], attributions: [] });
  const judgedAgainst = before.standard;

  signIn('demo-ceo');
  const manager = await getJudgePage();
  expect(manager.status).toBe('manager');
  expect(JSON.stringify(manager)).not.toMatch(/evaluator|caseId|excerpt/);

  // HR attributes, drafts and submits; the manager publishes v2 and lets the
  // undo window close.
  const now = () => businessClock.now();
  const signed = success(
    await createStandardAttributionUsecases(
      createAttributionPostgresStore(
        connection!.db,
        nativeAttributionReadServices(now),
      ),
      {
        expectedModel: 'unused',
        client: {
          generateStructured: () => {
            throw new Error('A signed attribution needs no model');
          },
        },
      },
      { now },
    ).confirmAttribution('demo-hrbp', {
      operationId: 'attribute',
      batchId,
      hypothesisId: null,
      categories: ['evaluation_standard'],
      rationale: '入营评审没有要求核对个人贡献（演示）',
      caseIds: [caseId],
    }),
  );
  const draft = selectionRevisionSchema.parse(
    success(
      await selectionLifecycle().execute('demo-hrbp', {
        action: 'create',
        input: {
          operationId: 'create',
          baseVersionId: 'xe-select-v1',
          attributionId: signed.result.id,
          expectedAttributionRevision: signed.result.revision,
          reason: '补充核对个人贡献的要点（演示）',
        },
      }),
    ).result,
  );
  signIn('demo-hrbp');
  const saved = success(
    await saveSelectionRevisionAction({
      operationId: 'save',
      draftId: draft.id,
      expectedRevision: draft.revision,
      reason: '补充核对个人贡献的要点（演示）',
      changes: [
        {
          kind: 'add',
          after: {
            id: 'xe-select-contribution',
            title: '个人贡献（演示）',
            description: '核对作品中本人完成的部分（演示）',
          },
        },
      ],
    }),
  );
  const submitted = success(
    await submitSelectionRevisionAction({
      operationId: 'submit',
      draftId: draft.id,
      expectedRevision: saved.result.revision,
      expectedPreviewId: saved.result.impactPreview.id,
    }),
  );
  signIn('demo-ceo');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T08:00:00.000Z'));
  success(
    await publishSelectionRevisionAction({
      operationId: 'publish',
      draftId: draft.id,
      expectedRevision: submitted.result.revision,
      expectedPreviewId: saved.result.impactPreview.id,
    }),
  );
  vi.setSystemTime(new Date('2026-11-03T08:01:00.000Z'));

  signIn('demo-hrbp');
  const after = await getJudgePage();
  if (after.status !== 'hr') throw new Error('Expected the HR page');
  expect(after.page.batch.selectionStandardVersionId).toBe('xe-select-v1');
  expect(after.standard).toEqual(judgedAgainst);
  expect(JSON.stringify(after.standard)).not.toContain('个人贡献（演示）');
  // A new revision starts from the version in force.
  expect(after.currentVersionId).toBe('xe-select-v2');
  expect(after.attributions.map((a) => a.id)).toEqual([signed.result.id]);
});
