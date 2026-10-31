import { describe, expect, it, vi } from 'vitest';
import {
  createOriginalAuthorizer,
  createNodeOriginalAuthorizer,
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
  it('authorizes original-only identities through the complete source graph and validates original ownership', async () => {
    const data = snapshot('mentor');
    data.originalId = 'original';
    const authorize = createOriginalAuthorizer(async () => data);
    expect(
      await authorize('account', {
        originalId: 'original',
        originalVersionId: 'version',
      }),
    ).toBe(true);
    expect(
      await authorize('account', {
        originalId: 'wrong',
        originalVersionId: 'version',
      }),
    ).toBe(false);
    data.sources = [];
    expect(
      await authorize('account', {
        originalId: 'original',
        originalVersionId: 'version',
      }),
    ).toBe(false);
  });
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
  it('rejects duplicate fragment identities rather than authorizing the first classification twice', async () => {
    const data = snapshot('mentor');
    data.sources.push({
      ...data.sources[0],
      requiredKinds: ['management-observation'],
    });
    expect(
      await createOriginalAuthorizer(async () => data)('account', reference),
    ).toBe(false);
  });
});

it('does not silently authorize node-scoped sources through the legacy talent reader', async () => {
  const data = snapshot('mentor');
  Object.assign(data.context, {
    evaluationNodes: [],
    evaluationNodeSubjects: [],
    evaluationRelations: [],
  });
  expect(
    await createOriginalAuthorizer(async () => data)('account', {
      fragmentId: 'fragment',
      originalVersionId: 'version',
    }),
  ).toBe(false);
});

it('requires complete current node facts and authorizes every fragment with the injected source capability', async () => {
  const data = {
    ...snapshot('mentor'),
    originalId: 'original',
    context: {
      ...snapshot('mentor').context,
      now: '2026-10-25T00:00:00.000Z',
      evaluationNodes: [],
      evaluationNodeSubjects: [],
      evaluationRelations: [],
    },
  };
  const load = vi.fn(async () => data);
  const read = vi.fn(
    async (_snapshot: typeof data, source: { fragmentId: string }) =>
      source.fragmentId !== 'hidden',
  );
  const authorize = createNodeOriginalAuthorizer({
    authorizationNow: () => '2026-10-25T00:00:00.000Z',
    load,
    canReadFragment: read,
  });
  const ref = { fragmentId: 'fragment', originalVersionId: 'version' };
  expect(await authorize('account', ref)).toBe(true);
  expect(load).toHaveBeenCalledWith(
    'account',
    'version',
    '2026-10-25T00:00:00.000Z',
    undefined,
  );
  data.sources.push({ ...data.sources[0], fragmentId: 'hidden' });
  expect(await authorize('account', ref)).toBe(false);
  expect(read).toHaveBeenLastCalledWith(data, data.sources[1]);
  data.sources.pop();
  data.context.now = '2026-10-24T00:00:00.000Z';
  expect(await authorize('account', ref)).toBe(false);
  data.context.now = '2026-10-25T00:00:00.000Z';
  data.complete = false;
  expect(await authorize('account', ref)).toBe(false);
});
it('rejects mismatched node-reader identity, duplicate/unlinked sources and unknown original identities', async () => {
  const data = {
    ...snapshot('manager'),
    originalId: 'original',
    context: {
      ...snapshot('manager').context,
      evaluationNodes: [],
      evaluationNodeSubjects: [],
      evaluationRelations: [],
    },
  };
  const authorize = createNodeOriginalAuthorizer({
    authorizationNow: () => '2026-10-25T00:00:00.000Z',
    load: async () => data,
    canReadFragment: async () => true,
  });
  expect(
    await authorize('other', {
      originalId: 'original',
      originalVersionId: 'version',
    }),
  ).toBe(false);
  expect(
    await authorize('account', {
      originalId: 'wrong',
      originalVersionId: 'version',
    }),
  ).toBe(false);
  expect(
    await authorize('account', {
      fragmentId: 'missing',
      originalVersionId: 'version',
    }),
  ).toBe(false);
  data.sources.push(data.sources[0]);
  expect(
    await authorize('account', {
      originalId: 'original',
      originalVersionId: 'version',
    }),
  ).toBe(false);
  data.sources = [];
  expect(
    await authorize('account', {
      originalId: 'original',
      originalVersionId: 'version',
    }),
  ).toBe(false);
});
