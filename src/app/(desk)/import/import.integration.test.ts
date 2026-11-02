// @vitest-environment jsdom
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { createElement } from 'react';
import { ToastProvider } from '@/components/ui/Toast';
import { createDatabase, getDatabase } from '@/server/db/client';
import { importDemo } from '@/server/db/import';
import { mapPrototypeSeed, readPrototypeSeed } from '@/server/db/seed';
import {
  interviewImportCandidates,
  interviewImportOperations,
  interviewImportRows,
} from '@/server/modules/records/interview-import/schema';
import { accountBindings, grants, people } from '@/server/modules/directory';
import { cohorts } from '@/server/modules/programs';
import { auditEvents } from '@/server/platform/audit/schema';
import { INTERVIEW_IMPORT_DEMO } from '@/server/db/seed/interview-import-demo/import';
import { confirmInterviewImportRowAction } from '@/server/actions/interview-import';
import { getInterviewImportPreview } from '@/server/queries/interview-import';
import ImportPage from './page';

/*
 * H3 regression (BOW-906): the demo batch enters through the real seed command, HR opens
 * the real /import page, confirms who a row is, and the import decision is stored for
 * that row revision. Only the session and the clocks are stand-ins.
 */
const session = vi.hoisted(() => ({ accountId: 'demo-hrbp' }));
vi.mock('@/server/db/client', async (original) => ({
  ...(await original<typeof import('@/server/db/client')>()),
  getDatabase: vi.fn(),
}));
vi.mock('@/server/auth/next', () => ({
  requireSession: async () => ({ user: { id: session.accountId } }),
}));
vi.mock('@/lib/clock', () => ({
  createClock: () => ({
    now: () => new Date('2026-11-01T00:00:00.000Z'),
    today: () => '2026-11-01',
  }),
}));
vi.mock('next/navigation', async (original) => ({
  ...(await original<typeof import('next/navigation')>()),
  usePathname: () => '/import',
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.setConfig({ testTimeout: 30_000 });

const run = promisify(execFile);
const database = `qtalent_import_${randomUUID().replaceAll('-', '')}_test`;
const batchId = INTERVIEW_IMPORT_DEMO.batchId;
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
let isolatedUrl = '';

const db = () => connection!.db;
/** The real operator command, run the way the release runs it. */
async function seed() {
  const { stdout } = await run(
    process.execPath,
    [
      '--import',
      'tsx',
      'src/server/db/seed/interview-import-demo/run.ts',
      '--apply',
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: isolatedUrl },
      timeout: 60_000,
    },
  );
  return JSON.parse(stdout.trim().split('\n').at(-1)!);
}
const stored = async (rowId: string) =>
  (
    await db()
      .select()
      .from(interviewImportRows)
      .where(
        and(
          eq(interviewImportRows.batchId, batchId),
          eq(interviewImportRows.rowId, rowId),
        ),
      )
  )[0];
async function openPage() {
  render(
    createElement(
      ToastProvider,
      null,
      await ImportPage({ searchParams: Promise.resolve({ id: batchId }) }),
    ),
  );
}

beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source) throw new Error('TEST_DATABASE_URL required; no skip or fake');
  const url = new URL(source);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Isolated loopback _test database required');
  admin = new Pool({ connectionString: source, max: 2 });
  await admin.query(`CREATE DATABASE "${database}"`);
  url.pathname = '/' + database;
  isolatedUrl = url.toString();
  connection = createDatabase(isolatedUrl);
  vi.mocked(getDatabase).mockReturnValue(connection.db);
  await migrate(db(), { migrationsFolder: 'src/server/db/migrations' });
  await importDemo(
    db(),
    mapPrototypeSeed(readPrototypeSeed(process.cwd())),
    'synthetic-test-password-only',
  );
}, 60_000);
afterEach(() => {
  cleanup();
  session.accountId = 'demo-hrbp';
});
afterAll(async () => {
  await connection?.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    await admin.end();
  }
});

it('seeds the demo batch through the real command and replays unchanged', async () => {
  expect(await seed()).toEqual({ status: 'created', batchId, rows: 3 });
  expect(await seed()).toEqual({ status: 'unchanged', batchId, rows: 3 });
  const row = await stored('campus-1');
  expect(row).toMatchObject({
    revision: 1,
    confirmedCandidateId: null,
    decision: null,
  });
});

