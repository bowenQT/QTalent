import { describe, expect, it } from 'vitest';
import {
  comparisonCaseSchema,
  comparisonHrPageSchema,
  comparisonManagerPageSchema,
  comparisonMappingSchema,
  comparisonRaterCaseSchema,
  comparisonRaterSampleSchema,
  comparisonReadInputSchema,
  comparisonReadResultSchema,
  comparisonTableRowSchema,
  createAuthorizedRaterComparisonSchema,
  createComparisonCaseSchema,
  type ComparisonRaterPage,
  type ComparisonRaterAccess,
} from './judgment-comparison';
import {
  comparisonCasesFixture,
  comparisonHrFixture,
  comparisonManagerFixture,
  comparisonMappingFixture,
  comparisonRaterFixture,
} from './standard-iteration.fixtures';

const validate = () => createComparisonCaseSchema(comparisonMappingFixture());

describe('入营选拔与结营判断对照契约', () => {
  it('保留人 × 判断、两段原档位、评价人、节点、期次、标准及对应表版本', () => {
    const page = comparisonHrPageSchema.parse(comparisonHrFixture());
    expect(page.cases).toHaveLength(13);
    const unit = page.cases[0];
    expect(unit.judgment.id).toBe('selection_outcome');
    expect(unit.selectionStandardVersionId).toBe('xe-select-v1');
    expect(unit.mappingVersionId).toBe('map-xe-select-v1');
    expect(unit.front.state === 'present' && unit.front.judgment.grade).toBe(
      '高分档',
    );
    expect(unit.back.state === 'present' && unit.back.judgment.grade).toBe(
      '不建议',
    );
    expect(page.counts).toEqual({
      clear: { consistent: 3, frontHigher: 2, frontLower: 1 },
      middleDistribution: { notRecommended: 1, observe: 1, recommended: 1 },
      excluded: {
        missingFront: 1,
        missingBack: 1,
        missingBoth: 1,
        notComparable: 1,
      },
    });
    for (const unit of page.cases)
      expect(validate().safeParse(unit).success).toBe(true);
  });

  it.each([
    [0, { state: 'front_higher', bands: 2 }],
    [1, { state: 'front_lower', bands: 2 }],
    [2, { state: 'consistent' }],
    [3, { state: 'middle_distribution', backGrade: '不建议' }],
    [4, { state: 'middle_distribution', backGrade: '建议留用' }],
    [5, { state: 'missing', missing: 'back' }],
    [6, { state: 'missing', missing: 'front' }],
    [7, { state: 'missing', missing: 'both' }],
    [11, { state: 'middle_distribution', backGrade: '继续观察' }],
    [12, { state: 'front_higher', bands: 1 }],
  ])('固定 DY-06 样例 %s 的预期口径', (index, expected) => {
    const unit = validate().parse(comparisonCasesFixture()[index]);
    expect(unit.outcome).toEqual(expected);
    const wrong = { ...unit, outcome: { state: 'front_higher', bands: 1 } };
    if (index === 12) wrong.outcome = { state: 'front_lower', bands: 1 };
    expect(validate().safeParse(wrong).success).toBe(false);
  });

  it('中间档即使后段一致也只计分布；缺段不能标成一致或偏差', () => {
    const units = comparisonCasesFixture();
    for (const index of [3, 4, 5, 6, 7, 11]) {
      expect(
        validate().safeParse({
          ...units[index],
          outcome: { state: 'consistent' },
        }).success,
      ).toBe(false);
    }
  });

  it('不明档位或量表没有对应时须由人标为不可比并署名', () => {
    const unit = comparisonCasesFixture()[8];
    expect(validate().parse(unit).outcome.state).toBe('not_comparable');
    if (unit.front.state !== 'present') throw new Error('fixture');
    unit.front.judgment.scaleId = 'demo-unmapped-scale';
    expect(validate().safeParse(unit).success).toBe(true);
    expect(
      validate().safeParse({ ...unit, outcome: { state: 'consistent' } })
        .success,
    ).toBe(false);
    unit.front.judgment.scaleId = comparisonMappingFixture().frontScaleId;
    unit.front.judgment.grade = '未定义档位';
    expect(
      validate().safeParse({
        ...unit,
        outcome: { state: 'front_higher', bands: 2 },
      }).success,
    ).toBe(false);
    expect(
      validate().safeParse({
        ...unit,
        outcome: { state: 'not_comparable', reason: '' },
      }).success,
    ).toBe(false);
    const same = comparisonCasesFixture()[2];
    if (same.front.state !== 'present') throw new Error('fixture');
    same.front.judgment.grade = '刚过线档';
    expect(validate().safeParse(same).success).toBe(false);
  });

  it('对应表经 HR 确认且档位唯一，版本必须匹配', () => {
    const map = comparisonMappingFixture();
    expect(
      comparisonMappingSchema.safeParse({ ...map, confirmedBy: undefined })
        .success,
    ).toBe(false);
    expect(
      comparisonMappingSchema.safeParse({
        ...map,
        rows: [map.rows[0], map.rows[0], map.rows[2]],
      }).success,
    ).toBe(false);
    expect(
      validate().safeParse({
        ...comparisonCasesFixture()[0],
        mappingVersionId: 'map-xe-select-v2',
      }).success,
    ).toBe(false);
  });

  it('两个独立原表各自定位这个人的行，不把快照伪装成原表', () => {
    const unit = comparisonCasesFixture()[0];
    if (unit.front.state !== 'present' || unit.back.state !== 'present')
      throw new Error('fixture');
    const front = unit.front.judgment.row;
    const back = unit.back.judgment.row;
    expect(front.row).toBe(2);
    expect(back.row).toBe(21);
    expect(front.source.originalVersionId).not.toBe(
      back.source.originalVersionId,
    );
    expect(front.source.fragmentId).not.toBe(back.source.fragmentId);
    expect(
      comparisonTableRowSchema.safeParse({ ...front, row: 21 }).success,
    ).toBe(false);
    expect(
      comparisonTableRowSchema.safeParse({
        ...front,
        source: {
          ...front.source,
          location: { kind: 'document', paragraph: '演示' },
          sourceType: 'document',
        },
      }).success,
    ).toBe(false);
    expect(
      comparisonTableRowSchema.safeParse({
        ...front,
        source: {
          ...front.source,
          sourceCategory: 'prototype_baseline',
          sourceType: 'prototype_snapshot',
          location: { kind: 'snapshot_field', fieldPath: 'demo.grade' },
          displayNotice: '演示原型快照',
        },
      }).success,
    ).toBe(false);
    for (const field of ['originalVersionId', 'fragmentId'] as const) {
      const altered = structuredClone(unit);
      if (altered.back.state !== 'present') throw new Error('fixture');
      altered.back.judgment.row.source[field] = front.source[field];
      expect(comparisonCaseSchema.safeParse(altered).success).toBe(false);
    }
  });

  it.each(['personId', 'nodeId', 'cohortId', 'standardVersionId'])(
    '不能借用他人/节点/期次/标准的前段来源：%s',
    (field) => {
      const unit = comparisonCasesFixture()[0];
      if (unit.front.state !== 'present') throw new Error('fixture');
      if (field === 'personId') unit.front.judgment.row.personId = 'demo-other';
      else if (field === 'nodeId') unit.front.judgment.nodeId = 'demo-other';
      else if (field === 'cohortId')
        unit.front.judgment.cohortId = 'demo-other';
      else unit.front.judgment.standardVersionId = 'xe-select-v2';
      expect(comparisonCaseSchema.safeParse(unit).success).toBe(false);
    },
  );

  it('同队作品仍然每人一条判断和自己的表格行，不在响应中夹带队员名单', () => {
    const cases = comparisonCasesFixture();
    expect(cases[0].work).toEqual(cases[2].work);
    expect(cases[0].person.id).not.toBe(cases[2].person.id);
    const unit = cases[0];
    expect(
      comparisonCaseSchema.safeParse({
        ...unit,
        work: {
          ...unit.work,
          memberPersonIds: ['demo-other-1', 'demo-other-2'],
        },
      }).success,
    ).toBe(false);
  });

  it('少于五例只返回样本不足和案例；达到五例才返回分布', () => {
    const page = comparisonHrPageSchema.parse(comparisonHrFixture());
    expect(page.raters[0].sample.state).toBe('sufficient_sample');
    expect(page.raters[0].sample.comparableCaseCount).toBe(5);
    const small = page.raters[1].sample;
    expect(small.state).toBe('insufficient_sample');
    expect(small.comparableCaseCount).toBe(4);
    expect(
      comparisonRaterSampleSchema.safeParse({
        ...small,
        distribution: page.counts,
      }).success,
    ).toBe(false);
    expect(
      comparisonRaterSampleSchema.safeParse({
        ...small,
        comparableCaseCount: 5,
        caseIds: [...small.caseIds, 'demo-extra'],
      }).success,
    ).toBe(false);
    expect(
      comparisonRaterSampleSchema.safeParse({ ...small, threshold: 4 }).success,
    ).toBe(false);
    expect(
      comparisonRaterSampleSchema.safeParse({
        ...small,
        comparableCaseCount: 3,
      }).success,
    ).toBe(false);
    expect(
      comparisonRaterSampleSchema.safeParse({
        ...small,
        caseIds: [
          small.caseIds[0],
          small.caseIds[0],
          ...small.caseIds.slice(2),
        ],
      }).success,
    ).toBe(false);
  });

  it('HR 的评价人样本不能混入缺段、不可比或别人的案例', () => {
    for (const invalidId of [
      'demo-comparison-6',
      'demo-comparison-9',
      'demo-comparison-10',
    ]) {
      const page = comparisonHrFixture();
      page.raters[0].sample.caseIds[0] = invalidId;
      expect(comparisonHrPageSchema.safeParse(page).success).toBe(false);
    }
    const page = comparisonHrFixture();
    page.cases.push(page.cases[0]);
    expect(comparisonHrPageSchema.safeParse(page).success).toBe(false);
    expect(
      comparisonHrPageSchema.safeParse({
        ...comparisonHrFixture(),
        batch: { ...page.batch, mappingVersionId: 'map-xe-select-v2' },
      }).success,
    ).toBe(false);
    const crossed = comparisonHrFixture();
    crossed.cases[0].batchId = 'demo-other-batch';
    expect(comparisonHrPageSchema.safeParse(crossed).success).toBe(false);
  });

  it.each(['cases', 'people', 'raters', 'evaluatorCounts', 'citations'])(
    '管理者返回值拒绝 HR 细节字段 %s',
    (key) => {
      const page = comparisonManagerFixture();
      expect(comparisonManagerPageSchema.safeParse(page).success).toBe(true);
      expect(
        comparisonManagerPageSchema.safeParse({
          ...page,
          [key]: comparisonHrFixture().cases,
        }).success,
      ).toBe(false);
      expect(
        comparisonManagerPageSchema.safeParse({
          ...page,
          batches: [{ ...page.batches[0], [key]: [] }],
        }).success,
      ).toBe(false);
    },
  );

  it.each([
    'rank',
    'accuracyPercent',
    'talentTotalScore',
    'capabilityPercent',
    'profileUpdates',
    'quadrant',
    'groundTruth',
  ])('不变量：拒绝排行、百分比、档案副作用和真值字段 %s', (key) => {
    const page = comparisonHrFixture();
    expect(
      comparisonHrPageSchema.safeParse({ ...page, [key]: 1 }).success,
    ).toBe(false);
    expect(
      comparisonCaseSchema.safeParse({ ...page.cases[0], [key]: 1 }).success,
    ).toBe(false);
    expect(
      comparisonManagerPageSchema.safeParse({
        ...comparisonManagerFixture(),
        policy: { ...page.policy, [key]: true },
      }).success,
    ).toBe(false);
  });

  it('读取输入不接受客户端角色/身份；拒绝与未找到是实际结果', () => {
    expect(
      comparisonReadInputSchema.parse({ batchId: 'demo-batch' }).batchId,
    ).toBe('demo-batch');
    expect(
      comparisonReadInputSchema.safeParse({
        batchId: 'demo-batch',
        role: 'hr',
        viewerId: 'demo-hr',
      }).success,
    ).toBe(false);
    expect(
      comparisonReadResultSchema.safeParse({
        status: 'success',
        page: comparisonManagerFixture(),
      }).success,
    ).toBe(true);
    expect(
      comparisonReadResultSchema.safeParse({
        status: 'forbidden',
        message: '演示：无权限',
      }).success,
    ).toBe(true);
    expect(
      comparisonReadResultSchema.safeParse({
        status: 'validation_error',
        fieldErrors: { batchId: ['必填'] },
        input: {},
      }).success,
    ).toBe(true);
  });
});

