import { expect, it } from 'vitest';
import {
  canConfirmOwnNodeScore,
  type EvaluationAuthzContext,
} from '../../authz/evaluation-node';
import type { MaterialSourceReference } from '../../../contracts/sources';
import {
  canConfirmNodeConclusion,
  canReadNodeConclusion,
  confirmNodeConclusionInputSchema,
  nodeConclusionVersionSchema,
  nodeConclusionFingerprint,
  planNodeConclusion,
  requireNodeConclusionSources,
  type NodeScoreAuthority,
  type ResolvedNodeConclusionSource,
} from './node-conclusion';

function fixture() {
  const identity = { evaluationNodeId: 'defense-a', personId: 'demo-a' };
  const context: EvaluationAuthzContext = {
    account: { id: 'account-hr', personId: 'hr', isSystemAdmin: false },
    now: '2026-09-04T00:00:00.000Z',
    people: [
      { id: 'demo-a', noReview: false },
      { id: 'demo-b', noReview: false },
    ],
    grants: [
      {
        accountId: 'account-hr',
        role: 'hr',
        scope: 'cohort',
        cohortId: 'cohort-a',
        validFrom: '2026-01-01',
        validTo: null,
        revokedAt: null,
      },
    ],
    enrollments: [
      {
        personId: 'demo-a',
        cohortId: 'cohort-a',
        confirmed: true,
        validFrom: '2026-01-01',
        validTo: null,
        revokedAt: null,
      },
      {
        personId: 'demo-b',
        cohortId: 'cohort-b',
        confirmed: true,
        validFrom: '2026-01-01',
        validTo: null,
        revokedAt: null,
      },
    ],
    assignments: [],
    projects: [],
    members: [],
    evaluationNodes: [
      { id: 'defense-a', kind: 'defense', cohortId: 'cohort-a' },
      { id: 'defense-b', kind: 'defense', cohortId: 'cohort-b' },
      { id: 'interview-a', kind: 'interview', cohortId: 'cohort-a' },
    ],
    evaluationNodeSubjects: [
      identity,
      { evaluationNodeId: 'defense-b', personId: 'demo-b' },
      { evaluationNodeId: 'interview-a', personId: 'demo-a' },
    ],
    evaluationRelations: [
      {
        id: 'judge-a',
        ...identity,
        evaluatorId: 'judge',
        kind: 'judge',
        validFrom: '2026-01-01',
        validTo: null,
        revokedAt: null,
      },
    ],
  };
  const reference: MaterialSourceReference = {
    fragmentId: 'fragment-demo',
    originalVersionId: 'original-v1',
    location: { kind: 'presentation', slide: 2 },
  };
  const sources: ResolvedNodeConclusionSource[] = [
    { reference, subjects: [identity], kind: 'evaluation', requiredKinds: [] },
  ];
  const scores: NodeScoreAuthority = {
    status: 'ready',
    ...identity,
    revision: 'score-confirmations-v1',
    confirmations: [
      {
        confirmationId: 'score-confirmation-a',
        evaluatorId: 'judge',
        version: 2,
        confirmedAt: '2026-09-03T12:00:00Z',
      },
    ],
  };
  const command = {
    ...identity,
    operationId: 'op-a',
    expectedVersion: 0,
    expectedScoreRevision: 'score-confirmations-v1',
    conclusion: '演示：答辩通过，保留材料中列出的改进事项。',
    basisReferences: [reference],
  };
  const input: Parameters<typeof planNodeConclusion>[0] = {
    command,
    current: null,
    context,
    actor: { id: 'hr', name: '演示·HR' },
    now: '2031-04-05T06:07:08.000Z',
    newId: 'conclusion-a',
    scores,
    sources,
  };
  return { identity, context, reference, sources, scores, command, input };
}
it('只由范围内HR形成人工署名版本，保留原件定位与权威评分确认版本', () => {
  const f = fixture(),
    result = planNodeConclusion(f.input);
  expect(result).toMatchObject({
    id: 'conclusion-a',
    ...f.identity,
    conclusionType: 'defense',
    origin: 'human_conclusion',
    version: 1,
    conclusion: f.command.conclusion,
    confirmedBy: { id: 'hr', name: '演示·HR' },
    confirmedAt: f.input.now,
    basis: {
      scoreConfirmationRevision: 'score-confirmations-v1',
      confirmations: f.scores.status === 'ready' ? f.scores.confirmations : [],
      references: [f.reference],
    },
  });
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.basis.references[0]!.location)).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(
    /eventId|scoreValue|rank|percentage|employmentStatus/,
  );
});
it('修订追加第二版而不改写第一版署名、内容和依据', () => {
  const f = fixture(),
    first = planNodeConclusion(f.input),
    snapshot = JSON.stringify(first);
  const next = planNodeConclusion({
    ...f.input,
    command: {
      ...f.command,
      expectedVersion: 1,
      conclusion: '演示：补充经核实的结论。',
    },
    current: first,
    actor: { id: 'hr', name: '演示·HR新显示名' },
    now: '2031-04-05T06:08:00.000Z',
  });
  expect(next.id).toBe(first.id);
  expect(next.version).toBe(2);
  expect(next.confirmedBy.name).toBe('演示·HR新显示名');
  expect(JSON.stringify(first)).toBe(snapshot);
});
it('旧版本和另一节点/人员的当前记录不能被覆盖', () => {
  const f = fixture(),
    current = planNodeConclusion(f.input);
  expect(() => planNodeConclusion({ ...f.input, current })).toThrow(/版本/);
  expect(() =>
    planNodeConclusion({
      ...f.input,
      current: { ...current, personId: 'demo-b' },
      command: { ...f.command, expectedVersion: 1 },
    }),
  ).toThrow(/身份|节点|人员/);
});
it('管理者只读；评委能确认本人评分但不能确认节点结论', () => {
  const f = fixture(),
    manager = structuredClone(f.context);
  manager.account = {
    ...manager.account,
    id: 'account-manager',
    personId: 'manager',
  };
  manager.grants = [
    {
      ...manager.grants[0]!,
      accountId: 'account-manager',
      role: 'manager',
      scope: 'company',
      cohortId: null,
    },
  ];
  expect(canReadNodeConclusion(manager, f.identity)).toBe(true);
  expect(canConfirmNodeConclusion(manager, f.identity)).toBe(false);
  const judge = structuredClone(f.context);
  judge.account = { ...judge.account, id: 'account-judge', personId: 'judge' };
  judge.grants = [];
  expect(
    canConfirmOwnNodeScore(judge, { ...f.identity, raterId: 'judge' }),
  ).toBe(true);
  expect(canConfirmNodeConclusion(judge, f.identity)).toBe(false);
  expect(canReadNodeConclusion(judge, f.identity)).toBe(false);
});
it.each([
  'revoked',
  'outside',
  'admin',
  'employee',
  'missing_subject',
  'no_review',
] as const)('拒绝%s身份或范围，不能借已存结论授权', (mode) => {
  const f = fixture();
  if (mode === 'revoked') f.context.grants[0]!.revokedAt = f.context.now;
  if (mode === 'outside') f.context.grants[0]!.cohortId = 'cohort-b';
  if (mode === 'admin') f.context.account.isSystemAdmin = true;
  if (mode === 'employee') {
    f.context.account.personId = 'demo-a';
    f.context.grants = [];
  }
  if (mode === 'missing_subject') f.context.evaluationNodeSubjects = [];
  if (mode === 'no_review') f.context.people[0]!.noReview = true;
  expect(canConfirmNodeConclusion(f.context, f.identity)).toBe(false);
  expect(() => planNodeConclusion(f.input)).toThrow();
});
it('第一片只确认人工答辩结论，不自动把面试评价变为录用或转正', () => {
  const f = fixture(),
    identity = { ...f.identity, evaluationNodeId: 'interview-a' };
  expect(canConfirmNodeConclusion(f.context, identity)).toBe(false);
});
it.each(['pending', 'unavailable', 'missing', 'wrong_node', 'empty'] as const)(
  '权威评分确认%s时拒绝，不能从任务或已有分数推断',
  (state) => {
    const f = fixture();
    if (state === 'pending' || state === 'unavailable')
      f.input.scores = { ...f.identity, status: state };
    if (state === 'missing')
      f.input.scores = null as unknown as NodeScoreAuthority;
    if (state === 'wrong_node')
      f.input.scores = { ...f.scores, evaluationNodeId: 'defense-b' };
    if (state === 'empty' && f.input.scores?.status === 'ready')
      f.input.scores.confirmations = [];
    expect(() => planNodeConclusion(f.input)).toThrow(/评分|确认|依据/);
  },
);
it('当前账号绑定与署名人必须一致', () => {
  const f = fixture();
  f.input.actor.id = 'judge';
  expect(() => planNodeConclusion(f.input)).toThrow(/署名|身份/);
});
it('引用必须解析为同一节点/主体的真实定位，完整共同主体都须当前可读', () => {
  const f = fixture();
  expect(
    requireNodeConclusionSources(
      f.context,
      f.identity,
      [f.reference],
      f.sources,
    ),
  ).toEqual([f.reference]);
  const mixed = structuredClone(f.sources);
  mixed[0]!.subjects.push({
    evaluationNodeId: 'defense-b',
    personId: 'demo-b',
  });
  expect(() =>
    requireNodeConclusionSources(f.context, f.identity, [f.reference], mixed),
  ).toThrow();
  const foreign = structuredClone(f.sources);
  foreign[0]!.subjects = [
    { evaluationNodeId: 'defense-b', personId: 'demo-b' },
  ];
  expect(() =>
    requireNodeConclusionSources(f.context, f.identity, [f.reference], foreign),
  ).toThrow();
  const moved = structuredClone(f.sources);
  moved[0]!.reference.originalVersionId = 'original-v2';
  expect(() =>
    requireNodeConclusionSources(f.context, f.identity, [f.reference], moved),
  ).toThrow();
  expect(() =>
    requireNodeConclusionSources(f.context, f.identity, [f.reference], null),
  ).toThrow();
});
it('来源所需内容类型不能被剥离；未知或AI推断引用不作为原始依据', () => {
  const f = fixture(),
    inferred = structuredClone(f.sources);
  inferred[0]!.requiredKinds.push('ai-inference');
  expect(() =>
    requireNodeConclusionSources(
      f.context,
      f.identity,
      [f.reference],
      inferred,
    ),
  ).toThrow();
  const noSubjects = structuredClone(f.sources);
  noSubjects[0]!.subjects = [];
  expect(() =>
    requireNodeConclusionSources(
      f.context,
      f.identity,
      [f.reference],
      noSubjects,
    ),
  ).toThrow();
});
it('请求不接受actor/role/time或假事件，引用严格消费897定位', () => {
  const f = fixture();
  expect(
    confirmNodeConclusionInputSchema.safeParse({
      ...f.command,
      actorId: 'judge',
      confirmedAt: f.input.now,
    }).success,
  ).toBe(false);
  expect(
    confirmNodeConclusionInputSchema.safeParse({
      ...f.command,
      eventId: 'fake',
    }).success,
  ).toBe(false);
  expect(
    confirmNodeConclusionInputSchema.safeParse({
      ...f.command,
      basisReferences: [f.reference, f.reference],
    }).success,
  ).toBe(false);
  expect(
    confirmNodeConclusionInputSchema.safeParse({
      ...f.command,
      basisReferences: [],
    }).success,
  ).toBe(false);
  expect(
    confirmNodeConclusionInputSchema.safeParse({
      ...f.command,
      basisReferences: [
        {
          ...f.reference,
          location: { kind: 'pdf', page: 1, textRange: { start: 10, end: 5 } },
        },
      ],
    }).success,
  ).toBe(false);
});
it('幂等指纹保留语义，引用顺序不制造重复确认', () => {
  const f = fixture(),
    other: MaterialSourceReference = {
      ...f.reference,
      fragmentId: 'fragment-other',
    };
  const input = { ...f.command, basisReferences: [f.reference, other] };
  expect(nodeConclusionFingerprint(input)).toBe(
    nodeConclusionFingerprint({
      ...input,
      basisReferences: [other, f.reference],
    }),
  );
  expect(nodeConclusionFingerprint(input)).not.toBe(
    nodeConclusionFingerprint({ ...input, conclusion: '演示：改变结论' }),
  );
});
it('持久版本拒绝AI冒充人工来源与缺失引用', () => {
  const f = fixture(),
    record = planNodeConclusion(f.input);
  expect(
    nodeConclusionVersionSchema.safeParse({ ...record, origin: 'ai_inference' })
      .success,
  ).toBe(false);
  expect(
    nodeConclusionVersionSchema.safeParse({
      ...record,
      basis: { ...record.basis, references: [] },
    }).success,
  ).toBe(false);
});

it('损坏或重复的来源解析拒绝，不能用数量相等代替精确定位', () => {
  const f = fixture(),
    other: MaterialSourceReference = {
      ...f.reference,
      fragmentId: 'fragment-other',
    };
  expect(() =>
    requireNodeConclusionSources(f.context, f.identity, [f.reference], []),
  ).toThrow(/引用/);
  expect(() =>
    requireNodeConclusionSources(
      f.context,
      f.identity,
      [f.reference, other],
      [f.sources[0]!, f.sources[0]!],
    ),
  ).toThrow(/重复/);
  const invalid = structuredClone(f.sources);
  invalid[0]!.reference.location = { kind: 'presentation', slide: 0 };
  expect(() =>
    requireNodeConclusionSources(f.context, f.identity, [f.reference], invalid),
  ).toThrow(/定位/);
  expect(() =>
    requireNodeConclusionSources(f.context, f.identity, [], []),
  ).toThrow(/引用/);
});

it('HR所据评分确认版本过期时不能悄悄以新评分签署', () => {
  const f = fixture();
  expect(() =>
    planNodeConclusion({
      ...f.input,
      command: { ...f.command, expectedScoreRevision: 'old-confirmations' },
    }),
  ).toThrow(/评分确认版本/);
});