it('goes from /import through HR confirmation to the stored import decision', async () => {
  await openPage();
  expect(screen.getByText(/面评导出-2026校招（演示）\.pdf/)).toBeTruthy();
  // The scale is the template's own: dimensions 1–5, the rating S–D.
  const opened = await getInterviewImportPreview(batchId);
  if (opened.status !== 'ok') throw new Error(opened.status);
  expect(
    opened.preview.batch.rows.map((r) => [r.rowId, r.template.scale]),
  ).toEqual(
    opened.preview.batch.rows.map((r) => [r.rowId, '1–5 分 · 面试评级 S–D']),
  );
  fireEvent.click(
    screen.getAllByRole('button', { name: '是谷嘉树（演示）' })[0],
  );
  await waitFor(() =>
    expect(screen.getByText('已确认是谷嘉树（演示）')).toBeTruthy(),
  );
  const row = await stored('campus-1');
  expect(row).toMatchObject({
    revision: 2,
    confirmedCandidateId: 'demo-candidate-01',
    confirmedForRevision: 2,
    confirmedByAccountId: 'demo-hrbp',
    decisionRevision: 2,
    decision: {
      status: 'planned',
      personId: 'p-x08',
      candidateId: 'demo-candidate-01',
      interviewerId: 's-01',
      decidedByAccountId: 'demo-hrbp',
    },
  });
  // The position code stays unknown: confirmation names the record, fills in nothing.
  expect(JSON.stringify(row.parsed)).toContain('"positionNumber":null');

  // Leaving and coming back shows the stored confirmation.
  cleanup();
  await openPage();
  expect(screen.getByText('已确认是谷嘉树（演示）')).toBeTruthy();

  // A replay of the seed keeps HR's confirmation and decision.
  expect((await seed()).status).toBe('unchanged');
  expect((await stored('campus-1')).decision?.status).toBe('planned');

  // Taking it back is stored too, as a new revision.
  fireEvent.click(screen.getByRole('button', { name: '改回' }));
  await waitFor(() =>
    expect(screen.queryByText('已确认是谷嘉树（演示）')).toBeNull(),
  );
  expect(await stored('campus-1')).toMatchObject({
    revision: 3,
    confirmedCandidateId: null,
    confirmedForRevision: null,
    decisionRevision: 3,
    decision: {
      status: 'needs_review',
      reviewItemKind: 'unknown_interview_candidate',
    },
  });

  // Both changes stay in the row's history, each with its own audit event.
  const history = await db()
    .select()
    .from(interviewImportOperations)
    .where(
      and(
        eq(interviewImportOperations.batchId, batchId),
        eq(interviewImportOperations.rowId, 'campus-1'),
      ),
    )
    .orderBy(asc(interviewImportOperations.toRevision));
  expect(history).toMatchObject([
    {
      action: 'confirm',
      actorAccountId: 'demo-hrbp',
      fromRevision: 1,
      toRevision: 2,
      before: { confirmation: null, decision: null },
      after: {
        confirmation: {
          candidateId: 'demo-candidate-01',
          forRevision: 2,
          byAccountId: 'demo-hrbp',
        },
        decision: { status: 'planned' },
      },
    },
    {
      action: 'revert',
      fromRevision: 2,
      toRevision: 3,
      before: { confirmation: { candidateId: 'demo-candidate-01' } },
      after: { confirmation: null, decision: { status: 'needs_review' } },
    },
  ]);
  const audits = await db()
    .select()
    .from(auditEvents)
    .where(
      inArray(
        auditEvents.id,
        history.map((op) => op.auditId),
      ),
    );
  expect(audits.map((a) => a.action).sort()).toEqual([
    'interview_import.row.confirm',
    'interview_import.row.revert',
  ]);
});

it('refuses a stale revision and a row the plan cannot use, writing nothing', async () => {
  const before = await stored('professional-1');
  expect(
    await confirmInterviewImportRowAction({
      batchId,
      rowId: 'professional-1',
      expectedRevision: before.revision + 1,
      ok: true,
    }),
  ).toMatchObject({ status: 'conflict' });
  expect(await stored('professional-1')).toEqual(before);

  // The interviewer printed on this PDF is not in the directory: it waits for review.
  const unknown = await stored('unknown-interviewer-1');
  expect(
    await confirmInterviewImportRowAction({
      batchId,
      rowId: 'unknown-interviewer-1',
      expectedRevision: unknown.revision,
      ok: true,
    }),
  ).toMatchObject({ status: 'conflict' });
  expect(await stored('unknown-interviewer-1')).toEqual(unknown);
  const preview = await getInterviewImportPreview(batchId);
  if (preview.status !== 'ok') throw new Error(preview.status);
  expect(
    preview.preview.batch.rows.find((r) => r.rowId === 'unknown-interviewer-1')
      ?.interviewer,
  ).toMatchObject({
    status: 'pending',
    observedName: '岚舟（目录外虚构名）（演示）',
  });
  expect(
    preview.preview.batch.rows.find((r) => r.rowId === 'professional-1')
      ?.interviewer,
  ).toEqual({ status: 'matched', name: '叶青（演示）' });
});

