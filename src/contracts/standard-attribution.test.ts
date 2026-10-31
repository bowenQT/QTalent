import { describe, expect, it } from 'vitest';
import {
  confirmedStandardAttributionSchema,
  confirmStandardAttributionInputSchema,
  confirmStandardAttributionResultSchema,
  createAuthorizedAttributionModelInputSchema,
  createGroundedStandardHypothesisSchema,
  generateStandardHypothesesResultSchema,
  revisionEligibleAttributionSchema,
  standardAttributionCategoriesSchema,
  standardAttributionHypothesisSchema,
  standardAttributionModelInputSchema,
} from './standard-attribution';
import { standardAttributionCategorySchema } from './judgment-comparison';
import {
  comparisonCasesFixture,
  comparisonMappingFixture,
  confirmedStandardAttributionFixture,
  standardHypothesisFixture,
} from './standard-iteration.fixtures';

describe('标准迭代的 AI 假设与 HR 归因契约', () => {
  it('五类归因与多选保持一个权威定义', () => {
    expect(standardAttributionCategorySchema.options).toEqual([
      'evaluation_standard',
      'evaluator',
      'method_or_information',
      'person_or_environment',
      'later_evaluation',
    ]);
    expect(
      standardAttributionCategoriesSchema.parse([
        'evaluation_standard',
        'method_or_information',
      ]),
    ).toHaveLength(2);
    expect(standardAttributionCategoriesSchema.safeParse([]).success).toBe(
      false,
    );
    expect(
      standardAttributionCategoriesSchema.safeParse(['evaluator', 'evaluator'])
        .success,
    ).toBe(false);
    expect(
      standardAttributionCategoriesSchema.safeParse(['low_potential']).success,
    ).toBe(false);
  });

  it('AI 假设引用到具体案例、节点、标准版本和原表行，不能冒充人工结论', () => {
    const hypothesis = standardHypothesisFixture();
    expect(standardAttributionHypothesisSchema.parse(hypothesis).origin).toBe(
      'ai_hypothesis',
    );
    expect(hypothesis.citations[0].row.source.location.kind).toBe(
      'spreadsheet',
    );
    expect(
      standardAttributionHypothesisSchema.safeParse({
        ...hypothesis,
        citations: [],
      }).success,
    ).toBe(false);
    expect(
      standardAttributionHypothesisSchema.safeParse({
        ...hypothesis,
        origin: 'human_conclusion',
      }).success,
    ).toBe(false);
    expect(
      confirmedStandardAttributionSchema.safeParse(hypothesis).success,
    ).toBe(false);
    expect(
      revisionEligibleAttributionSchema.safeParse(hypothesis).success,
    ).toBe(false);
  });

  it('AI 不能杜撰可解析的案例 id、节点、版本、引用原文或另一段的来源', () => {
    const validator = createGroundedStandardHypothesisSchema(
      comparisonCasesFixture(),
    );
    const hypothesis = standardHypothesisFixture();
    expect(validator.safeParse(hypothesis).success).toBe(true);
    expect(
      createGroundedStandardHypothesisSchema([]).safeParse(hypothesis).success,
    ).toBe(false);
    for (const patch of [
      { caseId: 'demo-unknown' },
      { nodeId: 'demo-other' },
      { standardVersionId: 'xe-select-v2' },
      { side: 'back' },
    ]) {
      expect(
        validator.safeParse({
          ...hypothesis,
          citations: [{ ...hypothesis.citations[0], ...patch }],
        }).success,
      ).toBe(false);
    }
    const changed = structuredClone(hypothesis);
    changed.citations[0].row.source.excerpt = '演示：模型杜撰的原文';
    expect(validator.safeParse(changed).success).toBe(false);
    changed.citations[0].caseId = 'demo-comparison-7';
    expect(validator.safeParse(changed).success).toBe(false);
  });

  it('HR 归因必须有理由、署名、版本和原文依据', () => {
    const attribution = confirmedStandardAttributionFixture();
    expect(
      confirmedStandardAttributionSchema.parse(attribution).confirmedBy.id,
    ).toBe('demo-hr');
    for (const patch of [
      { rationale: '' },
      { confirmedBy: undefined },
      { revision: 0 },
      { citations: [] },
    ]) {
      expect(
        confirmedStandardAttributionSchema.safeParse({
          ...attribution,
          ...patch,
        }).success,
      ).toBe(false);
    }
    expect(
      revisionEligibleAttributionSchema.safeParse(attribution).success,
    ).toBe(true);
  });

  it.each([
    'evaluator',
    'method_or_information',
    'person_or_environment',
    'later_evaluation',
  ])('只归因为 %s 可以记录，但不能起草标准修订', (category) => {
    const attribution = {
      ...confirmedStandardAttributionFixture(),
      categories: [category],
    };
    expect(
      confirmedStandardAttributionSchema.safeParse(attribution).success,
    ).toBe(true);
    expect(
      revisionEligibleAttributionSchema.safeParse(attribution).success,
    ).toBe(false);
  });

  it('模型输入先限制到当前授权且已确认的案例，不传档案分数和象限', () => {
    const input = {
      batchId: 'demo-selection-graduation-xe6',
      promptVersion: 'demo-prompt-v1',
      mapping: comparisonMappingFixture(),
      cases: [comparisonCasesFixture()[0]],
    };
    expect(
      createAuthorizedAttributionModelInputSchema([
        'demo-comparison-1',
      ]).safeParse(input).success,
    ).toBe(true);
    expect(
      createAuthorizedAttributionModelInputSchema([]).safeParse(input).success,
    ).toBe(false);
    expect(
      standardAttributionModelInputSchema.safeParse({
        ...input,
        batchId: 'demo-other-batch',
      }).success,
    ).toBe(false);
    expect(
      standardAttributionModelInputSchema.safeParse({
        ...input,
        cases: [...input.cases, ...input.cases],
      }).success,
    ).toBe(false);
    expect(
      standardAttributionModelInputSchema.safeParse({ ...input, cases: [] })
        .success,
    ).toBe(false);
    expect(
      standardAttributionModelInputSchema.safeParse({
        ...input,
        talentScores: [5],
        quadrant: 'high',
      }).success,
    ).toBe(false);
    if (input.cases[0].front.state !== 'present') throw new Error('fixture');
    expect(
      standardAttributionModelInputSchema.safeParse({
        ...input,
        cases: [
          {
            ...input.cases[0],
            front: {
              ...input.cases[0].front,
              judgment: {
                ...input.cases[0].front.judgment,
                confirmation: 'ai_suggested',
              },
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('客户端不能伪造 HR 署名、修改档案或提交重复案例', () => {
    const input = {
      operationId: 'demo-operation',
      batchId: 'demo-selection-graduation-xe6',
      hypothesisId: 'demo-hypothesis',
      categories: ['evaluation_standard'],
      rationale: '演示：人工核对',
      caseIds: ['demo-comparison-1'],
    };
    expect(confirmStandardAttributionInputSchema.safeParse(input).success).toBe(
      true,
    );
    expect(
      confirmStandardAttributionInputSchema.safeParse({
        ...input,
        confirmedBy: { id: 'demo-hr', name: '演示' },
      }).success,
    ).toBe(false);
    expect(
      confirmStandardAttributionInputSchema.safeParse({
        ...input,
        profileVersion: 2,
      }).success,
    ).toBe(false);
    expect(
      confirmStandardAttributionInputSchema.safeParse({
        ...input,
        caseIds: ['demo-comparison-1', 'demo-comparison-1'],
      }).success,
    ).toBe(false);
    expect(
      confirmStandardAttributionResultSchema.safeParse({
        status: 'success',
        replayed: false,
        result: confirmedStandardAttributionFixture(),
      }).success,
    ).toBe(true);
  });

  it('模型失败如实返回失败，不带成功结果或空假设冒充成功', () => {
    expect(
      generateStandardHypothesesResultSchema.safeParse({
        status: 'model_failed',
        message: '演示：模型超时',
      }).success,
    ).toBe(true);
    expect(
      generateStandardHypothesesResultSchema.safeParse({
        status: 'model_failed',
        message: '演示：模型超时',
        result: standardHypothesisFixture(),
      }).success,
    ).toBe(false);
    expect(
      generateStandardHypothesesResultSchema.safeParse({
        status: 'success',
        replayed: false,
        result: [],
      }).success,
    ).toBe(false);
    expect(
      generateStandardHypothesesResultSchema.safeParse({
        status: 'success',
        replayed: false,
        result: [standardHypothesisFixture()],
      }).success,
    ).toBe(true);
  });
});
