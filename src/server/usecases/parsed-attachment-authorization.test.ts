import { expect, it } from 'vitest';
import { canConfirmOwnNodeScore } from '../authz/evaluation-node';
import { evaluationContextFixture } from '../modules/programs/reassignment.fixtures';
import { canResolveAttachmentSubjects } from './parsed-attachment-authorization';

it('lets scoped HR resolve without acquiring 846 confirmation authority', () => {
  const context = evaluationContextFixture();
  expect(canResolveAttachmentSubjects({ context }, [], 'demo-node')).toBe(true);
  expect(
    canResolveAttachmentSubjects({ context }, ['demo-person'], 'demo-node'),
  ).toBe(true);
  expect(
    canConfirmOwnNodeScore(context, {
      evaluationNodeId: 'demo-node',
      personId: 'demo-person',
      raterId: context.account.personId,
    }),
  ).toBe(false);
});
it('uses current evaluator or manager authority, not an uploader identity', () => {
  const context = evaluationContextFixture();
  context.grants = [];
  context.account.personId = 'demo-new-evaluator';
  expect(
    canResolveAttachmentSubjects({ context }, ['demo-person'], 'demo-node'),
  ).toBe(true);
  context.account.personId = 'demo-old-evaluator';
  expect(
    canResolveAttachmentSubjects({ context }, ['demo-person'], 'demo-node'),
  ).toBe(false);
  context.grants = [
    {
      ...evaluationContextFixture().grants[0]!,
      role: 'manager',
      scope: 'company',
      cohortId: null,
    },
  ];
  expect(
    canResolveAttachmentSubjects({ context }, ['demo-person'], 'demo-node'),
  ).toBe(true);
});
it('rejects a reader outside the complete subject scope and administrator-only access', () => {
  const context = evaluationContextFixture();
  context.grants[0]!.cohortId = 'unrelated-cohort';
  expect(canResolveAttachmentSubjects({ context }, [], 'demo-node')).toBe(
    false,
  );
  context.grants = evaluationContextFixture().grants;
  expect(
    canResolveAttachmentSubjects(
      { context },
      ['demo-person', 'hidden'],
      'demo-node',
    ),
  ).toBe(false);
  context.account.isSystemAdmin = true;
  expect(
    canResolveAttachmentSubjects({ context }, ['demo-person'], 'demo-node'),
  ).toBe(false);
});
