import { describe, expect, it, vi } from 'vitest';
import type { AuthzContext, BusinessRole } from './index';
import {
  canReadTalent,
  projectTalentRecord,
  readTalentCollection,
  readTalentRecord,
  readTalentSource,
  buildAuthorizedModelInput,
  type TalentRecord,
  type TalentSource,
  type TalentKind,
} from './talent';

const validity = { validFrom: '2026-07-01', validTo: null, revokedAt: null };
const subject = { personId: 'test-person-001', cohortId: 'test-period-a' };
function context(role: BusinessRole = 'mentor'): AuthzContext {
  return {
    account: {
      id: 'test-account',
      personId: 'test-mentor',
      isSystemAdmin: false,
    },
    now: '2026-09-04',
    grants: [
      {
        accountId: 'test-account',
        role,
        scope: role === 'manager' ? 'company' : 'cohort',
        cohortId: role === 'manager' ? null : 'test-period-a',
        ...validity,
      },
    ],
    people: [
      { id: 'test-person-001', noReview: false },
      { id: 'test-person-002', noReview: false },
    ],
    enrollments: [{ ...subject, confirmed: true, ...validity }],
    assignments: [
      {
        cohortId: 'test-period-a',
        personId: 'test-mentor',
        studentId: 'test-person-001',
        kind: 'assistant',
        ...validity,
      },
    ],
    projects: [],
    members: [],
  };
}
const source = (overrides: Partial<TalentSource> = {}): TalentSource => ({
  fragmentId: 'test-fragment-001',
  originalVersionId: 'test-version-001',
  subjects: [subject],
  kind: 'evaluation',
  excerpt: 'Synthetic evaluation',
  location: { kind: 'document', paragraph: 'P1', page: 1 },
  ...overrides,
});
const record = (overrides: Partial<TalentRecord> = {}): TalentRecord => ({
  id: 'test-event-001',
  subject,
  kind: 'evaluation',
  fields: [
    {
      name: 'text',
      kind: 'evaluation',
      value: 'Synthetic evaluation by another mentor',
      subjects: [],
      sources: [],
    },
    {
      name: 'confirmedScore',
      kind: 'confirmed-score',
      value: 4,
      subjects: [],
      sources: [],
    },
    {
      name: 'quadrant',
      kind: 'quadrant',
      value: 'Hidden quadrant',
      subjects: [],
      sources: [],
    },
    {
      name: 'managementObservation',
      kind: 'management-observation',
      value: 'Hidden observation',
      subjects: [],
      sources: [],
    },
    {
      name: 'change',
      kind: 'change',
      value: 'Hidden change',
      subjects: [],
      sources: [],
    },
    {
      name: 'performance',
      kind: 'performance',
      value: 'Hidden performance',
      subjects: [],
      sources: [],
    },
  ],
  ...overrides,
});

