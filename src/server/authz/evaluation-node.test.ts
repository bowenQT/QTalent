import { describe, expect, it } from 'vitest';
import type { BusinessRole, Grant, Validity } from './index';
import type { TalentKind } from './talent';
import {
  canConfirmOwnNodeScore,
  canEvaluateNode,
  canManageNodeAssignments,
  canReadNodeTalent,
  eligibleNodeEvaluatorRelations,
  type EvaluationAuthzContext,
  type EvaluationRelation,
} from './evaluation-node';

const now = '2026-10-31T12:00:00.000Z';
const before = '2026-10-31T11:59:59.999Z';
const after = '2026-10-31T12:00:00.001Z';
const validity: Validity = {
  validFrom: '2026-10-01T00:00:00.000Z',
  validTo: null,
  revokedAt: null,
};
const nodeId = 'demo-program-node';
const interviewId = 'demo-interview-node';
const defenseId = 'demo-defense-node';
const personId = 'demo-talent-001';
const evaluatorId = 'demo-evaluator-001';
const successorId = 'demo-evaluator-002';
const cohortId = 'demo-cohort-a';
const otherCohortId = 'demo-cohort-b';

function relation(
  overrides: Partial<EvaluationRelation> = {},
): EvaluationRelation {
  return {
    id: 'demo-evaluation-relation',
    evaluationNodeId: nodeId,
    evaluatorId,
    personId,
    kind: 'evaluator',
    ...validity,
    ...overrides,
  };
}
function grant(role: BusinessRole): Grant {
  return {
    accountId: 'demo-account',
    role,
    scope: role === 'manager' ? 'company' : 'cohort',
    cohortId: role === 'manager' ? null : cohortId,
    ...validity,
  };
}
function context(): EvaluationAuthzContext {
  return {
    account: {
      id: 'demo-account',
      personId: evaluatorId,
      isSystemAdmin: false,
    },
    now,
    grants: [],
    enrollments: [{ cohortId, personId, confirmed: true, ...validity }],
    assignments: [],
    projects: [],
    members: [],
    people: [
      { id: personId, noReview: false },
      { id: 'demo-talent-002', noReview: false },
      { id: evaluatorId, noReview: false },
      { id: successorId, noReview: false },
    ],
    evaluationNodes: [
      { id: nodeId, kind: 'program_cohort', cohortId },
      { id: interviewId, kind: 'interview', cohortId },
      { id: defenseId, kind: 'defense', cohortId: otherCohortId },
    ],
    evaluationNodeSubjects: [
      { evaluationNodeId: nodeId, personId },
      { evaluationNodeId: interviewId, personId },
      { evaluationNodeId: defenseId, personId },
    ],
    evaluationRelations: [relation()],
  };
}
function privilegedContext(role: 'manager' | 'hr'): EvaluationAuthzContext {
  const ctx = context();
  ctx.grants = [grant(role)];
  ctx.evaluationRelations = [];
  return ctx;
}
function resource(kind: TalentKind = 'evaluation', evaluationNodeId = nodeId) {
  return { evaluationNodeId, personId, kind };
}
function expectDenied(
  ctx: EvaluationAuthzContext,
  evaluationNodeId = nodeId,
  subjectId = personId,
) {
  expect(
    canReadNodeTalent(
      ctx,
      { evaluationNodeId, personId: subjectId, kind: 'evaluation' },
      'person-profile',
    ),
  ).toBe(false);
  expect(canEvaluateNode(ctx, evaluationNodeId, subjectId)).toBe(false);
  expect(
    canConfirmOwnNodeScore(ctx, {
      evaluationNodeId,
      personId: subjectId,
      raterId: ctx.account.personId,
    }),
  ).toBe(false);
  expect(canManageNodeAssignments(ctx, evaluationNodeId, subjectId)).toBe(
    false,
  );
  expect(
    eligibleNodeEvaluatorRelations(ctx, evaluationNodeId, subjectId),
  ).toEqual([]);
}