describe('评价人按当前节点授权返回的契约', () => {
  it('本人做过前段也只能拿当前有效节点的那一段', () => {
    const { page, access } = comparisonRaterFixture();
    expect(
      createAuthorizedRaterComparisonSchema(access).safeParse(page).success,
    ).toBe(true);
    const leaked = structuredClone(page);
    leaked.cases[0] = comparisonCasesFixture()[0];
    expect(
      createAuthorizedRaterComparisonSchema(access).safeParse(leaked).success,
    ).toBe(false);
    access.grants = [
      ...access.grants,
      { ...access.grants[0], nodeId: 'demo-xe6-graduation' },
    ];
    leaked.sample = {
      state: 'insufficient_sample',
      label: '样本不足',
      threshold: 5,
      comparableCaseCount: 1,
      caseIds: ['demo-comparison-1'],
    };
    expect(
      createAuthorizedRaterComparisonSchema(access).safeParse(leaked).success,
    ).toBe(true);
    leaked.cases[0].outcome = { state: 'consistent' };
    expect(
      createAuthorizedRaterComparisonSchema(access).safeParse(leaked).success,
    ).toBe(false);
  });

  it.each(['expired', 'future', 'cross_node', 'cross_person'])(
    '关系 %s 时不得因本人案例放行',
    (kind) => {
      const { page, access } = comparisonRaterFixture();
      if (kind === 'expired') access.grants[0].validUntil = access.now;
      if (kind === 'future')
        access.grants[0].validFrom = '2026-11-01T00:00:00Z';
      if (kind === 'cross_node') access.grants[0].nodeId = 'demo-xe6-interview';
      if (kind === 'cross_person')
        access.grants[0].personId = 'demo-person-other';
      expect(
        createAuthorizedRaterComparisonSchema(access).safeParse(page).success,
      ).toBe(false);
      page.cases[0].front = { state: 'withheld' };
      expect(
        createAuthorizedRaterComparisonSchema(access).safeParse(page).success,
      ).toBe(true);
    },
  );

  it('关系有效期左闭右开，未到期的一段仍可返回', () => {
    const { page, access } = comparisonRaterFixture();
    access.grants[0].validUntil = '2026-10-31T10:00:00.001Z';
    expect(
      createAuthorizedRaterComparisonSchema(access).safeParse(page).success,
    ).toBe(true);
  });

  it('隐藏段不能携带档位、原文、来源，不能从隐藏段返回推导分布', () => {
    const { page, access } = comparisonRaterFixture();
    const unit = page.cases[0];
    expect(
      comparisonRaterCaseSchema.safeParse({
        ...unit,
        back: { state: 'withheld', grade: '不建议', source: 'demo-source' },
      }).success,
    ).toBe(false);
    expect(
      comparisonRaterCaseSchema.safeParse({
        ...unit,
        outcome: { state: 'front_higher', bands: 2 },
      }).success,
    ).toBe(false);
    page.sample = {
      state: 'insufficient_sample',
      label: '样本不足',
      threshold: 5,
      comparableCaseCount: 1,
      caseIds: [unit.id],
    };
    expect(
      createAuthorizedRaterComparisonSchema(access).safeParse(page).success,
    ).toBe(false);
  });

  it('当前身份、本人筛选和实际前段评价人必须一致', () => {
    const { page, access } = comparisonRaterFixture();
    expect(
      createAuthorizedRaterComparisonSchema({
        ...access,
        ownCaseIds: [],
      }).safeParse(page).success,
    ).toBe(false);
    expect(
      createAuthorizedRaterComparisonSchema({
        ...access,
        viewerId: 'demo-other',
      }).safeParse(page).success,
    ).toBe(false);
    expect(
      createAuthorizedRaterComparisonSchema({
        ...access,
        now: 'invalid',
      }).safeParse(page).success,
    ).toBe(false);
    const front = page.cases[0].front;
    if (front.state !== 'present') throw new Error('fixture');
    front.judgment.evaluator.id = 'demo-other';
    expect(
      createAuthorizedRaterComparisonSchema(access).safeParse(page).success,
    ).toBe(false);
    front.judgment.evaluator.id = access.viewerId;
    front.judgment.nodeId = 'demo-other-node';
    expect(
      createAuthorizedRaterComparisonSchema(access).safeParse(page).success,
    ).toBe(false);
  });
});