describe('talent action × current grant × subject × purpose', () => {
  const kinds: TalentKind[] = [
    'person',
    'evaluation',
    'confirmed-score',
    'quadrant',
    'management-observation',
    'change',
    'performance',
  ];
  for (const role of ['manager', 'hr', 'mentor', 'admin'] as const) {
    for (const kind of kinds) {
      it(`${role} reads ${kind} only under its complete grant`, () => {
        const ctx = context(role === 'admin' ? 'manager' : role);
        ctx.account.isSystemAdmin = role === 'admin';
        expect(canReadTalent(ctx, { ...subject, kind }, 'person-profile')).toBe(
          role !== 'admin' &&
            (role !== 'mentor' ||
              ['person', 'evaluation', 'confirmed-score'].includes(kind)),
        );
        expect(
          canReadTalent(
            ctx,
            { personId: 'forged-id', cohortId: 'test-period-a', kind },
            'person-profile',
          ),
        ).toBe(false);
        expect(canReadTalent(ctx, { ...subject, kind }, 'project-create')).toBe(
          false,
        );
      });
    }
  }
  it('allows mentor all authors and periods but not another student or expired assignment', () => {
    const ctx = context();
    expect(
      canReadTalent(
        ctx,
        { ...subject, cohortId: 'test-period-b', kind: 'evaluation' },
        'person-profile',
      ),
    ).toBe(true);
    expect(
      canReadTalent(
        ctx,
        { ...subject, personId: 'test-person-002', kind: 'evaluation' },
        'person-profile',
      ),
    ).toBe(false);
    ctx.assignments[0]!.validTo = ctx.now;
    expect(
      canReadTalent(ctx, { ...subject, kind: 'evaluation' }, 'person-profile'),
    ).toBe(false);
  });
  it('keeps HR confirmed learners across future periods and retention, not after grant or enrollment expiry', () => {
    const ctx = context('hr');
    expect(
      canReadTalent(
        ctx,
        { ...subject, cohortId: null, kind: 'management-observation' },
        'person-profile',
      ),
    ).toBe(true);
    ctx.enrollments[0]!.confirmed = false;
    expect(
      canReadTalent(
        ctx,
        { ...subject, cohortId: null, kind: 'person' },
        'person-profile',
      ),
    ).toBe(false);
    expect(
      canReadTalent(ctx, { ...subject, kind: 'evaluation' }, 'person-profile'),
    ).toBe(true);
    expect(
      canReadTalent(
        ctx,
        { ...subject, cohortId: 'test-period-b', kind: 'evaluation' },
        'person-profile',
      ),
    ).toBe(false);
    ctx.enrollments[0]!.confirmed = true;
    ctx.enrollments[0]!.revokedAt = ctx.now;
    expect(
      canReadTalent(ctx, { ...subject, kind: 'evaluation' }, 'person-profile'),
    ).toBe(false);
  });
  it('never combines an HR action with a mentor person scope', () => {
    const ctx = context();
    ctx.grants.push({
      ...ctx.grants[0]!,
      role: 'hr',
      cohortId: 'test-period-b',
    });
    expect(
      canReadTalent(ctx, { ...subject, kind: 'quadrant' }, 'person-profile'),
    ).toBe(false);
    expect(
      canReadTalent(ctx, { ...subject, kind: 'evaluation' }, 'person-profile'),
    ).toBe(true);
    ctx.enrollments.push({
      ...subject,
      cohortId: 'test-period-b',
      confirmed: true,
      ...validity,
    });
    expect(
      canReadTalent(ctx, { ...subject, kind: 'quadrant' }, 'person-profile'),
    ).toBe(true);
    ctx.grants[1]!.revokedAt = ctx.now;
    expect(
      canReadTalent(ctx, { ...subject, kind: 'quadrant' }, 'person-profile'),
    ).toBe(false);
  });
  it('honors half-open time boundaries, wrong accounts, future/revoked grants and non-review people', () => {
    const ctx = context('hr');
    ctx.grants[0]!.validTo = '2026-09-05';
    const canRead = () =>
      canReadTalent(ctx, { ...subject, kind: 'person' }, 'people-list');
    expect(canRead()).toBe(true);
    ctx.now = '2026-09-05';
    expect(canRead()).toBe(false);
    ctx.now = '2026-09-06';
    expect(canRead()).toBe(false);
    ctx.now = '2026-06-30';
    expect(canRead()).toBe(false);
    ctx.now = '2026-09-04';
    ctx.grants[0]!.accountId = 'other';
    expect(canRead()).toBe(false);
    ctx.grants[0]!.accountId = ctx.account.id;
    ctx.people[0]!.noReview = true;
    expect(canRead()).toBe(false);
  });
});

