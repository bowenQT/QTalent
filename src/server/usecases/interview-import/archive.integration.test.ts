import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getDatabase } from '@/server/db/client';
import { nativeDatabase } from '../../../../tests/fixtures/bow-845/native';
import directory from '../../../../tests/fixtures/bow-896/directory.json';
import {
  organizations,
  people,
  accountBindings,
  grants,
  employments,
} from '../../modules/directory';
import {
  cohorts,
  enrollments,
  evaluationRelations,
} from '../../modules/programs';
import {
  historicalEvaluations,
  fragments,
  materialParses,
} from '../../modules/records';
import {
  interviewImportArchives,
  interviewImportRows,
  interviewImportOperations,
  interviewImportCandidates,
} from '../../modules/records/interview-import/schema';
import {
  importInterviewImportDemo,
  INTERVIEW_IMPORT_DEMO,
} from '../../db/seed/interview-import-demo/import';
import { readPersonForCurrentUser } from '../../queries/person';
import { loadPersonData } from '../../queries/person-data';
import { personInterviewArchiveFromData } from '../../queries/person-interviews';
import { readMaterialSource } from '../read-material-source';
import { confirmInterviewImportRow, fillInterviewImportRow } from './store';
import { unreadInterviewItems } from './plan';

const session = vi.hoisted(() => ({ accountId: 'archive-hr' }));
vi.mock('@/server/db/client', async (original) => ({
  ...(await original<typeof import('@/server/db/client')>()),
  getDatabase: vi.fn(),
}));
vi.mock('@/server/auth/next', () => ({
  requireSession: async () => ({ user: { id: session.accountId } }),
}));
vi.mock('@/server/env', () => ({ getEnv: () => ({ APP_ENV: 'test' }) }));
vi.mock('@/lib/clock', () => ({
  createClock: () => ({ now: () => new Date('2026-11-01T12:00:00.000Z') }),
}));
const now = '2026-11-01T12:00:00.000Z';
const clock = { now, at: now };
const batchId = INTERVIEW_IMPORT_DEMO.batchId;
let connection: Awaited<ReturnType<typeof nativeDatabase>>;
const db = () => connection.db;
const command = (rowId: string, expectedRevision = 1, ok = true) => ({
  batchId,
  rowId,
  expectedRevision,
  ok,
});
const confirm = (
  rowId: string,
  revision = 1,
  ok = true,
  accountId = 'archive-hr',
) =>
  confirmInterviewImportRow(
    db(),
    accountId,
    command(rowId, revision, ok),
    clock,
  );
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
  )[0]!;
const histories = () => db().select().from(historicalEvaluations);
const archives = () => db().select().from(interviewImportArchives);
const operations = () => db().select().from(interviewImportOperations);

beforeEach(async () => {
  // The formal versioned migrations are the only schema setup. No missing-PG skip,
  // generated-in-test table, fake authorization, or temporary migration overlay.
  connection = await nativeDatabase();
  vi.mocked(getDatabase).mockReturnValue(db());
  session.accountId = 'archive-hr';
  await db()
    .insert(organizations)
    .values({ id: 'archive-org', name: '演示组织', shortName: '演示' });
  await db()
    .insert(people)
    .values(
      directory.people.map(({ id, name }) => ({
        id,
        name,
        organizationId: 'archive-org',
        demo: true,
      })),
    );
  await db()
    .insert(accountBindings)
    .values([
      { accountId: 'archive-hr', personId: 'p-suwan' },
      { accountId: 'archive-evaluator', personId: 'p-yeqing' },
      { accountId: 'archive-employee', personId: 'p-x08' },
      { accountId: 'archive-outside-hr', personId: 's-01' },
    ]);
  await db()
    .insert(cohorts)
    .values([
      { id: 'archive-cohort', name: '演示期次' },
      { id: 'archive-other-cohort', name: '其他演示期次' },
    ]);
  await db()
    .insert(grants)
    .values([
      {
        id: 'archive-hr-grant',
        accountId: 'archive-hr',
        role: 'hr',
        scope: 'cohort',
        cohortId: 'archive-cohort',
        validFrom: '2026-01-01',
      },
      {
        id: 'archive-other-grant',
        accountId: 'archive-outside-hr',
        role: 'hr',
        scope: 'cohort',
        cohortId: 'archive-other-cohort',
        validFrom: '2026-01-01',
      },
    ]);
  await db().insert(enrollments).values({
    id: 'archive-enrollment',
    cohortId: 'archive-cohort',
    personId: 'p-x08',
    confirmed: true,
    validFrom: '2026-01-01',
  });
  await db().insert(employments).values({
    id: 'archive-employment',
    organizationId: 'archive-org',
    personId: 'p-x08',
    validFrom: '2025-01-01',
  });
  await importInterviewImportDemo(db(), process.cwd());
  await db().insert(evaluationRelations).values({
    id: 'archive-real-evaluator',
    evaluationNodeId: INTERVIEW_IMPORT_DEMO.node.id,
    evaluatorId: 'p-yeqing',
    personId: 'p-x08',
    kind: 'interviewer',
    validFrom: '2026-01-01T00:00:00Z',
  });
}, 60_000);
afterEach(async () => {
  await connection?.close();
}, 30_000);

