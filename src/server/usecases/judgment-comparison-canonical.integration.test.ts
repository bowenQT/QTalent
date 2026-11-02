import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';
import { createDatabase } from '@/server/db/client';
import { organizations, people } from '../modules/directory';
import {
  cohorts,
  evaluationNodes,
  evaluationNodeSubjects,
} from '../modules/programs';
import { originals, originalVersions, fragments } from '../modules/records';
import { ruleVersions } from '../modules/evaluation-system';
import {
  canonicalInputFiles,
  type CanonicalComparisonImport,
} from '../modules/evaluation-system';
import {
  readCanonicalComparisonBatch,
  writeCanonicalComparisonBatch,
} from './judgment-comparison-canonical';

// Real DB tests. No fake store, conditional skips or test-owned DDL. X1's native
// migrations (including 918 and the five canonical tables) are a prerequisite.
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
let created = false;
const databaseName = `qtalent_comparison_${randomUUID().replaceAll('-', '')}_test`;
const db = () => {
  if (!connection) throw new Error('Real comparison database unavailable');
  return connection.db;
};
const hash = 'c'.repeat(64);
const commit = 'a'.repeat(40);
function fixture(): CanonicalComparisonImport {
  const source = (side: string) => ({
    fragmentId: side + '-row',
    originalVersionId: side + '-version',
    rowPersonId: 'person',
    row: 2,
  });
  return {
    batch: {
      id: 'batch',
      name: '对照（演示）',
      cohortId: 'cohort',
      mappingVersionId: 'map-xe-select-v1',
      sourceCommit: commit,
      contractSha: 'b'.repeat(40),
      fixtureVersion: 'bow-923-v2',
      inputFileHashes: Object.fromEntries(
        canonicalInputFiles.map((path) => [path, hash]),
      ) as CanonicalComparisonImport['batch']['inputFileHashes'],
      inputCaseCount: 1,
      nature: 'demo_rebuilt',
    },
    mapping: {
      versionId: 'map-xe-select-v1',
      frontScaleId: 'selection',
      backScaleId: 'graduation',
      rows: [
        { frontGrade: '高', frontPosition: 'highest', backGrade: '建议留用' },
        { frontGrade: '中', frontPosition: 'middle', backGrade: '继续观察' },
        { frontGrade: '低', frontPosition: 'just_passed', backGrade: '不建议' },
      ],
      confirmedById: 'hr',
      confirmedAt: '2026-01-01T00:00:00.000001Z',
      sourceCommit: commit,
      sourceFileSha256: hash,
      nature: 'demo_human_confirmation',
    },
    cases: [
      {
        id: 'case',
        personId: 'person',
        judgment: { id: 'judgment', name: '原表对照（演示）' },
        frontNodeId: 'front',
        backNodeId: 'back',
        work: { kind: 'team', workId: 'work', teamId: 'team' },
        front: {
          state: 'present',
          source: source('front'),
          judgmentId: 'front-judgment',
          sourceStandardReference: 'xe-select-v1',
          scaleId: 'selection',
          grade: '高',
          evaluatorId: 'rater',
          evaluatedAt: '2026-02-01T00:00:00.000001Z',
          confirmation: 'human_confirmed',
        },
        back: {
          state: 'present',
          source: source('back'),
          judgmentId: 'back-judgment',
          sourceStandardReference: 'graduation-v1',
          scaleId: 'graduation',
          grade: '不建议',
          evaluatorId: 'rater',
          evaluatedAt: '2026-06-01T00:00:00.000002Z',
          confirmation: 'human_confirmed',
        },
      },
    ],
    manualMarks: [
      {
        id: 'mark',
        caseId: 'case',
        batchId: 'batch',
        personId: 'person',
        frontNodeId: 'front',
        backNodeId: 'back',
        reason: '工作边界改变（演示）',
        markedById: 'hr',
        markedAt: '2026-06-01T00:00:00.000003Z',
        sourceFileSha256: hash,
        nature: 'demo_human_mark',
      },
    ],
  };
}
const write = (input: unknown) =>
  db().transaction((tx) => writeCanonicalComparisonBatch(tx, input));