describe('R1：评价人列表稳定按姓名显示', () => {
  it('不接受按样本量或偏差反转评价人列表', () => {
    const page = comparisonHrFixture();
    expect(comparisonHrPageSchema.safeParse(page).success).toBe(true);
    page.raters.reverse();
    expect(comparisonHrPageSchema.safeParse(page).success).toBe(false);
  });
  it('同名评价人用稳定 id 打破并列，重复身份不生成两行', () => {
    const page = comparisonHrFixture();
    for (const rater of page.raters)
      rater.evaluator.name = '同名评价人（演示）';
    expect(comparisonHrPageSchema.safeParse(page).success).toBe(true);
    expect(
      comparisonHrPageSchema.safeParse({
        ...page,
        raters: [...page.raters].reverse(),
      }).success,
    ).toBe(false);
    expect(
      comparisonHrPageSchema.safeParse({
        ...page,
        raters: [page.raters[0], page.raters[0]],
      }).success,
    ).toBe(false);
  });
});

// Explicit expected observations: one in each clear direction, two middle
// judgments (not-recommended and recommended), no excluded/hidden samples.
function disclosedRaterFixture(): {
  page: ComparisonRaterPage;
  access: ComparisonRaterAccess;
} {
  const hr = comparisonHrFixture();
  const cases = hr.cases.slice(0, 5);
  const viewerId = 'demo-evaluator-five';
  return {
    page: {
      audience: 'rater',
      viewerId,
      policy: hr.policy,
      cases,
      sample: {
        state: 'sufficient_sample',
        threshold: 5,
        comparableCaseCount: 5,
        caseIds: [
          'demo-comparison-1',
          'demo-comparison-2',
          'demo-comparison-3',
          'demo-comparison-4',
          'demo-comparison-5',
        ],
        distribution: {
          clear: { consistent: 1, frontHigher: 1, frontLower: 1 },
          middleDistribution: { notRecommended: 1, observe: 0, recommended: 1 },
          excluded: {
            missingFront: 0,
            missingBack: 0,
            missingBoth: 0,
            notComparable: 0,
          },
        },
      },
    },
    access: {
      viewerId,
      now: '2026-10-31T10:00:00Z',
      ownCaseIds: cases.map((unit) => unit.id),
      mapping: hr.mapping,
      grants: cases.flatMap((unit) =>
        [unit.frontNodeId, unit.backNodeId].map((nodeId) => ({
          personId: unit.person.id,
          nodeId,
          validFrom: '2026-07-01T00:00:00Z',
          validUntil: null,
        })),
      ),
    },
  };
}
function sufficientSample(sample: ComparisonRaterPage['sample']) {
  if (sample.state !== 'sufficient_sample') throw new Error('fixture');
  return sample;
}
type SampleDistribution = ReturnType<typeof sufficientSample>['distribution'];
const changedCounters: [string, (distribution: SampleDistribution) => void][] =
  [
    ['clear.consistent', (distribution) => distribution.clear.consistent++],
    ['clear.frontHigher', (distribution) => distribution.clear.frontHigher++],
    ['clear.frontLower', (distribution) => distribution.clear.frontLower++],
    [
      'middle.notRecommended',
      (distribution) => distribution.middleDistribution.notRecommended++,
    ],
    [
      'middle.observe',
      (distribution) => distribution.middleDistribution.observe++,
    ],
    [
      'middle.recommended',
      (distribution) => distribution.middleDistribution.recommended++,
    ],
    [
      'excluded.missingFront',
      (distribution) => distribution.excluded.missingFront++,
    ],
    [
      'excluded.missingBack',
      (distribution) => distribution.excluded.missingBack++,
    ],
    [
      'excluded.missingBoth',
      (distribution) => distribution.excluded.missingBoth++,
    ],
    [
      'excluded.notComparable',
      (distribution) => distribution.excluded.notComparable++,
    ],
  ];

