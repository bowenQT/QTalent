import { describe, expect, it } from 'vitest';
import { calculateComparison, summarizeComparisons } from './calculation';
import { ComparisonInputError } from './ports';
import { dataset, facts, mapping } from './test-fixtures';

describe('原量表对照计算', () => {
  it.each([
    ['高分档', '不建议', { state: 'front_higher', bands: 2 }],
    ['高分档', '继续观察', { state: 'front_higher', bands: 1 }],
    ['刚过线档', '建议留用', { state: 'front_lower', bands: 2 }],
    ['刚过线档', '继续观察', { state: 'front_lower', bands: 1 }],
    ['高分档', '建议留用', { state: 'consistent' }],
    ['刚过线档', '不建议', { state: 'consistent' }],
    ['中间档', '不建议', { state: 'middle_distribution', backGrade: '不建议' }],
    [
      '中间档',
      '继续观察',
      { state: 'middle_distribution', backGrade: '继续观察' },
    ],
    [
      '中间档',
      '建议留用',
      { state: 'middle_distribution', backGrade: '建议留用' },
    ],
  ])('%s / %s', (front, back, expected) => {
    expect(
      calculateComparison(facts(1, front as string, back as string), mapping)
        .outcome,
    ).toEqual(expected);
  });
  it.each(['front', 'back', 'both'] as const)('缺段 %s 不是不一致', (side) => {
    const unit = facts(1);
    if (side !== 'back')
      unit.front = { state: 'missing', reason: '缺材料（演示）' };
    if (side !== 'front')
      unit.back = { state: 'missing', reason: '缺材料（演示）' };
    expect(calculateComparison(unit, mapping).outcome).toEqual({
      state: 'missing',
      missing: side,
    });
  });
  it('不可比来自独立HR事实，缺段优先；不接收预计算outcome', () => {
    const marked = dataset().cases[6];
    expect(calculateComparison(marked, mapping).outcome).toEqual({
      state: 'not_comparable',
      ...marked.nonComparable,
    });
    const missing = structuredClone(marked);
    missing.back = { state: 'missing', reason: '缺材料（演示）' };
    expect(calculateComparison(missing, mapping).outcome).toEqual({
      state: 'missing',
      missing: 'back',
    });
    expect(() =>
      calculateComparison(
        {
          ...missing,
          nonComparable: Object.assign({}, missing.nonComparable, {
            state: 'not_comparable',
          }),
        },
        mapping,
      ),
    ).toThrow(ComparisonInputError);
    expect(() =>
      calculateComparison(
        Object.assign(facts(1), { outcome: { state: 'consistent' } }),
        mapping,
      ),
    ).toThrow(ComparisonInputError);
    expect(() =>
      calculateComparison(
        {
          ...marked,
          nonComparable: Object.assign({}, marked.nonComparable, {
            state: 'not_comparable',
          }),
        },
        mapping,
      ),
    ).toThrow(ComparisonInputError);
    expect(() =>
      calculateComparison(
        { ...marked, nonComparable: { ...marked.nonComparable!, reason: '' } },
        mapping,
      ),
    ).toThrow();
  });
  it.each(['frontGrade', 'backGrade', 'frontScale', 'backScale'])(
    '未知 %s 不变成低档',
    (kind) => {
      const unit = facts(
        1,
        kind === 'frontGrade' ? '未知' : '高分档',
        kind === 'backGrade' ? '未知' : '不建议',
      );
      if (kind === 'frontScale' && unit.front.state === 'present')
        unit.front.judgment.scaleId = 'unmapped';
      if (kind === 'backScale' && unit.back.state === 'present')
        unit.back.judgment.scaleId = 'unmapped';
      expect(() => calculateComparison(unit, mapping)).toThrow(
        ComparisonInputError,
      );
    },
  );
  it('未知量表只有带真实HR标记才可返回不可比', () => {
    const unit = structuredClone(dataset().cases[6]);
    if (unit.front.state === 'present')
      unit.front.judgment.scaleId = 'unmapped';
    expect(calculateComparison(unit, mapping).outcome.state).toBe(
      'not_comparable',
    );
  });
  it.each(['original', 'person', 'row', 'node', 'version'])(
    '拒绝借用或错误 %s',
    (kind) => {
      const unit = facts(1);
      if (unit.front.state !== 'present' || unit.back.state !== 'present')
        throw new Error('fixture');
      if (kind === 'original')
        unit.back.judgment.row.source.originalVersionId =
          unit.front.judgment.row.source.originalVersionId;
      if (kind === 'person')
        unit.back.judgment.row.personId = 'another-demo-person';
      if (kind === 'row')
        unit.back.judgment.row.source.location = {
          kind: 'spreadsheet',
          sheet: 'back（演示）',
          cell: 'A2:B3',
        };
      if (kind === 'node') unit.back.judgment.nodeId = 'another-node';
      if (kind === 'version')
        unit.front.judgment.standardVersionId = 'xe-select-v2';
      expect(() => calculateComparison(unit, mapping)).toThrow();
    },
  );
  it('只汇总实际计算的类别，三种缺段和中间档各自计数', () => {
    const units = dataset().cases.map((unit) =>
      calculateComparison(unit, mapping),
    );
    const missingFront = facts(9);
    missingFront.front = { state: 'missing', reason: '缺前段（演示）' };
    const missingBoth = facts(10);
    missingBoth.front = missingBoth.back = {
      state: 'missing',
      reason: '双边缺段（演示）',
    };
    units.push(
      calculateComparison(missingFront, mapping),
      calculateComparison(missingBoth, mapping),
    );
    units.push(
      calculateComparison(facts(11, '中间档', '不建议'), mapping),
      calculateComparison(facts(12, '中间档', '建议留用'), mapping),
    );
    expect(summarizeComparisons(units)).toEqual({
      clear: { consistent: 1, frontHigher: 3, frontLower: 1 },
      middleDistribution: { notRecommended: 1, observe: 1, recommended: 1 },
      excluded: {
        missingFront: 1,
        missingBack: 1,
        missingBoth: 1,
        notComparable: 1,
      },
    });
  });
});
