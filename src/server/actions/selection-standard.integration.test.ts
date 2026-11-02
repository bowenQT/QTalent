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
import { getSelectionStandardPage, selectionLifecycle } from '../queries/rules';
import {
  publishSelectionRevisionAction,
  readSelectionRevisionAction,
  returnSelectionRevisionAction,
  saveSelectionRevisionAction,
  submitSelectionRevisionAction,
  undoSelectionPublicationAction,
  withdrawSelectionRevisionAction,
} from './selection-standard';

vi.mock('server-only', () => ({}));
vi.mock('../auth/next', () => ({ requireSession: vi.fn() }));
vi.mock('../db/client', async (original) => ({
  ...(await original<typeof import('../db/client')>()),
  getDatabase: vi.fn(),
}));
vi.mock('../env', () => ({ getEnv: () => ({ APP_ENV: 'test' }) }));

const databaseName =
  'qtalent_selection_actions_' + randomUUID().replaceAll('-', '') + '_test';
const businessClock = createClock('test');
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
let draftId = '';

function signIn(accountId: string) {
  vi.mocked(requireSession).mockResolvedValue({
    user: { id: accountId },
  } as Awaited<ReturnType<typeof requireSession>>);
}
/** The server wall clock; the business clock stays on the fixed demo date. */
function wallAt(iso: string) {
  vi.setSystemTime(new Date(iso));
}
function success<T extends { status: string }>(result: T) {
  if (result.status !== 'success')
    throw new Error('Expected success: ' + JSON.stringify(result));
  return result as Extract<T, { status: 'success' }>;
}

// The operator's --init on the imported demo directory, then HR's signed
// attribution and the empty draft created from it, as /judge leaves them.
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
  const now = () => businessClock.now();
  await initializeStandardIterationDemo(db, process.cwd(), 'demo-ceo', now);
  const [batch] = await db
    .select({ id: comparisonBatches.id })
    .from(comparisonBatches)
    .where(eq(comparisonBatches.cohortId, 'b-xe6'));
  const data = await db.transaction((tx) =>
    readComparisonDataset(tx, batch.id),
  );
  const unit = data?.cases.find((c) => c.front.state === 'present');
  if (!unit) throw new Error('--init stored no front judgment to cite');
  const attribution = createStandardAttributionUsecases(
    createAttributionPostgresStore(db, nativeAttributionReadServices(now)),
    {
      expectedModel: 'unused',
      client: {
        generateStructured: () => {
          throw new Error('A signed attribution needs no model');
        },
      },
    },
    { now },
  );
  const signed = success(
    await attribution.confirmAttribution('demo-hrbp', {
      operationId: 'attribute',
      batchId: batch.id,
      hypothesisId: null,
      categories: ['evaluation_standard'],
      rationale: '入营评审没有要求核对个人贡献（演示）',
      caseIds: [unit.id],
    }),
  );
  const created = success(
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
  );
  draftId = selectionRevisionSchema.parse(created.result).id;
});
afterEach(() => {
  vi.useRealTimers();
});
afterAll(async () => {
  await connection?.pool.end();
  await admin?.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  await admin?.end();
});