describe('server-only projection, sources and model boundary', () => {
  it('omits forbidden fields rather than using null, placeholders, or hidden counts', () => {
    const result = projectTalentRecord(
      context(),
      record(),
      [],
      'person-profile',
    );
    expect(result).toEqual({
      id: 'test-event-001',
      personId: 'test-person-001',
      kind: 'evaluation',
      fields: {
        text: 'Synthetic evaluation by another mentor',
        confirmedScore: 4,
      },
      sources: [],
    });
    expect(
      projectTalentRecord(
        context(),
        record({ subject: { ...subject, personId: 'test-person-002' } }),
        [],
        'person-profile',
      ),
    ).toBeNull();
  });
  it('filters mixed-person fields and source fragments, including exact version association', async () => {
    const ctx = context();
    const sources = [
      source(),
      source({
        fragmentId: 'test-fragment-002',
        subjects: [
          subject,
          { personId: 'test-person-002', cohortId: 'test-period-a' },
        ],
      }),
      source({
        fragmentId: 'test-fragment-003',
        kind: 'management-observation',
      }),
    ];
    const load = async () => ({ context: ctx, records: [record()], sources });
    const ref = {
      fragmentId: 'test-fragment-001',
      originalVersionId: 'test-version-001',
    };
    expect(await readTalentSource(load, ref)).toEqual({
      ...ref,
      location: sources[0]!.location,
      excerpt: 'Synthetic evaluation',
    });
    expect(
      await readTalentSource(load, {
        ...ref,
        originalVersionId: 'wrong-version',
      }),
    ).toBeNull();
    expect(
      await readTalentSource(load, { ...ref, fragmentId: 'test-fragment-002' }),
    ).toBeNull();
    expect(
      await readTalentSource(load, { ...ref, fragmentId: 'test-fragment-003' }),
    ).toBeNull();
    const mixed = record({
      fields: [
        {
          name: 'mixed',
          kind: 'evaluation',
          value: 'Hidden other person',
          subjects: [{ personId: 'test-person-002', cohortId: null }],
          sources: [],
        },
      ],
    });
    expect(
      projectTalentRecord(ctx, mixed, sources, 'person-profile'),
    ).toBeNull();
  });
  it('counts only projected rows and returns the same absence for forged or inaccessible IDs', async () => {
    const load = async () => ({
      context: context(),
      records: [
        record(),
        record({ id: 'hidden-event', kind: 'management-observation' }),
      ],
      sources: [],
    });
    const result = await readTalentCollection(load, 'person-profile');
    expect(result.total).toBe(1);
    expect(Object.keys(result)).toEqual(['items', 'total']);
    expect(
      await readTalentRecord(load, 'hidden-event', 'person-profile'),
    ).toBeNull();
    expect(
      await readTalentRecord(load, 'forged-id', 'person-profile'),
    ).toBeNull();
  });
  it('requires AI provenance and never leaks sensitive or unknown source-derived conclusions', () => {
    const visible = source();
    const sensitive = source({ fragmentId: 'secret', kind: 'quadrant' });
    const inference = (
      sources: { fragmentId: string; originalVersionId: string }[],
    ) =>
      record({
        kind: 'ai-inference',
        fields: [
          {
            name: 'suggestion',
            kind: 'ai-inference',
            value: 'AI inference, not a confirmed conclusion',
            subjects: [],
            sources,
          },
        ],
      });
    const ref = {
      fragmentId: visible.fragmentId,
      originalVersionId: visible.originalVersionId,
    };
    expect(
      projectTalentRecord(
        context(),
        inference([ref]),
        [visible],
        'person-profile',
      )?.fields,
    ).toEqual({ suggestion: 'AI inference, not a confirmed conclusion' });
    expect(
      projectTalentRecord(context(), inference([]), [], 'person-profile'),
    ).toBeNull();
    expect(
      projectTalentRecord(
        context(),
        inference([{ ...ref, fragmentId: 'secret' }]),
        [sensitive],
        'person-profile',
      ),
    ).toBeNull();
    expect(
      projectTalentRecord(
        context('manager'),
        inference([ref]),
        [],
        'person-profile',
      ),
    ).toBeNull();
  });
  it('rechecks current permissions for each read, source expansion and model input, not a prior page token', async () => {
    const ctx = context();
    const load = vi.fn(async () => ({
      context: ctx,
      records: [record()],
      sources: [source()],
    }));
    expect((await readTalentCollection(load, 'person-profile')).total).toBe(1);
    ctx.assignments[0]!.revokedAt = ctx.now;
    expect(
      await readTalentRecord(load, 'test-event-001', 'person-profile'),
    ).toBeNull();
    expect(
      await readTalentSource(load, {
        fragmentId: 'test-fragment-001',
        originalVersionId: 'test-version-001',
      }),
    ).toBeNull();
    expect(await buildAuthorizedModelInput(load)).toEqual({ items: [] });
    expect(load).toHaveBeenCalledTimes(4);
  });
  it('model input never contains restricted fields, raw originals, or performance even for managers', async () => {
    const load = async () => ({
      context: context('manager'),
      records: [record()],
      sources: [source({ excerpt: 'Unrelated raw original' })],
    });
    const input = await buildAuthorizedModelInput(load);
    expect(input.items[0]!.fields).not.toHaveProperty('performance');
    expect(JSON.stringify(input)).not.toContain('Unrelated raw original');
    expect(JSON.stringify(input)).not.toContain('Hidden performance');
  });
  it('admin denies all talent surfaces even with an active company grant', async () => {
    const ctx = context('manager');
    ctx.account.isSystemAdmin = true;
    const load = async () => ({
      context: ctx,
      records: [record()],
      sources: [source()],
    });
    expect(await readTalentCollection(load, 'people-list')).toEqual({
      items: [],
      total: 0,
    });
    expect(
      await readTalentRecord(load, 'test-event-001', 'person-preview'),
    ).toBeNull();
    expect(
      await readTalentSource(load, {
        fragmentId: 'test-fragment-001',
        originalVersionId: 'test-version-001',
      }),
    ).toBeNull();
    expect(await buildAuthorizedModelInput(load)).toEqual({ items: [] });
  });
});

