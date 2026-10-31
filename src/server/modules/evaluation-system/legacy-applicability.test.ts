import { describe, expect, it } from 'vitest';
import { planLegacyRuleVersionApplicability } from './legacy-applicability';

const usages = () => [
  { ruleVersionId: 'rubric-v1', usedAt: new Date('2026-07-10T00:00:00Z') },
  { ruleVersionId: 'rubric-v1', usedAt: new Date('2026-07-01T00:00:00Z') },
  { ruleVersionId: 'xe-weekly-v1', usedAt: new Date('2026-08-02T00:00:00Z') },
];
describe('已知旧版 applicability 计划', () => {
  it('rubric 与周评分开归类，起点只取各自真实使用证据的最早时间', () => {
    const evidence = usages();
    const plan = planLegacyRuleVersionApplicability(
      ['rubric-v1', 'xe-weekly-v1'],
      evidence,
    );
    expect(plan.unresolved).toEqual([]);
    expect(plan.rows).toEqual([
      {
        versionId: 'rubric-v1',
        category: 'dimension_anchors',
        effectiveFrom: new Date('2026-07-01T00:00:00Z'),
        effectiveUntil: null,
      },
      {
        versionId: 'xe-weekly-v1',
        category: 'xe_weekly',
        effectiveFrom: new Date('2026-08-02T00:00:00Z'),
        effectiveUntil: null,
      },
    ]);
    expect(evidence[0].usedAt.toISOString()).toBe('2026-07-10T00:00:00.000Z');
  });
  it.each([
    'unknown',
    'published',
    'rubric-v2',
    'xe-select-v1',
    'xe-weekly-v2',
  ])('不把未知/新版本 %s 默认为维度锚点', (id) => {
    expect(planLegacyRuleVersionApplicability([id], usages())).toEqual({
      rows: [],
      unresolved: [{ versionId: id, reason: 'unrecognized_legacy_version' }],
    });
  });
  it('缺少使用时间时保留缺口，不拿导入时间或其他版本时间代替', () => {
    const plan = planLegacyRuleVersionApplicability(
      ['rubric-v1', 'xe-weekly-v1'],
      usages().filter((item) => item.ruleVersionId === 'xe-weekly-v1'),
    );
    expect(plan.unresolved).toEqual([
      { versionId: 'rubric-v1', reason: 'missing_usage_time' },
    ]);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].category).toBe('xe_weekly');
  });
  it('存在无效使用时间时不忽略坏证据后静默选另一条', () => {
    const plan = planLegacyRuleVersionApplicability(
      ['rubric-v1'],
      [
        ...usages(),
        { ruleVersionId: 'rubric-v1', usedAt: new Date('invalid') },
      ],
    );
    expect(plan.rows).toEqual([]);
    expect(plan.unresolved).toEqual([
      { versionId: 'rubric-v1', reason: 'invalid_usage_time' },
    ]);
  });
  it('重复版本标识只形成一行，空目录不制造元数据', () => {
    expect(
      planLegacyRuleVersionApplicability(['rubric-v1', 'rubric-v1'], usages())
        .rows,
    ).toHaveLength(1);
    expect(planLegacyRuleVersionApplicability([], usages())).toEqual({
      rows: [],
      unresolved: [],
    });
  });
});
