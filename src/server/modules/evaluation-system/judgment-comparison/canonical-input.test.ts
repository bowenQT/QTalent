import { describe, expect, it } from 'vitest';
import {
  canonicalInputFiles,
  canonicalComparisonJson,
  CanonicalComparisonError,
  validateCanonicalComparisonImport,
  type CanonicalComparisonImport,
} from './canonical-input';

export function canonicalFixture(): CanonicalComparisonImport {
  const source = (side: string) => ({
    fragmentId: `${side}-row`,
    originalVersionId: `${side}-version`,
    rowPersonId: 'person',
    row: 2,
  });
  return {
    batch: {
      id: 'batch',
      name: '对照（演示）',
      cohortId: 'cohort',
      mappingVersionId: 'map-xe-select-v1',
      sourceCommit: 'a'.repeat(40),
      contractSha: 'b'.repeat(40),
      fixtureVersion: 'bow-923-v2',
      inputFileHashes: Object.fromEntries(
        canonicalInputFiles.map((path) => [path, 'c'.repeat(64)]),
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
      confirmedAt: '2026-01-01T00:00:00Z',
      sourceCommit: 'a'.repeat(40),
      sourceFileSha256: 'c'.repeat(64),
      nature: 'demo_human_confirmation',
    },
    cases: [
      {
        id: 'case',
        personId: 'person',
        judgment: { id: 'judgment', name: '选拔与结营（演示）' },
        frontNodeId: 'front',
        backNodeId: 'back',
        work: { kind: 'individual', workId: 'work' },
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
        reason: '任务范围不同（演示）',
        markedById: 'hr',
        markedAt: '2026-06-01T00:00:00.000003Z',
        sourceFileSha256: 'c'.repeat(64),
        nature: 'demo_human_mark',
      },
    ],
  };
}

describe('canonical comparison immutable input', () => {
  it('preserves independent raw facts and full timestamp precision without outcomes', () => {
    const input = canonicalFixture();
    expect(validateCanonicalComparisonImport(input)).toEqual(input);
    expect(JSON.stringify(input)).not.toContain('outcome');
  });
  it('keeps distinct judgments for the same person instead of taking a last row', () => {
    const input = canonicalFixture();
    const next = structuredClone(input.cases[0]);
    next.id = 'case-2';
    for (const side of ['front', 'back'] as const)
      if (next[side].state === 'present') next[side].judgmentId += '-2';
    input.cases.push(next);
    input.batch.inputCaseCount = 2;
    expect(validateCanonicalComparisonImport(input).cases).toHaveLength(2);
  });
  it('accepts only an explicit missing stage, retaining a real explanation reference when present', () => {
    const input = canonicalFixture();
    input.manualMarks = [];
    input.cases[0].back = {
      state: 'missing',
      reason: '尚未取得（演示）',
      source: input.cases[0].back.source,
    };
    expect(validateCanonicalComparisonImport(input).cases[0].back.state).toBe(
      'missing',
    );
    input.cases[0].back.source = null;
    expect(
      validateCanonicalComparisonImport(input).cases[0].back.source,
    ).toBeNull();
  });
  const mutations: [string, (input: CanonicalComparisonImport) => void][] = [
    [
      'count mismatch',
      (v) => {
        v.batch.inputCaseCount = 2;
      },
    ],
    [
      'wrong mapping',
      (v) => {
        v.batch.mappingVersionId = 'map-xe-select-v2';
      },
    ],
    [
      'mapping provenance mismatch',
      (v) => {
        v.mapping.sourceFileSha256 = 'd'.repeat(64);
      },
    ],
    [
      'duplicate mapping grade',
      (v) => {
        v.mapping.rows[1].frontGrade = v.mapping.rows[0].frontGrade;
      },
    ],
    [
      'duplicate mapping position',
      (v) => {
        v.mapping.rows[1].frontPosition = v.mapping.rows[0].frontPosition;
      },
    ],
    [
      'duplicate mapping back grade',
      (v) => {
        v.mapping.rows[1].backGrade = v.mapping.rows[0].backGrade;
      },
    ],
    [
      'same nodes',
      (v) => {
        v.cases[0].backNodeId = v.cases[0].frontNodeId;
      },
    ],
    [
      'wrong row person',
      (v) => {
        v.cases[0].front.source!.rowPersonId = 'other';
      },
    ],
    [
      'same original',
      (v) => {
        v.cases[0].back.source!.originalVersionId =
          v.cases[0].front.source!.originalVersionId;
      },
    ],
    [
      'same fragment',
      (v) => {
        v.cases[0].back.source!.fragmentId =
          v.cases[0].front.source!.fragmentId;
      },
    ],
    [
      'reused judgment',
      (v) => {
        if (
          v.cases[0].back.state === 'present' &&
          v.cases[0].front.state === 'present'
        )
          v.cases[0].back.judgmentId = v.cases[0].front.judgmentId;
      },
    ],
    [
      'wrong selection category',
      (v) => {
        if (v.cases[0].front.state === 'present')
          v.cases[0].front.sourceStandardReference = 'rubric-v1';
      },
    ],
    [
      'unknown mark target',
      (v) => {
        v.manualMarks[0].caseId = 'unknown';
      },
    ],
    [
      'mark wrong batch',
      (v) => {
        v.manualMarks[0].batchId = 'other';
      },
    ],
    [
      'mark wrong person',
      (v) => {
        v.manualMarks[0].personId = 'other';
      },
    ],
    [
      'mark wrong node',
      (v) => {
        v.manualMarks[0].frontNodeId = 'other';
      },
    ],
    [
      'mark wrong provenance',
      (v) => {
        v.manualMarks[0].sourceFileSha256 = 'd'.repeat(64);
      },
    ],
    [
      'mark before judgment by a microsecond',
      (v) => {
        v.manualMarks[0].markedAt = '2026-06-01T00:00:00.000001Z';
      },
    ],
    [
      'mark before judgment second',
      (v) => {
        v.manualMarks[0].markedAt = '2026-05-31T23:59:59Z';
      },
    ],
    [
      'mark on missing stage',
      (v) => {
        v.cases[0].back = { state: 'missing', reason: '未知', source: null };
      },
    ],
    [
      'duplicate mark ID',
      (v) => {
        v.manualMarks.push(structuredClone(v.manualMarks[0]));
      },
    ],
    [
      'duplicate target mark',
      (v) => {
        v.manualMarks.push({ ...v.manualMarks[0], id: 'mark2' });
      },
    ],
    [
      'duplicate case',
      (v) => {
        v.cases.push(structuredClone(v.cases[0]));
        v.batch.inputCaseCount = 2;
      },
    ],
    [
      'whitespace identity',
      (v) => {
        v.cases[0].personId = ' person ';
      },
    ],
    [
      'silent public shape normalization',
      (v) => {
        v.cases[0].work.workId = ' work ';
      },
    ],
  ];
  it.each(mutations)('rejects %s', (_, change) => {
    const input = canonicalFixture();
    change(input);
    expect(() => validateCanonicalComparisonImport(input)).toThrow(
      'comparison_invalid_input',
    );
  });
  it('rejects expected results, node-kind guesses, forged grants and missing file lineage', () => {
    const base = canonicalFixture();
    for (const key of [
      'outcome',
      'counts',
      'currentGrant',
      'selectionStandardVersionId',
    ])
      expect(() =>
        validateCanonicalComparisonImport({ ...base, [key]: [] }),
      ).toThrow(CanonicalComparisonError);
    expect(() =>
      validateCanonicalComparisonImport({
        ...base,
        cases: [{ ...base.cases[0], nodeKind: 'interview' }],
      }),
    ).toThrow(CanonicalComparisonError);
    const files = {
      ...base.batch.inputFileHashes,
      'tests/fixtures/bow-923/expected-results.json': 'c'.repeat(64),
    };
    expect(() =>
      validateCanonicalComparisonImport({
        ...base,
        batch: { ...base.batch, inputFileHashes: files },
      }),
    ).toThrow(CanonicalComparisonError);
    expect(() =>
      validateCanonicalComparisonImport({
        ...base,
        batch: { ...base.batch, inputFileHashes: {} },
      }),
    ).toThrow(CanonicalComparisonError);
  });
  it('canonicalizes record key/row ordering but does not mutate the caller', () => {
    const input = canonicalFixture();
    input.mapping.rows.reverse();
    const before = structuredClone(input);
    const actual = validateCanonicalComparisonImport(input);
    expect(input).toEqual(before);
    expect(actual.mapping.rows.map((r) => r.frontPosition)).toEqual([
      'highest',
      'middle',
      'just_passed',
    ]);
    expect(canonicalComparisonJson({ b: 1, a: [true, null] })).toBe(
      canonicalComparisonJson({ a: [true, null], b: 1 }),
    );
    for (const bad of [NaN, Infinity, undefined, new Date()])
      expect(() => canonicalComparisonJson(bad)).toThrow(
        CanonicalComparisonError,
      );
  });
  it('does not disclose invalid input in its error', () => {
    expect(() =>
      validateCanonicalComparisonImport({ privateValue: 'do-not-disclose' }),
    ).toThrow(/^comparison_invalid_input$/);
  });
});