it('the existing person query returns the true archive, separate signatures and canonical field sources; repeated confirmation is one write', async () => {
  const before = await stored('campus-1');
  expect(await confirm('campus-1')).toMatchObject({
    status: 'ok',
    revision: 2,
  });
  const profile = await readPersonForCurrentUser({ id: 'p-x08' });
  expect(profile.status).toBe('success');
  if (
    profile.status !== 'success' ||
    profile.interviewArchive?.status !== 'ready'
  )
    throw new Error('Existing person query must include the archive');
  const archive = profile.interviewArchive.data[0];
  expect(archive).toMatchObject({
    interviewerName: '任辞远（演示）',
    importedByName: '苏晚（演示）',
    interviewerConfirmedInSystem: false,
    importedAt: now,
  });
  expect(archive.scale).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        item: '专业能力',
        value: '2',
        origin: 'parser',
      }),
    ]),
  );
  const score = archive.scale.find((item) => item.item === '专业能力')!;
  const source = await readMaterialSource(
    db(),
    'archive-hr',
    {
      fragmentId: score.sources[0].fragmentId,
      originalVersionId: score.sources[0].originalVersionId,
    },
    () => now,
  );
  expect(source.status).toBe('success');
  if (
    source.status !== 'success' ||
    before.parsed.status === 'rejected' ||
    source.source.location.kind !== 'pdf'
  )
    throw new Error('Canonical PDF source missing');
  const location = source.source.location;
  expect(source.source.excerpt).toBe(
    before.parsed.pageTexts
      .find((page) => page.page === location.page)!
      .text.slice(location.textRange.start, location.textRange.end),
  );
  expect(source.source.sourceCategory).toBe('historical_evaluation');
  expect((await stored('campus-1')).parsed).toEqual(before.parsed);
  const saved = {
    history: await histories(),
    archive: await archives(),
    operations: await operations(),
  };
  expect(await confirm('campus-1')).toMatchObject({
    status: 'ok',
    revision: 2,
  });
  expect({
    history: await histories(),
    archive: await archives(),
    operations: await operations(),
  }).toEqual(saved);
  expect(saved.history).toHaveLength(1);
  expect(saved.history[0].recorderId).toBe('s-01');
  expect(
    await fillInterviewImportRow(
      db(),
      'archive-hr',
      {
        batchId,
        rowId: 'campus-1',
        expectedRevision: 2,
        item: '专业能力',
        value: '5',
      },
      clock,
    ),
  ).toMatchObject({ status: 'conflict' });
  expect(await operations()).toEqual(saved.operations);
});

it('HR entries remain separate; explicit revert hides the archive without erasing it, and current-row confirmation restores it', async () => {
  const row = await stored('score-missing-1');
  if (row.parsed.status === 'rejected')
    throw new Error('Expected parsed synthetic file');
  const item = unreadInterviewItems(row.parsed.reviews[row.reviewIndex])[0];
  expect(
    await fillInterviewImportRow(
      db(),
      'archive-hr',
      {
        batchId,
        rowId: row.rowId,
        expectedRevision: 1,
        item: item.item,
        value: '5',
      },
      clock,
    ),
  ).toMatchObject({ status: 'ok', revision: 2 });
  expect(await confirm(row.rowId, 2)).toMatchObject({
    status: 'ok',
    revision: 3,
  });
  const projection = await personInterviewArchiveFromData(
    await loadPersonData(db(), 'archive-hr', now),
    'p-x08',
  );
  expect(projection?.status).toBe('ready');
  if (projection?.status !== 'ready') throw new Error('Archive missing');
  expect(
    projection.data[0].scale.find((entry) => entry.item === item.item),
  ).toMatchObject({ value: '5', origin: 'hr_entry' });
  expect((await stored(row.rowId)).parsed).toEqual(row.parsed);
  const first = (await histories())[0];
  expect(await confirm(row.rowId, 3, false)).toMatchObject({
    status: 'ok',
    revision: 4,
  });
  expect(
    await personInterviewArchiveFromData(
      await loadPersonData(db(), 'archive-hr', now),
      'p-x08',
    ),
  ).toEqual({ status: 'empty' });
  expect(await histories()).toEqual([first]);
  expect((await archives())[0]).toMatchObject({
    withdrawnAt: expect.any(String),
    withdrawalAuditId: expect.any(String),
  });
  expect(await confirm(row.rowId, 3)).toMatchObject({ status: 'conflict' });
  expect(await confirm(row.rowId, 4)).toMatchObject({
    status: 'ok',
    revision: 5,
  });
  expect(await histories()).toHaveLength(2);
  expect(
    (await archives()).filter((entry) => entry.withdrawnAt === null),
  ).toHaveLength(1);
  expect(await operations()).toHaveLength(4);
});