const read = (id = 'batch') =>
  db().transaction((tx) => readCanonicalComparisonBatch(tx, id));
async function counts() {
  const result = await db().execute<{
    batches: number;
    cases: number;
    stages: number;
    marks: number;
    maps: number;
  }>(sql`select
    (select count(*)::integer from evaluation_comparison_batches) batches,
    (select count(*)::integer from evaluation_comparison_cases) cases,
    (select count(*)::integer from evaluation_comparison_stages) stages,
    (select count(*)::integer from evaluation_comparison_manual_marks) marks,
    (select count(*)::integer from evaluation_comparison_mappings) maps`);
  return result.rows[0];
}
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source) throw new Error('TEST_DATABASE_URL required; no fake or skip');
  const url = new URL(source);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Isolated loopback _test database required');
  admin = new Pool({ connectionString: source, max: 2 });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  url.pathname = '/' + databaseName;
  connection = createDatabase(url.toString());
  // Optional path is operator-controlled X1 drizzle output, never inline SQL.
  await migrate(db(), {
    migrationsFolder: 'src/server/db/migrations',
  });
  await counts();
}, 30_000);
afterAll(async () => {
  await connection?.pool.end();
  if (admin) {
    try {
      if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
    } finally {
      await admin.end();
    }
  }
});
beforeEach(async () => {
  await db().execute(sql`delete from evaluation_comparison_manual_marks`);
  await db().execute(sql`delete from evaluation_comparison_stages`);
  await db().execute(sql`delete from evaluation_comparison_cases`);
  await db().execute(sql`delete from evaluation_comparison_batches`);
  await db().execute(sql`delete from evaluation_comparison_mappings`);
  await db().delete(fragments);
  await db().delete(originalVersions);
  await db().delete(originals);
  await db().delete(evaluationNodeSubjects);
  await db().delete(evaluationNodes);
  await db().execute(sql`delete from evaluation_selection_cohort_bindings`);
  await db().execute(sql`delete from evaluation_selection_version_content`);
  await db().delete(ruleVersions);
  await db().delete(cohorts);
  await db().delete(people);
  await db().delete(organizations);
  await db()
    .insert(organizations)
    .values({ id: 'org', name: '演示组织', shortName: '演示' });
  await db()
    .insert(people)
    .values(
      ['person', 'hr', 'rater'].map((id) => ({
        id,
        name: id + '（演示）',
        organizationId: 'org',
        demo: true,
      })),
    );
  await db()
    .insert(cohorts)
    .values({ id: 'cohort', name: '合成持久化测试期（演示）' });
  // Deliberately synthetic legal nodes, NOT a mapping of the real 923 nodes.
  await db()
    .insert(evaluationNodes)
    .values([
      {
        id: 'front',
        name: '合成面试节点（演示）',
        kind: 'interview',
        cohortId: 'cohort',
      },
      {
        id: 'back',
        name: '合成答辩节点（演示）',
        kind: 'defense',
        cohortId: 'cohort',
      },
    ]);
  await db()
    .insert(evaluationNodeSubjects)
    .values(
      ['front', 'back'].map((evaluationNodeId) => ({
        evaluationNodeId,
        personId: 'person',
      })),
    );
  await db()
    .insert(ruleVersions)
    .values({ id: 'xe-select-v1', provenance: 'published' });
  const content = JSON.stringify({
    reviewPoints: [
      { id: 'point', title: '作品（演示）', description: '演示要点' },
    ],
  });
  const binding = JSON.stringify({
    cohort: { id: 'cohort', name: '合成持久化测试期（演示）' },
    standardVersionId: 'xe-select-v1',
    boundAt: '2026-01-01T00:00:00Z',
  });
  await db()
    .execute(sql`insert into evaluation_selection_version_content(version_id,content,origin,source_reference,recorded_at)
    values ('xe-select-v1',${content}::jsonb,'baseline','synthetic-store-test','2026-01-01T00:00:00Z')`);
  await db()
    .execute(sql`insert into evaluation_selection_cohort_bindings(cohort_id,version_id,binding,bound_at)
    values ('cohort','xe-select-v1',${binding}::jsonb,'2026-01-01T00:00:00Z')`);
  for (const [side, path] of [
    ['front', canonicalInputFiles[6]],
    ['back', canonicalInputFiles[7]],
  ] as const) {
    await db()
      .insert(originals)
      .values({
        id: side + '-original',
        title: side + '（演示）',
        kind: 'original',
        displayNotice: '化名重建的演示原表',
      });
    await db()
      .insert(originalVersions)
      .values({
        id: side + '-version',
        originalId: side + '-original',
        version: 1,
        contentDigest: hash,
        sourceCommit: commit,
        sourcePath: path,
      });
    await db()
      .insert(fragments)
      .values({
        id: side + '-row',
        originalVersionId: side + '-version',
        location: { kind: 'spreadsheet', sheet: '演示', cell: 'A2:P2' },
        excerpt: '该原件独有的片段正文（演示）',
      });
  }
});

