import { expect, it } from 'vitest';
import { canReadTalent, readTalentSource } from './talent';
import {
  canReadNodeTalent,
  type EvaluationAuthzContext,
} from './evaluation-node';
function context(
  role: 'hr' | 'manager' | 'evaluator' | 'employee',
): EvaluationAuthzContext {
  return {
    account: { id: role, personId: role, isSystemAdmin: false },
    now: '2026-11-01T00:00:00Z',
    people: [
      { id: 'subject', noReview: false },
      { id: role, noReview: false },
    ],
    grants:
      role === 'hr' || role === 'manager'
        ? [
            {
              accountId: role,
              role,
              scope: role === 'hr' ? 'cohort' : 'company',
              cohortId: role === 'hr' ? 'cohort' : null,
              validFrom: '2026-01-01',
              validTo: null,
              revokedAt: null,
            },
          ]
        : [],
    enrollments: [
      {
        personId: 'subject',
        cohortId: 'cohort',
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
      { id: 'interview', kind: 'interview', cohortId: null },
      { id: 'program', kind: 'program_cohort', cohortId: 'cohort' },
    ],
    evaluationNodeSubjects: [
      { evaluationNodeId: 'interview', personId: 'subject' },
      { evaluationNodeId: 'program', personId: 'subject' },
    ],
    evaluationRelations:
      role === 'evaluator'
        ? [
            {
              id: 'actual-relation',
              evaluationNodeId: 'interview',
              personId: 'subject',
              evaluatorId: role,
              kind: 'interviewer',
              validFrom: '2026-01-01',
              validTo: null,
              revokedAt: null,
            },
          ]
        : [],
  };
}
const subject = {
  personId: 'subject',
  evaluationNodeId: 'interview',
  cohortId: null,
};
it.each(['hr', 'manager'] as const)(
  'allows current %s archive/source reads but never model input or an unbound history',
  (role) => {
    const ctx = context(role);
    expect(
      canReadTalent(
        ctx,
        { ...subject, kind: 'interview-evaluation' },
        'person-profile',
      ),
    ).toBe(true);
    expect(
      canReadTalent(
        ctx,
        { ...subject, kind: 'interview-evaluation' },
        'model-input',
      ),
    ).toBe(false);
    expect(
      canReadTalent(
        ctx,
        { ...subject, evaluationNodeId: null, kind: 'interview-evaluation' },
        'source-read',
      ),
    ).toBe(false);
    expect(
      canReadTalent(
        ctx,
        {
          ...subject,
          evaluationNodeId: 'program',
          kind: 'interview-evaluation',
        },
        'person-profile',
      ),
    ).toBe(false);
    ctx.grants[0].revokedAt = '2026-10-31';
    expect(
      canReadTalent(
        ctx,
        { ...subject, kind: 'interview-evaluation' },
        'person-profile',
      ),
    ).toBe(false);
  },
);
it('a real interviewer relation can read its normal node facts, but not archived interview scores or their fragments', async () => {
  const ctx = context('evaluator');
  expect(
    canReadNodeTalent(
      ctx,
      { ...subject, kind: 'evaluation' },
      'person-profile',
    ),
  ).toBe(true);
  expect(
    canReadNodeTalent(
      ctx,
      { ...subject, kind: 'interview-evaluation' },
      'person-profile',
    ),
  ).toBe(false);
  const source = await readTalentSource(
    async () => ({
      context: ctx,
      records: [],
      sources: [
        {
          fragmentId: 'field',
          originalVersionId: 'v1',
          subjects: [subject],
          kind: 'evaluation',
          requiredKinds: ['interview-evaluation'],
          excerpt: '演示评分2',
          location: { kind: 'pdf', page: 1, textRange: { start: 0, end: 5 } },
        },
      ],
    }),
    { fragmentId: 'field', originalVersionId: 'v1' },
  );
  expect(source).toBeNull();
  expect(
    canReadTalent(
      context('employee'),
      { ...subject, kind: 'interview-evaluation' },
      'person-profile',
    ),
  ).toBe(false);
});