it('a changed original interviewer association cannot silently restore a withdrawn import', async () => {
  expect(await confirm('campus-1')).toHaveProperty('status', 'ok');
  expect(await confirm('campus-1', 2, false)).toHaveProperty('status', 'ok');
  await db()
    .update(people)
    .set({ name: '已改名的演示面试官' })
    .where(eq(people.id, 's-01'));
  expect(await confirm('campus-1', 3)).toHaveProperty('status', 'conflict');
  expect(await histories()).toHaveLength(1);
  expect((await archives()).every((entry) => entry.withdrawnAt !== null)).toBe(
    true,
  );
  expect(await operations()).toHaveLength(2);
});

it('concurrent rows with the same interview identity archive once and roll back the losing confirmation', async () => {
  const row = await stored('campus-1');
  await db()
    .insert(interviewImportRows)
    .values({ ...row, rowId: 'campus-duplicate', ordinal: 99 });
  const results = await Promise.all([
    confirm('campus-1'),
    confirm('campus-duplicate'),
  ]);
  expect(results.filter((result) => result.status === 'ok')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'conflict')).toHaveLength(
    1,
  );
  expect(await histories()).toHaveLength(1);
  expect(await archives()).toHaveLength(1);
  expect(await operations()).toHaveLength(1);
  const rows = [await stored('campus-1'), await stored('campus-duplicate')];
  expect(rows.map((entry) => entry.revision).sort()).toEqual([1, 2]);
});

it('real evaluator/employee and out-of-scope HR are denied; revoked HR cannot replay; source scores do not leak', async () => {
  for (const account of ['archive-evaluator', 'archive-employee'])
    expect(await confirm('campus-1', 1, true, account)).toHaveProperty(
      'status',
      'forbidden',
    );
  const outside = await confirm('campus-1', 1, true, 'archive-outside-hr');
  expect(outside).toEqual(
    await confirm('missing', 1, true, 'archive-outside-hr'),
  );
  expect(outside).toHaveProperty('status', 'not_found');
  expect(await histories()).toEqual([]);
  expect(await operations()).toEqual([]);
  expect(await confirm('campus-1')).toHaveProperty('status', 'ok');
  const history = (await histories())[0];
  session.accountId = 'archive-evaluator';
  const profile = await readPersonForCurrentUser({ id: 'p-x08' });
  expect(profile.status).toBe('success');
  expect(profile).not.toHaveProperty('interviewArchive');
  expect(
    await readMaterialSource(
      db(),
      'archive-evaluator',
      {
        fragmentId: history.fragmentId,
        originalVersionId: history.originalVersionId,
      },
      () => now,
    ),
  ).toHaveProperty('status', 'not_found');
  await db()
    .update(grants)
    .set({ revokedAt: now })
    .where(eq(grants.id, 'archive-hr-grant'));
  expect(await confirm('campus-1')).toHaveProperty('status', 'forbidden');
  expect(await operations()).toHaveLength(1);
});

it('unknown interviewers and nonemployees do not archive; failed canonical publication rolls back the whole confirmation', async () => {
  expect(await confirm('unknown-interviewer-1')).toHaveProperty(
    'status',
    'conflict',
  );
  await db()
    .delete(employments)
    .where(eq(employments.id, 'archive-employment'));
  expect(await confirm('campus-1')).toHaveProperty('status', 'conflict');
  await db().insert(employments).values({
    id: 'archive-employment',
    organizationId: 'archive-org',
    personId: 'p-x08',
    validFrom: '2025-01-01',
  });
  const before = await stored('campus-1');
  await db()
    .update(materialParses)
    .set({ resultDigest: '0'.repeat(64) })
    .where(eq(materialParses.id, before.parseVersionId));
  const beforeFragments = await db().select().from(fragments);
  await expect(confirm('campus-1')).rejects.toThrow('parser receipt');
  expect(await stored('campus-1')).toEqual(before);
  expect(await histories()).toEqual([]);
  expect(await operations()).toEqual([]);
  expect(await db().select().from(fragments)).toEqual(beforeFragments);
  await db()
    .update(interviewImportCandidates)
    .set({ status: 'rejected' })
    .where(eq(interviewImportCandidates.batchId, batchId));
  expect(await confirm('campus-1')).toHaveProperty('status', 'ok');
  expect((await stored('campus-1')).decision).toMatchObject({
    status: 'skipped',
    reason: 'not_hired',
  });
  expect(await histories()).toEqual([]);
});