describe('canonical comparison native transactions', () => {
  it('persists raw facts with independent sources and full original precision', async () => {
    const input = fixture();
    input.cases[0].work = { kind: 'individual', workId: 'work' };
    const result = await write(input);
    expect(result.status).toBe('inserted');
    const actual = await read();
    expect(actual?.facts).toEqual(input);
    expect(actual?.selectionStandardVersionId).toBe('xe-select-v1');
    expect(await counts()).toEqual({
      batches: 1,
      cases: 1,
      stages: 2,
      marks: 1,
      maps: 1,
    });
    const text = JSON.stringify(actual);
    for (const forbidden of [
      'excerpt',
      'location',
      'href',
      'sourcePath',
      'confirmedAttributions',
      'outcome',
      'counts',
      '该原件独有的片段正文',
    ])
      expect(text).not.toContain(forbidden);
    // The store creates no current role/relationship or formal evaluation rows.
    const untouched = await db().execute<{
      roles: number;
      events: number;
      history: number;
    }>(sql`select
      (select count(*)::integer from directory_grants) roles,
      (select count(*)::integer from records_events) events,
      (select count(*)::integer from records_historical_evaluations) history`);
    expect(untouched.rows[0]).toEqual({ roles: 0, events: 0, history: 0 });
  });
  it('serializes concurrent identical imports and preserves first importedAt', async () => {
    const input = fixture();
    const results = await Promise.all([write(input), write(input)]);
    expect(results.map((r) => r.status).sort()).toEqual([
      'inserted',
      'unchanged',
    ]);
    const before = await read();
    expect((await write(input)).status).toBe('unchanged');
    expect(await read()).toEqual(before);
  });
  it('rejects concurrent same-key different facts', async () => {
    const a = fixture(),
      b = fixture();
    b.cases[0].judgment.name = '不同判断（演示）';
    const results = await Promise.allSettled([write(a), write(b)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await counts()).toEqual({
      batches: 1,
      cases: 1,
      stages: 2,
      marks: 1,
      maps: 1,
    });
  });
  it('rolls back original registration and all five writes with the caller', async () => {
    await expect(
      db().transaction(async (tx) => {
        await tx
          .insert(originals)
          .values({ id: 'new-original', title: '新增（演示）' });
        await writeCanonicalComparisonBatch(tx, fixture());
        throw new Error('intentional rollback');
      }),
    ).rejects.toThrow('intentional rollback');
    expect(await read()).toBeNull();
    expect(await counts()).toEqual({
      batches: 0,
      cases: 0,
      stages: 0,
      marks: 0,
      maps: 0,
    });
    expect(
      await db()
        .select()
        .from(originals)
        .where(eq(originals.id, 'new-original')),
    ).toHaveLength(0);
  });
  it('rolls back a batch inserted before a late case identity collision', async () => {
    await write(fixture());
    const other = fixture();
    other.batch.id = 'other-batch';
    other.manualMarks[0].batchId = 'other-batch';
    await expect(write(other)).rejects.toThrow();
    expect(await read('other-batch')).toBeNull();
    expect(await counts()).toEqual({
      batches: 1,
      cases: 1,
      stages: 2,
      marks: 1,
      maps: 1,
    });
  });
  it('keeps two judgments for one person without taking a latest row', async () => {
    const input = fixture();
    const unit = structuredClone(input.cases[0]);
    unit.id = 'case-2';
    unit.judgment.id = 'judgment-2';
    for (const side of ['front', 'back'] as const) {
      const stage = unit[side];
      if (stage.state === 'present') stage.judgmentId += '-2';
    }
    input.cases.push(unit);
    input.batch.inputCaseCount = 2;
    await write(input);
    expect((await read())?.facts.cases).toHaveLength(2);
  });
  it('stores explicit missing with and without an explanation source', async () => {
    const input = fixture();
    input.manualMarks = [];
    input.cases[0].front = {
      state: 'missing',
      reason: '尚无前段（演示）',
      source: input.cases[0].front.source,
    };
    input.cases[0].back = {
      state: 'missing',
      reason: '尚无后段（演示）',
      source: null,
    };
    await write(input);
    expect((await read())?.facts).toEqual(input);
  });
  it('allows a batch with both stages explicitly absent and no source rows', async () => {
    const input = fixture();
    input.manualMarks = [];
    input.cases[0].front = {
      state: 'missing',
      reason: '无前段（演示）',
      source: null,
    };
    input.cases[0].back = {
      state: 'missing',
      reason: '无后段（演示）',
      source: null,
    };
    await write(input);
    expect((await read())?.facts).toEqual(input);
  });
  it('rejects a missing fragment or mismatched original version without writes', async () => {
    const input = fixture();
    input.cases[0].front.source!.fragmentId = 'absent-fragment';
    await expect(write(input)).rejects.toThrow('comparison_invalid_reference');
    input.cases[0].front.source!.fragmentId = 'front-row';
    input.cases[0].front.source!.originalVersionId = 'absent-version';
    await expect(write(input)).rejects.toThrow('comparison_invalid_reference');
    expect(await counts()).toEqual({
      batches: 0,
      cases: 0,
      stages: 0,
      marks: 0,
      maps: 0,
    });
  });
  it('rejects a signer who is not in the actual directory', async () => {
    const input = fixture();
    input.mapping.confirmedById = 'unknown-signer';
    await expect(write(input)).rejects.toThrow('comparison_invalid_reference');
  });
  it('detects actual fragment row movement after import', async () => {
    await write(fixture());
    await db()
      .update(fragments)
      .set({ location: { kind: 'spreadsheet', sheet: '演示', cell: 'A3:P3' } })
      .where(eq(fragments.id, 'front-row'));
    await expect(read()).rejects.toThrow('comparison_incomplete');
  });
  it('detects a deleted stage instead of inventing a missing state', async () => {
    await write(fixture());
    await db().execute(
      sql`delete from evaluation_comparison_stages where side='back'`,
    );
    await expect(read()).rejects.toThrow('comparison_incomplete');
  });
  it('detects a missing manual mark instead of changing the computed outcome', async () => {
    await write(fixture());
    await db().execute(sql`delete from evaluation_comparison_manual_marks`);
    await expect(read()).rejects.toThrow('comparison_incomplete');
  });
  it('detects source-body and row drift without returning the changed content', async () => {
    await write(fixture());
    await db()
      .update(fragments)
      .set({ excerpt: '内容漂移（演示）' })
      .where(eq(fragments.id, 'front-row'));
    await expect(read()).rejects.toThrow('comparison_incomplete');
  });
  const invalidSources: [string, () => Promise<unknown>][] = [
    [
      'malformed cell',
      () =>
        db()
          .update(fragments)
          .set({
            location: {
              kind: 'spreadsheet',
              sheet: '演示',
              cell: 'not-a-cell',
            },
          })
          .where(eq(fragments.id, 'front-row')),
    ],
    [
      'column out of XLSX range',
      () =>
        db()
          .update(fragments)
          .set({
            location: { kind: 'spreadsheet', sheet: '演示', cell: 'XFE2' },
          })
          .where(eq(fragments.id, 'front-row')),
    ],
    [
      'row out of XLSX range',
      () =>
        db()
          .update(fragments)
          .set({
            location: { kind: 'spreadsheet', sheet: '演示', cell: 'A1048577' },
          })
          .where(eq(fragments.id, 'front-row')),
    ],
    [
      'wrong commit',
      () =>
        db()
          .update(originalVersions)
          .set({ sourceCommit: 'd'.repeat(40) })
          .where(eq(originalVersions.id, 'front-version')),
    ],
    [
      'wrong digest',
      () =>
        db()
          .update(originalVersions)
          .set({ contentDigest: 'd'.repeat(64) })
          .where(eq(originalVersions.id, 'front-version')),
    ],
    [
      'wrong path',
      () =>
        db()
          .update(originalVersions)
          .set({ sourcePath: canonicalInputFiles[7] })
          .where(eq(originalVersions.id, 'front-version')),
    ],
    [
      'snapshot original',
      () =>
        db()
          .update(originals)
          .set({ kind: 'prototype_snapshot' })
          .where(eq(originals.id, 'front-original')),
    ],
    [
      'no demo declaration',
      () =>
        db()
          .update(originals)
          .set({ displayNotice: null })
          .where(eq(originals.id, 'front-original')),
    ],
    [
      'cross-row range',
      () =>
        db()
          .update(fragments)
          .set({
            location: { kind: 'spreadsheet', sheet: '演示', cell: 'A2:P3' },
          })
          .where(eq(fragments.id, 'front-row')),
    ],
    [
      'wrong row',
      () =>
        db()
          .update(fragments)
          .set({
            location: { kind: 'spreadsheet', sheet: '演示', cell: 'A3:P3' },
          })
          .where(eq(fragments.id, 'front-row')),
    ],
    [
      'reversed range',
      () =>
        db()
          .update(fragments)
          .set({
            location: { kind: 'spreadsheet', sheet: '演示', cell: 'P2:A2' },
          })
          .where(eq(fragments.id, 'front-row')),
    ],
    [
      'non spreadsheet',
      () =>
        db()
          .update(fragments)
          .set({ location: { kind: 'document', paragraph: '演示' } })
          .where(eq(fragments.id, 'front-row')),
    ],
    [
      'missing binding',
      () => db().execute(sql`delete from evaluation_selection_cohort_bindings`),
    ],
    [
      'wrong node cohort',
      () =>
        db()
          .update(evaluationNodes)
          .set({ cohortId: null })
          .where(eq(evaluationNodes.id, 'front')),
    ],
    [
      'missing subject',
      () =>
        db()
          .delete(evaluationNodeSubjects)
          .where(eq(evaluationNodeSubjects.evaluationNodeId, 'front')),
    ],
  ];
  it.each(invalidSources)('fails closed on %s', async (_, change) => {
    await change();
    await expect(write(fixture())).rejects.toThrow(
      'comparison_invalid_reference',
    );
    expect(await counts()).toEqual({
      batches: 0,
      cases: 0,
      stages: 0,
      marks: 0,
      maps: 0,
    });
  });
  it('rejects a caller-supplied front version different from the real binding', async () => {
    const input = fixture();
    if (input.cases[0].front.state === 'present')
      input.cases[0].front.sourceStandardReference = 'xe-select-v2';
    await expect(write(input)).rejects.toThrow('comparison_invalid_reference');
  });
  it('rejects two versions of the same original as independent stages', async () => {
    await db()
      .update(originalVersions)
      .set({ originalId: 'front-original', version: 2 })
      .where(eq(originalVersions.id, 'back-version'));
    await expect(write(fixture())).rejects.toThrow(
      'comparison_invalid_reference',
    );
  });
  it('does not silently update a shared mapping version for a different batch', async () => {
    await write(fixture());
    const input = fixture();
    input.batch.id = 'second';
    input.cases[0].id = 'second-case';
    input.manualMarks = [];
    input.mapping.confirmedAt = '2026-01-02T00:00:00Z';
    await expect(write(input)).rejects.toThrow('comparison_conflict');
    expect(await read('second')).toBeNull();
  });
  it('propagates SQL failure and never changes it to an absent batch', async () => {
    await expect(
      db().transaction(async (tx) => {
        await tx.execute(sql`set local search_path to pg_catalog`);
        return readCanonicalComparisonBatch(tx, 'batch');
      }),
    ).rejects.toThrow();
    expect(await read()).toBeNull();
  });
});
