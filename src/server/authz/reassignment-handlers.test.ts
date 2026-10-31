import { expect, it } from 'vitest';
import {
  eligibleEvaluationWorkRelations,
  type ReassignmentAuthzContext,
} from './reassignment-handlers';
import {
  evaluationContextFixture,
  evaluationWorkFixture,
} from '../modules/programs/reassignment.fixtures';

it('requires current scoped HR authority as well as the same-node relation for an unknown interviewer', () => {
  const ctx: ReassignmentAuthzContext = evaluationContextFixture();
  const item = { ...evaluationWorkFixture(), kind: 'unknown_interviewer' };
  expect(eligibleEvaluationWorkRelations(ctx, item)).toEqual([]);
  ctx.hrCandidateGrants = [
    {
      accountId: 'demo-new-account',
      personId: 'demo-new-evaluator',
      isSystemAdmin: false,
      grant: { ...ctx.grants[0], accountId: 'demo-new-account' },
    },
  ];
  expect(eligibleEvaluationWorkRelations(ctx, item).map((r) => r.id)).toEqual([
    'demo-new-relation',
  ]);
  ctx.hrCandidateGrants[0].grant.revokedAt = ctx.now;
  expect(eligibleEvaluationWorkRelations(ctx, item)).toEqual([]);
});
it('does not grant HR handling via a relation label, a system account or another HR scope', () => {
  for (const change of [
    { isSystemAdmin: true },
    {
      grant: {
        ...evaluationContextFixture().grants[0],
        accountId: 'demo-new-account',
        cohortId: 'outside-cohort',
      },
    },
    {
      grant: {
        ...evaluationContextFixture().grants[0],
        accountId: 'someone-else',
      },
    },
  ]) {
    const ctx: ReassignmentAuthzContext = evaluationContextFixture();
    ctx.hrCandidateGrants = [
      {
        accountId: 'demo-new-account',
        personId: 'demo-new-evaluator',
        isSystemAdmin: false,
        grant: { ...ctx.grants[0], accountId: 'demo-new-account' },
        ...change,
      },
    ];
    expect(
      eligibleEvaluationWorkRelations(ctx, {
        ...evaluationWorkFixture(),
        kind: 'unknown_interviewer',
      }),
    ).toEqual([]);
  }
});
it('keeps other review/confirmation candidates within the existing exact node scope', () => {
  const ctx = evaluationContextFixture();
  for (const kind of [
    'confirmation',
    'speaker',
    'unknown_person',
    'image_scope',
  ]) {
    expect(
      eligibleEvaluationWorkRelations(ctx, {
        ...evaluationWorkFixture(),
        kind,
      }).map((r) => r.id),
    ).toEqual(['demo-new-relation']);
  }
  ctx.evaluationRelations[1].evaluationNodeId = 'demo-other-node';
  expect(eligibleEvaluationWorkRelations(ctx, evaluationWorkFixture())).toEqual(
    [],
  );
});
