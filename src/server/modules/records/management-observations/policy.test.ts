import { describe, it, expect } from 'vitest';
import {
  canCreateObservation,
  canReadObservation,
  canReadObservationSource,
} from './policy';
import { projectManagementObservation } from './read';
import {
  context,
  subject,
  observation,
  reference,
  source,
  now,
} from './__tests__/fixtures';
describe('current observation authorization and source projection', () => {
  it.each(['hr', 'manager'] as const)(
    'allows current %s scope and preserves only a detached visible projection',
    (role) => {
      const row = { ...observation(), sources: [reference] };
      const fact = source();
      const view = projectManagementObservation(context(role), row, [fact]);
      expect(view).toMatchObject({
        nature: 'management_observation',
        sources: [{ ...reference, location: fact.location }],
      });
      expect(view).not.toHaveProperty('recordedByAccountId');
      expect(view).not.toHaveProperty('attributionId');
      if (view) view.author.name = 'changed';
      expect(row.author.name).toBe('演示面试官甲');
    },
  );
  it('authors see only their own record inside a current node relation', () => {
    const ctx = context('author');
    const row = observation();
    expect(canCreateObservation(ctx, subject, 'manual')).toBe(true);
    expect(canReadObservation(ctx, row)).toBe(true);
    expect(
      canReadObservation(ctx, {
        ...row,
        author: { personId: 'demo-other-author', name: '演示乙' },
      }),
    ).toBe(false);
    expect(
      canReadObservation(ctx, { ...row, evaluationNodeId: 'demo-other-node' }),
    ).toBe(false);
    expect(canCreateObservation(ctx, subject, 'interview_import')).toBe(false);
  });
  it.each(['employee', 'admin'] as const)(
    'denies %s even when a row claims they are the author',
    (role) => {
      const ctx = context(role);
      const row = {
        ...observation(),
        author: { personId: ctx.account.personId, name: '演示本人' },
      };
      expect(canCreateObservation(ctx, subject, 'manual')).toBe(false);
      expect(projectManagementObservation(ctx, row, [])).toBeNull();
    },
  );
  it('expires exactly at the relation boundary and rejects missing node facts', () => {
    const ctx = context('author');
    ctx.evaluationRelations[0].validTo = now;
    expect(canReadObservation(ctx, observation())).toBe(false);
    expect(
      canCreateObservation(
        { ...context(), evaluationRelations: undefined } as never,
        subject,
        'manual',
      ),
    ).toBe(false);
    expect(
      canCreateObservation({ ...context(), now: 'invalid' }, subject, 'manual'),
    ).toBe(false);
  });
  it('keeps HR import authority distinct from manager reading and defense nodes', () => {
    expect(canCreateObservation(context(), subject, 'interview_import')).toBe(
      true,
    );
    expect(
      canCreateObservation(context('manager'), subject, 'interview_import'),
    ).toBe(false);
    expect(
      canCreateObservation(
        context(),
        { ...subject, evaluationNodeId: 'demo-defense' },
        'interview_import',
      ),
    ).toBe(false);
    const ctx = context();
    ctx.enrollments = [];
    expect(canReadObservation(ctx, observation())).toBe(false);
    ctx.people[0].noReview = true;
    expect(canCreateObservation(ctx, subject, 'manual')).toBe(false);
  });
  it('drops an entire row for missing, duplicate, wrong-version, wrong-subject or mixed-scope citations', () => {
    const row = { ...observation(), sources: [reference] };
    const fact = source();
    const ctx = context();
    for (const facts of [
      [],
      [fact, fact],
      [{ ...fact, originalVersionId: 'other' }],
      [{ ...fact, subjects: [{ ...subject, personId: 'demo-hr' }] }],
      [
        {
          ...fact,
          subjects: [subject, { ...subject, evaluationNodeId: 'missing' }],
        },
      ],
    ])
      expect(projectManagementObservation(ctx, row, facts)).toBeNull();
  });
  it('does not turn authorship into a grant to other restricted source kinds', () => {
    const ctx = context('author');
    const row = { ...observation(), sources: [reference] };
    expect(projectManagementObservation(ctx, row, [source()])).not.toBeNull();
    expect(
      canReadObservationSource(ctx, {
        ...source(),
        requiredKinds: ['management-observation'],
      }),
    ).toBe(false);
    expect(
      projectManagementObservation(ctx, row, [
        { ...source(), requiredKinds: ['management-observation'] },
      ]),
    ).toBeNull();
  });
});