describe('provenance restriction and expiry edge cases', () => {
  it('rejects mixed classified fragments, empty subject sets and AI without resolvable provenance', async () => {
    const ctx = context();
    const ref = {
      fragmentId: 'test-fragment-001',
      originalVersionId: 'test-version-001',
    };
    let candidate = source({ requiredKinds: ['management-observation'] });
    const load = async () => ({
      context: ctx,
      records: [],
      sources: [candidate],
    });
    expect(await readTalentSource(load, ref)).toBeNull();
    candidate = source({ subjects: [] });
    expect(await readTalentSource(load, ref)).toBeNull();
    candidate = source({ kind: 'ai-inference' });
    expect(await readTalentSource(load, ref)).toBeNull();
    expect(
      canReadTalent(
        ctx,
        { ...subject, kind: 'ai-inference' },
        'person-profile',
      ),
    ).toBe(false);
  });
  it('does not forward extra raw source/location properties and supports each locator', async () => {
    const ctx = context('manager');
    for (const location of [
      { kind: 'document' as const, paragraph: 'P2' },
      { kind: 'spreadsheet' as const, sheet: 'Sheet1', cell: 'B2' },
      { kind: 'recording' as const, startMs: 0, endMs: 1000 },
    ]) {
      const candidate = {
        ...source({ location }),
        rawOriginal: 'Must not escape',
      };
      const load = async () => ({
        context: ctx,
        records: [],
        sources: [candidate],
      });
      expect(await readTalentSource(load, candidate)).toEqual({
        fragmentId: candidate.fragmentId,
        originalVersionId: candidate.originalVersionId,
        excerpt: candidate.excerpt,
        location,
      });
    }
  });
  it('returns only linked authorized sources and deduplicates repeated references', () => {
    const candidate = source();
    const ref = {
      fragmentId: candidate.fragmentId,
      originalVersionId: candidate.originalVersionId,
    };
    const input = record({
      fields: [
        {
          name: 'first',
          kind: 'evaluation',
          value: 'Visible',
          subjects: [],
          sources: [ref],
        },
        {
          name: 'second',
          kind: 'evaluation',
          value: null,
          subjects: [],
          sources: [ref],
        },
        {
          name: 'missing',
          kind: 'evaluation',
          value: 'Must not escape',
          subjects: [],
          sources: [{ ...ref, originalVersionId: 'absent' }],
        },
      ],
    });
    const result = projectTalentRecord(
      context(),
      input,
      [
        candidate,
        source({ fragmentId: 'unlinked', excerpt: 'Must not escape' }),
      ],
      'workbench',
    );
    expect(result?.fields).toEqual({ first: 'Visible', second: null });
    expect(result?.sources).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('Must not escape');
  });
  it('removes a source-derived AI field from model input when its provenance contains personnel material', async () => {
    const candidate = source({ requiredKinds: ['performance'] });
    const input = record({
      fields: [
        {
          name: 'suggestion',
          kind: 'ai-inference',
          value: 'Derived personnel material',
          subjects: [],
          sources: [
            {
              fragmentId: candidate.fragmentId,
              originalVersionId: candidate.originalVersionId,
            },
          ],
        },
      ],
    });
    const load = async () => ({
      context: context('manager'),
      records: [input],
      sources: [candidate],
    });
    expect((await readTalentCollection(load, 'person-profile')).total).toBe(1);
    expect(await buildAuthorizedModelInput(load)).toEqual({ items: [] });
  });
  it('checks wrong mentor, cohort, future assignment and HR enrollment boundaries independently', () => {
    const ctx = context();
    const canRead = () =>
      canReadTalent(ctx, { ...subject, kind: 'evaluation' }, 'person-preview');
    ctx.assignments[0]!.personId = 'someone-else';
    expect(canRead()).toBe(false);
    ctx.assignments[0]!.personId = ctx.account.personId;
    ctx.assignments[0]!.cohortId = 'test-period-b';
    expect(canRead()).toBe(false);
    ctx.assignments[0]!.cohortId = subject.cohortId;
    ctx.assignments[0]!.validFrom = '2026-09-05';
    expect(canRead()).toBe(false);
    ctx.grants[0]!.role = 'hr';
    ctx.enrollments[0]!.validTo = ctx.now;
    expect(canRead()).toBe(false);
    ctx.enrollments[0]!.validTo = null;
    ctx.enrollments[0]!.cohortId = 'test-period-b';
    expect(canRead()).toBe(false);
    ctx.enrollments[0]!.cohortId = subject.cohortId;
    ctx.enrollments[0]!.personId = 'test-person-002';
    expect(canRead()).toBe(false);
  });
  it('does not disguise snapshot load failures as a successful empty result', async () => {
    const load = async () => {
      throw new Error('synthetic read failure');
    };
    await expect(readTalentCollection(load, 'people-list')).rejects.toThrow(
      'synthetic read failure',
    );
    await expect(buildAuthorizedModelInput(load)).rejects.toThrow(
      'synthetic read failure',
    );
  });
});