describe('R2：评价人分布须与当前可披露的本人可对照案例逐项一致', () => {
  it('明确的五例同时包含双向偏差、一致与中间档，正确分布可返回', () => {
    const { page, access } = disclosedRaterFixture();
    expect(
      createAuthorizedRaterComparisonSchema(access).safeParse(page).success,
    ).toBe(true);
    expect(
      comparisonHrPageSchema.safeParse(comparisonHrFixture()).success,
    ).toBe(true);
    // Presentation order does not change the counted outcomes.
    page.cases.reverse();
    page.sample.caseIds.reverse();
    expect(
      createAuthorizedRaterComparisonSchema(access).safeParse(page).success,
    ).toBe(true);
  });

  it('HR按评价人的分布不能换成整批或其他人的统计，caseIds正确也拒绝', () => {
    const hr = comparisonHrFixture();
    sufficientSample(hr.raters[0].sample).distribution = hr.counts;
    expect(comparisonHrPageSchema.safeParse(hr).success).toBe(false);
  });

  it('本人页不能把他人的统计混进分布，caseIds正确也拒绝', () => {
    const { page, access } = disclosedRaterFixture();
    sufficientSample(page.sample).distribution = comparisonHrFixture().counts;
    expect(
      createAuthorizedRaterComparisonSchema(access).safeParse(page).success,
    ).toBe(false);
  });

  it('当前关系不足的隐藏案例不改变五例分布，也不能夹带其统计', () => {
    const { page, access } = disclosedRaterFixture();
    const hidden = {
      ...page.cases[0],
      id: 'demo-hidden-case',
      person: { id: 'demo-hidden-person', name: '隐藏案例（演示）' },
      front: { state: 'withheld' as const },
      back: { state: 'withheld' as const },
      outcome: { state: 'withheld' as const },
    };
    page.cases.push(hidden);
    access.ownCaseIds = [...access.ownCaseIds, hidden.id];
    expect(
      createAuthorizedRaterComparisonSchema(access).safeParse(page).success,
    ).toBe(true);
    sufficientSample(page.sample).distribution.clear.frontHigher++;
    expect(
      createAuthorizedRaterComparisonSchema(access).safeParse(page).success,
    ).toBe(false);
  });

  it('本人可见的缺段、不可比案例保留为案例，但不计入可比样本分布', () => {
    const { page, access } = disclosedRaterFixture();
    const extra = comparisonCasesFixture().filter((unit) =>
      ['demo-comparison-6', 'demo-comparison-9'].includes(unit.id),
    );
    page.cases.push(...extra);
    access.ownCaseIds = [...access.ownCaseIds, ...extra.map((unit) => unit.id)];
    access.grants = [
      ...access.grants,
      ...extra.flatMap((unit) =>
        [unit.frontNodeId, unit.backNodeId].map((nodeId) => ({
          personId: unit.person.id,
          nodeId,
          validFrom: '2026-07-01T00:00:00Z',
          validUntil: null,
        })),
      ),
    ];
    expect(
      createAuthorizedRaterComparisonSchema(access).safeParse(page).success,
    ).toBe(true);
    const bad = structuredClone(page);
    sufficientSample(bad.sample).distribution.excluded.missingBack = 1;
    expect(
      createAuthorizedRaterComparisonSchema(access).safeParse(bad).success,
    ).toBe(false);
    sufficientSample(page.sample).distribution.excluded.notComparable = 1;
    expect(
      createAuthorizedRaterComparisonSchema(access).safeParse(page).success,
    ).toBe(false);
  });

  it('本人页和HR页逐项核对十个计数，而不是只核样本数', () => {
    for (const [name, mutate] of changedCounters) {
      const { page, access } = disclosedRaterFixture();
      mutate(sufficientSample(page.sample).distribution);
      expect(
        createAuthorizedRaterComparisonSchema(access).safeParse(page).success,
        `rater ${name}`,
      ).toBe(false);
      const hr = comparisonHrFixture();
      mutate(sufficientSample(hr.raters[0].sample).distribution);
      expect(comparisonHrPageSchema.safeParse(hr).success, `hr ${name}`).toBe(
        false,
      );
    }
  });

  it('总数不变但偏差方向对调也拒绝，不能以总量相等替代逐项一致', () => {
    const { page, access } = disclosedRaterFixture();
    const hr = comparisonHrFixture();
    for (const sample of [page.sample, hr.raters[0].sample]) {
      const distribution = sufficientSample(sample).distribution;
      distribution.clear.consistent = 2;
      distribution.clear.frontHigher = 0;
    }
    expect(
      createAuthorizedRaterComparisonSchema(access).safeParse(page).success,
    ).toBe(false);
    expect(comparisonHrPageSchema.safeParse(hr).success).toBe(false);
  });

  it('中间档改为继续观察时仅更新对应后段分布，不添加一致或不一致', () => {
    const { page, access } = disclosedRaterFixture();
    const hr = comparisonHrFixture();
    for (const unit of [page.cases[4], hr.cases[4]]) {
      if (unit.back.state !== 'present') throw new Error('fixture');
      unit.back.judgment.grade = '继续观察';
      unit.back.judgment.row.source.excerpt =
        '演示：中间档案例的结营判断为继续观察。';
      unit.outcome = { state: 'middle_distribution', backGrade: '继续观察' };
    }
    for (const sample of [page.sample, hr.raters[0].sample]) {
      sufficientSample(sample).distribution = {
        clear: { consistent: 1, frontHigher: 1, frontLower: 1 },
        middleDistribution: { notRecommended: 1, observe: 1, recommended: 0 },
        excluded: {
          missingFront: 0,
          missingBack: 0,
          missingBoth: 0,
          notComparable: 0,
        },
      };
    }
    hr.counts.middleDistribution = {
      notRecommended: 1,
      observe: 2,
      recommended: 0,
    };
    expect(
      createAuthorizedRaterComparisonSchema(access).safeParse(page).success,
    ).toBe(true);
    expect(comparisonHrPageSchema.safeParse(hr).success).toBe(true);
    sufficientSample(page.sample).distribution.middleDistribution = {
      notRecommended: 1,
      observe: 0,
      recommended: 1,
    };
    expect(
      createAuthorizedRaterComparisonSchema(access).safeParse(page).success,
    ).toBe(false);
  });
});
