import { expect, it } from 'vitest';
import {
  projectHrAttributionBatch,
  createAttributionReadAdapter,
  type AttributionReadServices,
} from './read-adapter';
import { dataset } from '../../modules/evaluation-system/judgment-comparison/test-fixtures';
import type { EvaluationAuthzContext } from '../../authz/evaluation-node';
import type { loadEvaluationContext } from '../evaluation-context';
import type { Transaction } from '../../db/client';
function setup() {
  const data = dataset();
  const context: EvaluationAuthzContext = {
    account: { id: 'account-hr', personId: 'hr', isSystemAdmin: false },
    now: '2026-11-01T00:00:00Z',
    people: data.cases.map((c) => ({ id: c.person.id, noReview: false })),
    grants: [
      {
        accountId: 'account-hr',
        role: 'hr',
        scope: 'cohort',
        cohortId: 'cohort6',
        validFrom: '2026-01-01',
        validTo: null,
        revokedAt: null,
      },
    ],
    enrollments: data.cases.map((c) => ({
      personId: c.person.id,
      cohortId: 'cohort6',
      confirmed: true,
      validFrom: '2026-01-01',
      validTo: null,
      revokedAt: null,
    })),
    assignments: [],
    projects: [],
    members: [],
    evaluationNodes: [
      { id: 'selection', kind: 'interview', cohortId: 'cohort6' },
      { id: 'graduation', kind: 'defense', cohortId: 'cohort6' },
    ],
    evaluationNodeSubjects: data.cases.flatMap((c) =>
      ['selection', 'graduation'].map((evaluationNodeId) => ({
        evaluationNodeId,
        personId: c.person.id,
      })),
    ),
    evaluationRelations: [],
  };
  const person = {
    id: 'hr',
    name: '苏晚（演示）',
    organizationId: 'org',
    photo: null,
    hue: 220,
    noReview: false,
    demo: true,
  };
  const identity: Awaited<ReturnType<typeof loadEvaluationContext>> = {
    context: { ...context, hrCandidateGrants: [] },
    directory: {
      account: context.account,
      grants: [],
      people: [person],
      organizations: [],
    },
    staffing: { projects: [], members: [] },
    facts: {
      evaluationNodes: context.evaluationNodes.map((node) => ({
        ...node,
        name: '合成节点',
      })),
      evaluationNodeSubjects: context.evaluationNodeSubjects,
      evaluationRelations: [],
    },
  };
  return { identity, data };
}
it('按原事实计算结果，保留人工不可比与缺段；不会读expected统计', () => {
  const { identity, data } = setup();
  const value = projectHrAttributionBatch(identity, data, 'batch');
  expect(value?.candidates).toHaveLength(8);
  expect(
    value?.candidates.find((c) => c.id === 'case-7')?.outcome,
  ).toMatchObject({
    state: 'not_comparable',
    reason: '两次任务范围不同（演示）',
  });
  expect(value?.candidates.find((c) => c.id === 'case-6')?.outcome.state).toBe(
    'missing',
  );
  expect(value?.actor).toEqual({ id: 'hr', name: '苏晚（演示）' });
});
it.each(['manager', 'mentor'] as const)('纯%s不获得HR归因材料', (role) => {
  const { identity, data } = setup();
  identity.context.grants = [
    {
      ...identity.context.grants[0],
      role,
      scope: role === 'manager' ? 'company' : 'cohort',
      cohortId: role === 'manager' ? null : 'cohort6',
    },
  ];
  expect(projectHrAttributionBatch(identity, data, 'batch')).toBeNull();
});
it.each(['judge', 'mentor', 'assistant'] as const)(
  '跨期HR+%s不能借评价关系读本批次',
  (kind) => {
    const { identity, data } = setup();
    identity.context.grants[0].cohortId = 'outside';
    identity.context.evaluationRelations = data.cases.flatMap((c) =>
      ['selection', 'graduation'].map((evaluationNodeId) => ({
        id: c.id + evaluationNodeId,
        evaluatorId: 'hr',
        personId: c.person.id,
        evaluationNodeId,
        kind,
        validFrom: '2026-01-01',
        validTo: null,
        revokedAt: null,
      })),
    );
    expect(projectHrAttributionBatch(identity, data, 'batch')).toBeNull();
  },
);
it.each(['missing_back', 'no_review', 'expired_enrollment'] as const)(
  '%s条目两段都不披露给模型',
  (mode) => {
    const { identity, data } = setup();
    if (mode === 'missing_back')
      identity.context.evaluationNodeSubjects =
        identity.context.evaluationNodeSubjects.filter(
          (s) =>
            !(s.personId === 'person-1' && s.evaluationNodeId === 'graduation'),
        );
    if (mode === 'no_review')
      identity.context.people.find((p) => p.id === 'person-1')!.noReview = true;
    if (mode === 'expired_enrollment')
      identity.context.enrollments.find(
        (e) => e.personId === 'person-1',
      )!.validTo = '2026-11-01';
    const result = projectHrAttributionBatch(identity, data, 'batch');
    expect(result?.authorizedCaseIds).not.toContain('case-1');
    expect(result?.candidates.some((c) => c.person.id === 'person-1')).toBe(
      false,
    );
  },
);
it.each(['blank_name', 'wrong_account', 'wrong_person'] as const)(
  '目录署名%s失败关闭',
  (mode) => {
    const { identity, data } = setup();
    if (mode === 'blank_name') identity.directory.people[0].name = ' ';
    if (mode === 'wrong_account')
      identity.directory.account = {
        ...identity.directory.account,
        id: 'other',
      };
    if (mode === 'wrong_person')
      identity.directory.account = {
        ...identity.directory.account,
        personId: 'other',
      };
    expect(projectHrAttributionBatch(identity, data, 'batch')).toBeNull();
  },
);
it('错批/错版本和预计算outcome不是canonical输入', () => {
  const { identity, data } = setup();
  expect(() => projectHrAttributionBatch(identity, data, 'other')).toThrow();
  data.mapping.versionId = 'map-xe-select-v2';
  expect(() => projectHrAttributionBatch(identity, data, 'batch')).toThrow();
  data.mapping.versionId = 'map-xe-select-v1';
  Object.assign(data.cases[0], { outcome: { state: 'consistent' } });
  expect(() => projectHrAttributionBatch(identity, data, 'batch')).toThrow(
    /预先计算/,
  );
});
it('无reader明确unavailable，无默认空数据', () => {
  expect(() =>
    createAttributionReadAdapter({} as AttributionReadServices),
  ).toThrow(/尚未接通/);
});
it('精确读取标准内容；未知/错误类别/错误版本不能冒正确基准', async () => {
  let current: unknown = null;
  const adapter = createAttributionReadAdapter({
    readCanonicalComparisonBatch: async () => null,
    readSelectionStandard: async () => current as never,
  });
  const tx = {} as Transaction;
  expect(await adapter.readStandard(tx, 'xe-select-v1')).toBeNull();
  current = {
    version: {
      category: 'xe_selection',
      versionId: 'xe-select-v2',
      provenance: 'published',
      effectiveFrom: '2026-01-01T00:00:00Z',
      effectiveUntil: null,
    },
    content: {
      reviewPoints: [{ id: 'p', title: '演示', description: '演示' }],
    },
  };
  await expect(adapter.readStandard(tx, 'xe-select-v1')).rejects.toThrow(
    /不一致/,
  );
  current = {
    version: {
      category: 'xe_weekly',
      versionId: 'xe-weekly-v1',
      provenance: 'published',
      effectiveFrom: '2026-01-01T00:00:00Z',
      effectiveUntil: null,
    },
    content: { reviewPoints: [] },
  };
  await expect(adapter.readStandard(tx, 'xe-select-v1')).rejects.toThrow(
    /不一致/,
  );
});
