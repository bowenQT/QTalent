import { describe, expect, it } from 'vitest';
import {
  evaluationContextFixture,
  evaluationWorkFixture,
} from '../modules/programs/reassignment.fixtures';
import type { ReassignmentAuthzContext } from '../authz/reassignment-handlers';
import { workbenchTodosFromFacts } from './workbench-todos';

const context = (): ReassignmentAuthzContext => ({
  ...evaluationContextFixture(),
  hrCandidateGrants: [],
});
const own = () => ({
  ...evaluationWorkFixture(),
  assignedRelationId: 'demo-new-relation',
  assignedEvaluatorId: 'demo-new-evaluator',
  kind: 'speaker' as const,
});
function mentor() {
  const ctx = context();
  ctx.account = {
    id: 'demo-mentor-account',
    personId: 'demo-new-evaluator',
    isSystemAdmin: false,
  };
  ctx.grants = [
    { ...ctx.grants[0], accountId: ctx.account.id, role: 'mentor' },
  ];
  return ctx;
}
function items(ctx = mentor(), rows = [own()]) {
  const result = workbenchTodosFromFacts(ctx, rows);
  if (result.status !== 'not_connected')
    throw new Error('Expected source projection');
  return result.registeredWork;
}

describe('BOW-863 registered work source', () => {
  it('counts the exact assigned task once, without claiming complete todos', () => {
    const row = own();
    expect(items(mentor(), [row, { ...row }])).toEqual({
      status: 'ready',
      count: 1,
      items: [
        {
          id: row.id,
          evaluationNodeId: row.evaluationNodeId,
          personId: row.personId,
          kind: 'speaker',
          resourceId: row.resourceId,
          revision: 1,
          action: 'handle',
        },
      ],
    });
    const result = workbenchTodosFromFacts(mentor(), []);
    expect(result).toMatchObject({
      status: 'not_connected',
      registeredWork: { count: 0 },
      scoreReviews: { status: 'not_connected' },
      speakerInventory: { status: 'not_connected' },
      nodeCoverage: { status: 'not_connected' },
    });
    expect(result).not.toHaveProperty('count');
  });
  it('does not merge different tasks for the same person or matching raw resource IDs', () => {
    const row = own();
    const rows = [
      row,
      { ...row, id: 'second', resourceId: 'another-task' },
      { ...row, id: 'third', kind: 'confirmation' as const },
    ];
    const result = workbenchTodosFromFacts(mentor(), rows);
    expect(result).toMatchObject({ registeredWork: { count: 3 } });
  });
  it('sorts by stable task identity, not personnel score or rank', () => {
    expect(
      items(mentor(), [
        { ...own(), id: 'z', resourceId: 'z' },
        own(),
        { ...own(), id: 'a', resourceId: 'a' },
      ]).items.map((x) => x.id),
    ).toEqual(['a', 'demo-work-item', 'z']);
  });
  it.each(['completed', 'cancelled'] as const)('omits %s tasks', (state) => {
    expect(
      workbenchTodosFromFacts(mentor(), [{ ...own(), state }]),
    ).toMatchObject({ registeredWork: { count: 0 } });
  });
  it('processing is still outstanding', () => {
    expect(
      workbenchTodosFromFacts(mentor(), [{ ...own(), state: 'processing' }]),
    ).toMatchObject({ registeredWork: { count: 1 } });
  });
  it.each([
    'expired',
    'revoked',
    'future',
    'other-node',
    'other-person',
    'different-relation',
  ] as const)('rejects %s assignment facts', (change) => {
    const ctx = mentor();
    const relation = ctx.evaluationRelations[1];
    if (change === 'expired') relation.validTo = ctx.now;
    if (change === 'revoked') relation.revokedAt = ctx.now;
    if (change === 'future') relation.validFrom = '2099-01-01';
    if (change === 'other-node') relation.evaluationNodeId = 'demo-other-node';
    if (change === 'other-person') relation.personId = 'demo-hr';
    if (change === 'different-relation') relation.id = 'replacement';
    expect(items(ctx).count).toBe(0);
  });
  it('a current relation to someone else does not count their tasks', () => {
    const ctx = mentor();
    ctx.account.personId = 'demo-hr';
    expect(items(ctx).count).toBe(0);
  });
  it('noReview and missing node subject never disclose tasks', () => {
    const ctx = mentor();
    ctx.people[0].noReview = true;
    expect(items(ctx).count).toBe(0);
    ctx.people[0].noReview = false;
    ctx.evaluationNodeSubjects = [];
    expect(items(ctx).count).toBe(0);
  });
  it('HR receives a single reassign action for an expired owner, not their raw evidence', () => {
    const result = workbenchTodosFromFacts(context(), [
      evaluationWorkFixture(),
    ]);
    expect(result).toMatchObject({
      registeredWork: { count: 1, items: [{ action: 'reassign' }] },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /"(?:previousEvaluator|candidates|quote|source|scoreValue)":/,
    );
  });
  it.each(['completed', 'cancelled'] as const)(
    'HR does not get a reassign reminder for a %s task of an expired owner',
    (state) => {
      expect(
        workbenchTodosFromFacts(context(), [
          { ...evaluationWorkFixture(), state },
        ]),
      ).toMatchObject({ registeredWork: { count: 0, items: [] } });
    },
  );
  it('HR cannot claim a valid different owner or out-of-scope reassignment', () => {
    expect(items(context()).count).toBe(0);
    const ctx = context();
    ctx.enrollments = [];
    expect(
      workbenchTodosFromFacts(ctx, [evaluationWorkFixture()]),
    ).toMatchObject({ registeredWork: { count: 0 } });
  });
  it('manager has no todo count even with another HR role', () => {
    const ctx = context();
    ctx.grants.push({
      ...ctx.grants[0],
      role: 'manager',
      scope: 'company',
      cohortId: null,
    });
    expect(workbenchTodosFromFacts(ctx, [own()])).toEqual({
      status: 'not_applicable',
    });
  });
  it.each(['admin', 'no-role', 'expired-grant', 'different-account'] as const)(
    'denies %s',
    (change) => {
      const ctx = mentor();
      if (change === 'admin') ctx.account.isSystemAdmin = true;
      if (change === 'no-role') ctx.grants = [];
      if (change === 'expired-grant') ctx.grants[0].validTo = ctx.now;
      if (change === 'different-account') ctx.account.id = 'unbound-account';
      expect(() => items(ctx)).toThrow('无权限');
    },
  );
  it('fails conflicting duplicate facts rather than choosing a version', () => {
    expect(() => items(mentor(), [own(), { ...own(), revision: 2 }])).toThrow(
      '待办来源身份或版本不一致',
    );
  });
});
