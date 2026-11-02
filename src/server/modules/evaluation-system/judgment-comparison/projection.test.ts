import { describe, expect, it } from 'vitest';
import { projectComparison } from './projection';
import { access, dataset, facts } from './test-fixtures';

describe('当前权限过滤后的投影与统计', () => {
  it('HR按本人可对照caseIds重算分布，批次另列缺段；不按样本排序', () => {
    const data = Object.assign(dataset(), { counts: { frontHigher: 999 } });
    const before = structuredClone(data);
    const page = projectComparison(data, access(data));
    expect(page.audience).toBe('hr');
    if (page.audience !== 'hr') throw new Error('fixture');
    expect(page.counts).toEqual({
      clear: { consistent: 1, frontHigher: 3, frontLower: 1 },
      middleDistribution: { notRecommended: 0, observe: 1, recommended: 0 },
      excluded: {
        missingFront: 0,
        missingBack: 1,
        missingBoth: 0,
        notComparable: 1,
      },
    });
    expect(page.raters.map(({ evaluator }) => evaluator.id)).toEqual([
      'b',
      'a',
    ]);
    const own = page.raters[1].sample;
    expect(own).toMatchObject({
      state: 'sufficient_sample',
      comparableCaseCount: 5,
      caseIds: ['case-1', 'case-2', 'case-3', 'case-4', 'case-5'],
      distribution: {
        clear: { consistent: 1, frontHigher: 2, frontLower: 1 },
        excluded: {
          missingFront: 0,
          missingBack: 0,
          missingBoth: 0,
          notComparable: 0,
        },
      },
    });
    expect(data).toEqual(before);
    expect(page.cases[0].work).toEqual({
      kind: 'team',
      teamId: 'team-demo',
      workId: 'team-work',
    });
    expect(page.cases[0].front).toMatchObject({
      judgment: {
        row: {
          source: {
            originalVersionId: 'front-original',
            location: { cell: 'A2:B2' },
          },
        },
      },
    });
    expect(page.cases[0].back).toMatchObject({
      judgment: {
        row: {
          source: {
            originalVersionId: 'back-original',
            location: { cell: 'A2:B2' },
          },
        },
      },
    });
  });
  it('4例无分布，恰好5例计入中间档；评价人只见自己的案例', () => {
    const data = dataset();
    const context = access(data, 'rater');
    const page = projectComparison(data, context);
    if (page.audience !== 'rater') throw new Error('fixture');
    expect(page.sample).toMatchObject({
      state: 'sufficient_sample',
      comparableCaseCount: 5,
    });
    expect(page.cases).toHaveLength(7);
    const reduced = {
      ...context,
      grants: context.grants.filter(
        (grant) =>
          !(grant.personId === 'person-1' && grant.nodeId === 'graduation'),
      ),
    };
    const fewer = projectComparison(data, reduced);
    if (fewer.audience !== 'rater') throw new Error('fixture');
    expect(fewer.sample).toEqual({
      state: 'insufficient_sample',
      label: '样本不足',
      threshold: 5,
      comparableCaseCount: 4,
      caseIds: ['case-2', 'case-3', 'case-4', 'case-5'],
    });
    expect(fewer.cases[0].back).toEqual({ state: 'withheld' });
    expect(fewer.cases[0].outcome).toEqual({ state: 'withheld' });
  });
  it.each([
    'wrongNode',
    'wrongPerson',
    'future',
    'expired',
    'atExpiry',
  ] as const)('当前关系 %s 不披露后段或其推导统计', (kind) => {
    const data = { ...dataset(), cases: [facts(1)] };
    const context = access(data, 'rater');
    const grant = { ...context.grants[1] };
    if (kind === 'wrongNode') grant.nodeId = 'another-node';
    if (kind === 'wrongPerson') grant.personId = 'another-person';
    if (kind === 'future') grant.validFrom = '2027-01-01T00:00:00Z';
    if (kind === 'expired') grant.validUntil = '2026-10-30T12:00:00Z';
    if (kind === 'atExpiry') grant.validUntil = context.now;
    const page = projectComparison(data, {
      ...context,
      grants: [context.grants[0], grant],
    });
    if (page.audience !== 'rater') throw new Error('fixture');
    expect(page.cases[0].back).toEqual({ state: 'withheld' });
    expect(page.cases[0].outcome).toEqual({ state: 'withheld' });
    expect(page.sample.comparableCaseCount).toBe(0);
    expect(JSON.stringify(page)).not.toContain('back-original');
  });
  it('隐藏前段、双边或不可比标记不会漏出评语；隐藏未知不触发计算', () => {
    const data = {
      ...dataset(),
      cases: [facts(1, '高分档', '未知'), dataset().cases[6]],
    };
    const context = access(data, 'rater');
    const page = projectComparison(data, { ...context, grants: [] });
    if (page.audience !== 'rater') throw new Error('fixture');
    expect(
      page.cases.every(
        (unit) =>
          unit.front.state === 'withheld' &&
          unit.back.state === 'withheld' &&
          unit.outcome.state === 'withheld',
      ),
    ).toBe(true);
    expect(JSON.stringify(page)).not.toMatch(
      /original|excerpt|markedBy|任务范围/,
    );
  });
  it('HR也先按节点过滤，个人分布不能保留隐藏案例', () => {
    const data = dataset();
    const context = access(data);
    const page = projectComparison(data, {
      ...context,
      grants: context.grants.filter((grant) => grant.personId !== 'person-1'),
    });
    if (page.audience !== 'hr') throw new Error('fixture');
    expect(page.cases.some(({ id }) => id === 'case-1')).toBe(false);
    expect(page.counts.clear.frontHigher).toBe(2);
    expect(page.raters[1].sample).toMatchObject({
      state: 'insufficient_sample',
      comparableCaseCount: 4,
    });
    expect(page.raters[1].sample).not.toHaveProperty('distribution');
    const filtered = projectComparison(data, context, 'b');
    if (filtered.audience !== 'hr') throw new Error('fixture');
    expect(filtered.cases.map(({ id }) => id)).toEqual(['case-8']);
  });
  it('姓名同名按稳定ID；不会按样本或偏差排序', () => {
    const data = dataset();
    for (const unit of data.cases)
      if (unit.front.state === 'present')
        unit.front.judgment.evaluator.name = '同名评价人（演示）';
    const page = projectComparison(data, access(data));
    if (page.audience !== 'hr') throw new Error('fixture');
    expect(page.raters.map(({ evaluator }) => evaluator.id)).toEqual([
      'a',
      'b',
    ]);
  });
  it('管理者只返回授权汇总，不带评价人数字、案例或引用', () => {
    const data = dataset();
    const context = access(data, 'manager');
    const page = projectComparison(data, {
      ...context,
      grants: context.grants.filter((grant) => grant.personId !== 'person-8'),
    });
    expect(page).toEqual({
      audience: 'manager',
      policy: {
        conclusionScope: 'evaluation_system_only',
        laterStageUse: 'comparison_not_ground_truth',
      },
      batches: [
        {
          batch: data.batch,
          discrepancyPeople: 3,
          attributionCategories: ['evaluation_standard'],
        },
      ],
    });
    expect(JSON.stringify(page)).not.toMatch(
      /叶青|杜安歌|fragmentId|case-1|distribution|confidence/,
    );
  });
  it('拒绝跨批次/重复case/错绑定/错对应表和不可信时钟', () => {
    const original = dataset();
    const context = access(original);
    const duplicate = {
      ...original,
      cases: [original.cases[0], original.cases[0]],
    };
    expect(() => projectComparison(duplicate, context)).toThrow();
    for (const change of ['batchId', 'cohort', 'version', 'mapping']) {
      const data = dataset();
      const unit = data.cases[0];
      if (change === 'batchId') unit.batchId = 'another-batch';
      if (change === 'cohort') unit.cohort.id = 'another-cohort';
      if (change === 'version')
        unit.selectionStandardVersionId = 'xe-select-v2';
      if (change === 'mapping') unit.mappingVersionId = 'map-xe-select-v2';
      expect(() => projectComparison(data, context)).toThrow();
    }
    expect(() =>
      projectComparison(
        {
          ...original,
          mapping: { ...original.mapping, versionId: 'map-xe-select-v2' },
        },
        context,
      ),
    ).toThrow();
    expect(() =>
      projectComparison(original, { ...context, now: 'invalid' }),
    ).toThrow();
    expect(() =>
      projectComparison(original, { ...context, viewerId: '' }),
    ).toThrow();
    expect(() =>
      projectComparison(original, access(original, 'rater'), 'b'),
    ).toThrow();
    expect(() =>
      projectComparison(original, access(original, 'manager'), 'b'),
    ).toThrow();
  });
});