it('the seven /rules actions run from the session through PG, and the undo window runs on the wall clock', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  wallAt('2026-11-03T08:00:00.000Z');
  const point = {
    id: 'xe-select-contribution',
    title: '个人贡献（演示）',
    description: '核对作品中本人完成的部分（演示）',
  };

  signIn('demo-mentor');
  expect(
    await withdrawSelectionRevisionAction({
      operationId: 'mentor-withdraw',
      draftId,
      expectedRevision: 1,
    }),
  ).toMatchObject({ status: 'forbidden' });
  expect(await readSelectionRevisionAction({ draftId })).toMatchObject({
    status: 'forbidden',
  });

  signIn('demo-hrbp');
  const opened = success(await readSelectionRevisionAction({ draftId }));
  expect(opened.view.audience).toBe('hr');
  let revision = opened.view.revision.revision;
  const saved = success(
    await saveSelectionRevisionAction({
      operationId: 'save-1',
      draftId,
      expectedRevision: revision,
      reason: '补充核对个人贡献的要点（演示）',
      changes: [{ kind: 'add', after: point }],
    }),
  );
  revision = saved.result.revision;
  expect(saved.result.impactPreview.nextCohort.id).toBe('b-xe7-demo');
  let submitted = success(
    await submitSelectionRevisionAction({
      operationId: 'submit-1',
      draftId,
      expectedRevision: revision,
      expectedPreviewId: saved.result.impactPreview.id,
    }),
  );
  const withdrawn = success(
    await withdrawSelectionRevisionAction({
      operationId: 'withdraw-1',
      draftId,
      expectedRevision: submitted.result.revision,
    }),
  );
  expect(withdrawn.result.state).toBe('draft');
  submitted = success(
    await submitSelectionRevisionAction({
      operationId: 'submit-2',
      draftId,
      expectedRevision: withdrawn.result.revision,
      expectedPreviewId: saved.result.impactPreview.id,
    }),
  );

  signIn('demo-ceo');
  const pending = success(await readSelectionRevisionAction({ draftId }));
  expect(pending.view.audience).toBe('manager');
  // The manager's view carries the aggregate basis, never cases or raters.
  expect(JSON.stringify(pending.view)).not.toMatch(
    /caseIds|fragmentId|excerpt/,
  );
  const returned = success(
    await returnSelectionRevisionAction({
      operationId: 'return-1',
      draftId,
      expectedRevision: submitted.result.revision,
      reason: '请写明核对的方式（演示）',
    }),
  );
  expect(returned.result.state).toBe('draft');

  signIn('demo-hrbp');
  const resaved = success(
    await saveSelectionRevisionAction({
      operationId: 'save-2',
      draftId,
      expectedRevision: returned.result.revision,
      reason: '补充核对个人贡献的要点（演示）',
      changes: [
        {
          kind: 'add',
          after: {
            ...point,
            description: '对照提交记录核对本人完成的部分（演示）',
          },
        },
      ],
    }),
  );
  submitted = success(
    await submitSelectionRevisionAction({
      operationId: 'submit-3',
      draftId,
      expectedRevision: resaved.result.revision,
      expectedPreviewId: resaved.result.impactPreview.id,
    }),
  );

  signIn('demo-ceo');
  wallAt('2026-11-03T08:01:00.000Z');
  const published = success(
    await publishSelectionRevisionAction({
      operationId: 'publish-1',
      draftId,
      expectedRevision: submitted.result.revision,
      expectedPreviewId: resaved.result.impactPreview.id,
    }),
  );
  expect(published.result).toMatchObject({
    versionId: 'xe-select-v2',
    publishedAt: '2026-11-03T08:01:00.000Z',
    undoUntil: '2026-11-03T08:01:05.000Z',
  });
  expect(await getSelectionStandardPage(null)).toMatchObject({
    status: 'current',
    version: {
      versionId: 'xe-select-v2',
      // The version takes effect on the business date, not the wall clock.
      effectiveFrom: businessClock.now().toISOString(),
    },
  });

  const undoInput = {
    operationId: 'undo-1',
    publicationId: published.result.publicationId,
    expectedRevision: published.result.revision,
  };
  wallAt('2026-11-03T08:01:04.999Z');
  const undone = success(await undoSelectionPublicationAction(undoInput));
  expect(undone.replayed).toBe(false);
  expect(undone.result.restoredVersionId).toBe('xe-select-v1');
  // A retry of the request that already succeeded answers the same, late or not.
  wallAt('2026-11-03T08:02:00.000Z');
  expect(await undoSelectionPublicationAction(undoInput)).toEqual({
    ...undone,
    replayed: true,
  });

  const back = success(await readSelectionRevisionAction({ draftId }));
  wallAt('2026-11-03T08:03:00.000Z');
  const again = success(
    await publishSelectionRevisionAction({
      operationId: 'publish-2',
      draftId,
      expectedRevision: back.view.revision.revision,
      expectedPreviewId: resaved.result.impactPreview.id,
    }),
  );
  // A first undo that arrives at the fifth second is too late, although the
  // business clock has not moved since the publication.
  wallAt('2026-11-03T08:03:05.000Z');
  expect(
    await undoSelectionPublicationAction({
      operationId: 'undo-2',
      publicationId: again.result.publicationId,
      expectedRevision: again.result.revision,
    }),
  ).toMatchObject({ status: 'conflict' });
  expect(await getSelectionStandardPage(null)).toMatchObject({
    status: 'current',
    version: { versionId: again.result.versionId },
  });
});