describe('evaluation node relations', () => {
  it.each([
    ['program_cohort', nodeId],
    ['interview', interviewId],
    ['defense', defenseId],
  ])('authorizes a %s node without a project or legacy grant', (_, id) => {
    const ctx = context();
    ctx.evaluationRelations = [relation({ evaluationNodeId: id })];
    expect(ctx.projects).toEqual([]);
    for (const kind of ['person', 'evaluation', 'confirmed-score'] as const) {
      expect(canReadNodeTalent(ctx, resource(kind, id), 'person-profile')).toBe(
        true,
      );
    }
    expect(canEvaluateNode(ctx, id, personId)).toBe(true);
    expect(
      canConfirmOwnNodeScore(ctx, {
        evaluationNodeId: id,
        personId,
        raterId: evaluatorId,
      }),
    ).toBe(true);
  });

  it.each<EvaluationRelation['kind']>([
    'evaluator',
    'mentor',
    'assistant',
    'interviewer',
    'judge',
  ])('uses an explicit current %s relation', (kind) => {
    const ctx = context();
    ctx.evaluationRelations = [relation({ kind })];
    expect(canReadNodeTalent(ctx, resource(), 'workbench')).toBe(true);
    expect(canEvaluateNode(ctx, nodeId, personId)).toBe(true);
    expect(
      canConfirmOwnNodeScore(ctx, {
        evaluationNodeId: nodeId,
        personId,
        raterId: evaluatorId,
      }),
    ).toBe(true);
  });

  it('does not carry a relation to another node of the same person and cohort', () => {
    expectDenied(context(), interviewId);
  });

  it('does not carry a relation to another subject of the same node', () => {
    const ctx = context();
    ctx.evaluationNodeSubjects.push({
      evaluationNodeId: nodeId,
      personId: 'demo-talent-002',
    });
    expectDenied(ctx, nodeId, 'demo-talent-002');
  });

  it('does not infer node permission from a legacy mentor assignment', () => {
    const ctx = context();
    ctx.grants = [grant('mentor')];
    ctx.assignments = [
      {
        cohortId,
        personId: evaluatorId,
        studentId: personId,
        kind: 'mentor',
        ...validity,
      },
    ];
    ctx.evaluationRelations = [];
    expectDenied(ctx);
  });

  it('does not borrow another evaluator relationship', () => {
    const ctx = context();
    ctx.evaluationRelations = [relation({ evaluatorId: successorId })];
    expectDenied(ctx);
  });

  it('allows the current successor on the same node without retaining old access', () => {
    const ctx = context();
    ctx.evaluationRelations = [
      relation({ validTo: now }),
      relation({ id: 'demo-successor-relation', evaluatorId: successorId }),
    ];
    expectDenied(ctx);
    ctx.account = {
      ...ctx.account,
      id: 'demo-successor-account',
      personId: successorId,
    };
    expect(canEvaluateNode(ctx, nodeId, personId)).toBe(true);
    expect(canReadNodeTalent(ctx, resource(), 'source-read')).toBe(true);
    expect(
      canConfirmOwnNodeScore(ctx, {
        evaluationNodeId: nodeId,
        personId,
        raterId: successorId,
      }),
    ).toBe(true);
    expect(
      canConfirmOwnNodeScore(ctx, {
        evaluationNodeId: nodeId,
        personId,
        raterId: evaluatorId,
      }),
    ).toBe(false);
  });

  it.each<[string, Partial<Validity>, boolean]>([
    ['inclusive start', { validFrom: now }, true],
    ['future start', { validFrom: after }, false],
    ['before end', { validTo: after }, true],
    ['exclusive end', { validTo: now }, false],
    ['expired', { validTo: before }, false],
    ['before revocation', { revokedAt: after }, true],
    ['revocation instant', { revokedAt: now }, false],
    ['already revoked', { revokedAt: before }, false],
  ])('applies the business clock at %s', (_, overrides, allowed) => {
    const ctx = context();
    ctx.evaluationRelations = [relation(overrides)];
    expect(canReadNodeTalent(ctx, resource(), 'person-profile')).toBe(allowed);
    expect(canEvaluateNode(ctx, nodeId, personId)).toBe(allowed);
    expect(
      canConfirmOwnNodeScore(ctx, {
        evaluationNodeId: nodeId,
        personId,
        raterId: evaluatorId,
      }),
    ).toBe(allowed);
  });

  it('rechecks relation expiry on each call', () => {
    const ctx = context();
    ctx.evaluationRelations = [relation({ validTo: after })];
    expect(canEvaluateNode(ctx, nodeId, personId)).toBe(true);
    ctx.now = after;
    expectDenied(ctx);
  });

  it('rejects an unknown relation kind', () => {
    const ctx = context();
    ctx.evaluationRelations = [
      relation({ kind: 'unknown' as EvaluationRelation['kind'] }),
    ];
    expectDenied(ctx);
  });
});

