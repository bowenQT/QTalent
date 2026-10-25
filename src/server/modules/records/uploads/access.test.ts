import { describe, expect, it } from 'vitest';
import {
  createOriginalAuthorizer,
  type OriginalAccessSnapshot,
} from './access';
function snapshot(role: 'mentor' | 'hr' | 'manager'): OriginalAccessSnapshot {
  return {
    complete: true,
    records: [],
    context: {
      account: { id: 'account', personId: 'recorder', isSystemAdmin: false },
      now: '2026-10-25',
      grants: [
        {
          accountId: 'account',
          role,
          scope: role === 'manager' ? 'company' : 'cohort',
          cohortId: role === 'manager' ? null : 'cohort-1',
          validFrom: '2026-01-01',
          validTo: null,
          revokedAt: null,
        },
      ],
      people: [
        { id: 'demo-1', noReview: false },
        { id: 'demo-2', noReview: false },
      ],
      enrollments: [
        {
          personId: 'demo-1',
          cohortId: 'cohort-1',
          confirmed: true,
          validFrom: '2026-01-01',
          validTo: null,
          revokedAt: null,
        },
      ],
      assignments: [
        {
          personId: 'recorder',
          studentId: 'demo-1',
          cohortId: 'cohort-1',
          kind: 'mentor',
          validFrom: '2026-01-01',
          validTo: null,
          revokedAt: null,
        },
      ],
      projects: [],
      members: [],
    },
    sources: [
      {
        fragmentId: 'fragment',
        originalVersionId: 'version',
        subjects: [{ personId: 'demo-1', cohortId: 'cohort-1' }],
        kind: 'evaluation',
        excerpt: '演示：核对了测试记录。',
        location: { kind: 'recording', startMs: 0, endMs: 1000 },
      },
    ],
  };
}
describe('whole original uses existing talent source authorization', () => {
  const reference = { fragmentId: 'fragment', originalVersionId: 'version' };
  it.each(['mentor', 'hr', 'manager'] as const)(
    'allows a complete classified version for authorized %s',
    async (role) => {
      expect(
        await createOriginalAuthorizer(async () => snapshot(role))(
          'account',
          reference,
        ),
      ).toBe(true);
    },
  );
  it('denies out-of-scope HR and mentors with any hidden subject or sensitive fragment', async () => {
    for (const role of ['hr', 'mentor'] as const) {
      const data = snapshot(role);
      data.sources.push({
        ...data.sources[0],
        fragmentId: 'hidden',
        subjects: [{ personId: 'demo-2', cohortId: 'cohort-2' }],
      });
      const authorize = createOriginalAuthorizer(async () => data);
      expect(await authorize('account', reference)).toBe(false);
      data.sources.pop();
      data.sources[0].requiredKinds = ['management-observation'];
      expect(await authorize('account', reference)).toBe(role === 'hr');
    }
  });
  it('fails closed on incomplete provenance, unlinked fragments, fake references and mismatched accounts', async () => {
    const data = snapshot('manager');
    const authorize = createOriginalAuthorizer(async () => data);
    data.complete = false;
    expect(await authorize('account', reference)).toBe(false);
    data.complete = true;
    data.sources[0].subjects = [];
    expect(await authorize('account', reference)).toBe(false);
    expect(await authorize('different', reference)).toBe(false);
    expect(
      await authorize('account', { ...reference, fragmentId: 'forged' }),
    ).toBe(false);
  });
});
