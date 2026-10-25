import { describe, expect, it } from 'vitest';
import {
  canWriteArrange,
  textSubjects,
  type ArrangeActor,
} from './record-arrange-context';
import { exampleSnapshot } from '../modules/records/arrange/examples';
function actor(): ArrangeActor {
  const context = exampleSnapshot().authorization.context;
  return {
    context,
    directory: {
      account: context.account,
      grants: context.grants.map((g, i) => ({ ...g, id: 'grant-' + i })),
      people: context.people.map((p, i) => ({
        ...p,
        name: ['林舟', '许禾', '周岚'][i]!,
        organizationId: 'demo-org',
        photo: null,
        hue: 220,
        demo: true,
      })),
      organizations: [{ id: 'demo-org', name: '演示组织', shortName: '演示' }],
    },
    staffing: { projects: [], members: [] },
  };
}
describe('actual arrange write policy assembly', () => {
  it('allows current HR targets and rejects an unavailable person', () => {
    const a = actor();
    expect(canWriteArrange(a, ['demo-lin'], null)).toBe(true);
    expect(canWriteArrange(a, ['hidden'], null)).toBe(false);
  });
  it('does not convert manager read access into evaluation writes', () => {
    const a = actor();
    a.context.grants[0] = {
      ...a.context.grants[0]!,
      role: 'manager',
      scope: 'company',
      cohortId: null,
    };
    expect(canWriteArrange(a, ['demo-lin'], null)).toBe(false);
    expect(canWriteArrange(a, [], null)).toBe(false);
  });
  it('uses current mentor assignments independently of other writable students', () => {
    const a = actor();
    a.context.grants[0]!.role = 'mentor';
    a.context.assignments = [
      {
        personId: 'demo-rater',
        studentId: 'demo-lin',
        cohortId: 'cohort-demo',
        kind: 'mentor',
        validFrom: '2026-01-01',
        validTo: null,
        revokedAt: null,
      },
    ];
    expect(canWriteArrange(a, ['demo-lin'], null)).toBe(true);
    expect(canWriteArrange(a, ['demo-xu'], null)).toBe(false);
  });
  it('denies an inaccessible project and a no-review person', () => {
    const a = actor();
    expect(canWriteArrange(a, ['demo-lin'], 'hidden-project')).toBe(false);
    a.context.people[0]!.noReview = true;
    expect(canWriteArrange(a, ['demo-lin'], null)).toBe(false);
  });
  it('keeps privacy subjects mentioned in text separate from the selected actor', () => {
    const a = actor();
    expect(
      textSubjects(a, '林舟与许禾一起复盘', ['demo-lin']).map(
        (s) => s.personId,
      ),
    ).toEqual(['demo-lin', 'demo-xu']);
  });
});