describe('node subject and content boundaries', () => {
  it('denies system administrators even with HR, manager and evaluation facts', () => {
    const ctx = context();
    ctx.account.isSystemAdmin = true;
    ctx.grants = [grant('manager'), grant('hr')];
    expectDenied(ctx);
  });

  it.each([
    'unknown person',
    'no-review person',
    'unknown node',
    'non-subject',
  ])('denies %s before applying any grant or relation', (boundary) => {
    const ctx = context();
    ctx.grants = [grant('manager'), grant('hr')];
    if (boundary === 'unknown person') {
      ctx.people = ctx.people.filter((person) => person.id !== personId);
    } else if (boundary === 'no-review person') {
      ctx.people.find((person) => person.id === personId)!.noReview = true;
    } else if (boundary === 'unknown node') {
      ctx.evaluationNodes = ctx.evaluationNodes.filter(
        (node) => node.id !== nodeId,
      );
    } else {
      ctx.evaluationNodeSubjects = [];
    }
    expectDenied(ctx);
  });

  it.each([
    'people-list',
    'person-preview',
    'person-profile',
    'workbench',
    'source-read',
    'model-input',
  ])('allows the documented %s purpose', (purpose) => {
    expect(canReadNodeTalent(context(), resource(), purpose)).toBe(true);
  });

  it.each(['', 'project-create', 'score-confirm'])(
    'rejects unknown purpose %j',
    (purpose) => {
      const ctx = context();
      ctx.grants = [grant('manager'), grant('hr')];
      expect(canReadNodeTalent(ctx, resource(), purpose)).toBe(false);
    },
  );

  it.each<TalentKind>([
    'quadrant',
    'management-observation',
    'change',
    'performance',
  ])('does not expose %s through an evaluator relation', (kind) => {
    expect(canReadNodeTalent(context(), resource(kind), 'person-profile')).toBe(
      false,
    );
  });

  it.each(['manager', 'hr'] as const)(
    'preserves %s read kinds without converting its grant into evaluation rights',
    (role) => {
      const ctx = privilegedContext(role);
      for (const kind of [
        'person',
        'evaluation',
        'confirmed-score',
        'quadrant',
        'management-observation',
        'change',
        'performance',
      ] as const) {
        expect(canReadNodeTalent(ctx, resource(kind), 'person-profile')).toBe(
          true,
        );
      }
      expect(canEvaluateNode(ctx, nodeId, personId)).toBe(false);
      expect(
        canConfirmOwnNodeScore(ctx, {
          evaluationNodeId: nodeId,
          personId,
          raterId: evaluatorId,
        }),
      ).toBe(false);
      expect(
        canReadNodeTalent(ctx, resource('performance'), 'model-input'),
      ).toBe(false);
      expect(
        canReadNodeTalent(ctx, resource('evaluation'), 'model-input'),
      ).toBe(true);
    },
  );

  it.each(['evaluator', 'manager', 'hr'] as const)(
    'requires source projection for AI inference with a %s account',
    (role) => {
      const ctx = role === 'evaluator' ? context() : privilegedContext(role);
      for (const purpose of ['person-profile', 'source-read', 'model-input']) {
        expect(canReadNodeTalent(ctx, resource('ai-inference'), purpose)).toBe(
          false,
        );
      }
    },
  );

  it.each(['evaluator', 'manager', 'hr'] as const)(
    'rejects a forged raterId even when the %s account has its own relation',
    (role) => {
      const ctx = role === 'evaluator' ? context() : privilegedContext(role);
      ctx.evaluationRelations = [relation()];
      expect(canEvaluateNode(ctx, nodeId, personId)).toBe(true);
      expect(
        canConfirmOwnNodeScore(ctx, {
          evaluationNodeId: nodeId,
          personId,
          raterId: successorId,
        }),
      ).toBe(false);
    },
  );
});