it('reads and changes rows only for a current HR grant', async () => {
  session.accountId = 'demo-mentor';
  expect(await getInterviewImportPreview(batchId)).toEqual({
    status: 'forbidden',
  });
  const before = await stored('professional-1');
  expect(
    await confirmInterviewImportRowAction({
      batchId,
      rowId: 'professional-1',
      expectedRevision: before.revision,
      ok: true,
    }),
  ).toMatchObject({ status: 'forbidden' });
  expect(await stored('professional-1')).toEqual(before);
});

/** An HR whose current grant is for another cohort: none of this batch's people. */
/** Idempotent: tests share one database. */
async function otherCohortHr() {
  const [person] = await db()
    .select({ organizationId: people.organizationId })
    .from(people)
    .limit(1);
  await db()
    .insert(cohorts)
    .values({ id: 'demo-other-cohort', name: '另一期次（演示）' })
    .onConflictDoNothing();
  await db()
    .insert(people)
    .values({
      id: 'demo-other-hr',
      name: '另一期次 HR（演示）',
      organizationId: person.organizationId,
      demo: true,
    })
    .onConflictDoNothing();
  await db()
    .insert(accountBindings)
    .values({
      accountId: 'demo-other-hr-account',
      personId: 'demo-other-hr',
      isSystemAdmin: false,
    })
    .onConflictDoNothing();
  await db()
    .insert(grants)
    .values({
      id: 'demo-other-hr-grant',
      accountId: 'demo-other-hr-account',
      role: 'hr',
      scope: 'cohort',
      cohortId: 'demo-other-cohort',
      validFrom: '2026-01-01',
    })
    .onConflictDoNothing();
  return 'demo-other-hr-account';
}

it('answers an HR outside the batch exactly as for a batch or row that does not exist', async () => {
  session.accountId = await otherCohortHr();
  expect(await getInterviewImportPreview(batchId)).toEqual(
    await getInterviewImportPreview('demo-interview-import-missing'),
  );
  expect(await getInterviewImportPreview(batchId)).toEqual({
    status: 'not_found',
  });
  const before = await stored('professional-1');
  const existing = await confirmInterviewImportRowAction({
    batchId,
    rowId: 'professional-1',
    expectedRevision: before.revision,
    ok: true,
  });
  expect(existing).toEqual(
    await confirmInterviewImportRowAction({
      batchId,
      rowId: 'no-such-row',
      expectedRevision: 1,
      ok: true,
    }),
  );
  expect(existing).toMatchObject({ status: 'not_found' });
  expect(await stored('professional-1')).toEqual(before);
});

it('shows a row about nobody known yet only to HR covering every subject of the batch’s node', async () => {
  // No recruitment record carries the printed name any more: the row is about nobody known.
  await db()
    .update(interviewImportCandidates)
    .set({ name: '对不上的姓名（演示）' })
    .where(
      and(
        eq(interviewImportCandidates.batchId, batchId),
        eq(interviewImportCandidates.candidateId, 'demo-candidate-01'),
      ),
    );
  const preview = await getInterviewImportPreview(batchId);
  if (preview.status !== 'ok') throw new Error(preview.status);
  expect(
    preview.preview.batch.rows.find((r) => r.rowId === 'campus-1'),
  ).toMatchObject({ candidateStatus: 'unknown', match: null });

  session.accountId = await otherCohortHr();
  expect(await getInterviewImportPreview(batchId)).toEqual({
    status: 'not_found',
  });
  const before = await stored('campus-1');
  expect(
    await confirmInterviewImportRowAction({
      batchId,
      rowId: 'campus-1',
      expectedRevision: before.revision,
      ok: false,
    }),
  ).toMatchObject({ status: 'not_found' });
  expect(await stored('campus-1')).toEqual(before);
});

it('stores a decision only together with its revision', async () => {
  await expect(
    db()
      .update(interviewImportRows)
      .set({ decision: null, decisionRevision: 1 })
      .where(
        and(
          eq(interviewImportRows.batchId, batchId),
          eq(interviewImportRows.rowId, 'professional-1'),
        ),
      ),
  ).rejects.toThrow();
});