describe('HR current node scope and reassignment candidates', () => {
  it.each<[string, boolean, string | null, boolean]>([
    ['confirmed same cohort', true, cohortId, true],
    ['confirmed other cohort', true, otherCohortId, true],
    ['confirmed independent node', true, null, true],
    ['unconfirmed same cohort', false, cohortId, true],
    ['unconfirmed other cohort', false, otherCohortId, false],
    ['unconfirmed independent node', false, null, false],
  ])('uses %s enrollment scope', (_, confirmed, nodeCohortId, allowed) => {
    const ctx = privilegedContext('hr');
    ctx.enrollments[0]!.confirmed = confirmed;
    ctx.evaluationNodes[0]!.cohortId = nodeCohortId;
    expect(canReadNodeTalent(ctx, resource(), 'person-profile')).toBe(allowed);
    expect(canManageNodeAssignments(ctx, nodeId, personId)).toBe(allowed);
  });

  it.each<[string, Partial<Validity>]>([
    ['future', { validFrom: after }],
    ['expired', { validTo: now }],
    ['revoked', { revokedAt: now }],
  ])('rejects a %s HR grant', (_, overrides) => {
    const ctx = privilegedContext('hr');
    Object.assign(ctx.grants[0]!, overrides);
    expectDenied(ctx);
  });

  it.each<[string, Partial<Validity>]>([
    ['future', { validFrom: after }],
    ['expired', { validTo: now }],
    ['revoked', { revokedAt: now }],
  ])('rejects a %s HR enrollment', (_, overrides) => {
    const ctx = privilegedContext('hr');
    Object.assign(ctx.enrollments[0]!, overrides);
    expectDenied(ctx);
  });

  it('does not borrow another account HR grant or a malformed company HR scope', () => {
    const ctx = privilegedContext('hr');
    ctx.grants[0]!.accountId = 'demo-other-account';
    expectDenied(ctx);
    ctx.grants = [{ ...grant('hr'), scope: 'company', cohortId: null }];
    expectDenied(ctx);
  });

  it('does not combine an HR action with a separate mentor cohort grant', () => {
    const ctx = privilegedContext('hr');
    ctx.grants.push({ ...grant('mentor'), cohortId: otherCohortId });
    ctx.enrollments = [
      { personId, cohortId: otherCohortId, confirmed: false, ...validity },
    ];
    expectDenied(ctx, defenseId);
  });

  it('returns only current relations for the exact subject and node with directory evaluators', () => {
    const ctx = privilegedContext('hr');
    const original = relation();
    const successor = relation({
      id: 'demo-successor-relation',
      evaluatorId: successorId,
      kind: 'judge',
    });
    ctx.evaluationRelations = [
      original,
      successor,
      relation({ id: 'demo-other-node', evaluationNodeId: interviewId }),
      relation({ id: 'demo-other-subject', personId: 'demo-talent-002' }),
      relation({
        id: 'demo-missing-evaluator',
        evaluatorId: 'demo-absent-person',
      }),
      relation({ id: 'demo-expired', validTo: now }),
      relation({ id: 'demo-revoked', revokedAt: now }),
      relation({ id: 'demo-future', validFrom: after }),
      relation({
        id: 'demo-unknown-kind',
        kind: 'unknown' as EvaluationRelation['kind'],
      }),
    ];
    expect(eligibleNodeEvaluatorRelations(ctx, nodeId, personId)).toEqual([
      original,
      successor,
    ]);
    expect(eligibleNodeEvaluatorRelations(ctx, interviewId, personId)).toEqual([
      ctx.evaluationRelations[2],
    ]);
    expect(
      eligibleNodeEvaluatorRelations(ctx, nodeId, 'demo-talent-002'),
    ).toEqual([]);
    ctx.grants[0]!.revokedAt = now;
    expect(canManageNodeAssignments(ctx, nodeId, personId)).toBe(false);
    expect(eligibleNodeEvaluatorRelations(ctx, nodeId, personId)).toEqual([]);
  });

  it.each(['evaluator', 'manager'] as const)(
    'does not let a %s account manage or enumerate assignment candidates',
    (role) => {
      const ctx = role === 'evaluator' ? context() : privilegedContext(role);
      ctx.evaluationRelations = [relation()];
      expect(canEvaluateNode(ctx, nodeId, personId)).toBe(true);
      expect(canManageNodeAssignments(ctx, nodeId, personId)).toBe(false);
      expect(eligibleNodeEvaluatorRelations(ctx, nodeId, personId)).toEqual([]);
    },
  );
});
