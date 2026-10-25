import { describe, expect, it } from 'vitest';
import {
  readPrototypeSeed,
  mapPrototypeSeed,
  validatePrototypeSeed,
} from './index';
import {
  visibleProjects,
  eligiblePeople,
  type AuthzContext,
} from '../../authz';
describe('verified prototype seed', () => {
  it('maps deterministically with 22 / 22 / 19 / 0 visible lists and 93 eligible learners', () => {
    const raw = readPrototypeSeed(process.cwd());
    const mapped = mapPrototypeSeed(raw);
    expect(mapPrototypeSeed(readPrototypeSeed(process.cwd()))).toEqual(mapped);
    for (const [role, count] of [
      ['manager', 22],
      ['hr', 22],
      ['mentor', 19],
      ['admin', 0],
    ] as const) {
      const account = mapped.accounts.find((a) => a.role === role)!;
      const ctx: AuthzContext = { ...mapped, account, now: '2026-09-04' };
      expect(visibleProjects(ctx)).toHaveLength(count);
      expect(eligiblePeople(ctx)).toHaveLength(
        role === 'manager' || role === 'hr' ? 93 : 0,
      );
    }
  });
  it('rejects duplicate keys and unresolved references before mapping', () => {
    const raw = readPrototypeSeed(process.cwd());
    raw.PEOPLE.push(raw.PEOPLE[0]!);
    expect(() => validatePrototypeSeed(raw)).toThrow(/duplicate/);
    const broken = readPrototypeSeed(process.cwd());
    broken.PROJECTS[0]!.owner = 'forged';
    expect(() => validatePrototypeSeed(broken)).toThrow(/reference/);
  });
});

describe('seed boundary validation', () => {
  it('rejects cyclic organizations and missing cohort structure', () => {
    const raw = readPrototypeSeed(process.cwd());
    raw.ORGS[0]!.parent = raw.ORGS[0]!.id;
    expect(() => validatePrototypeSeed(raw)).toThrow(/cyclic/);
    const broken = readPrototypeSeed(process.cwd());
    delete broken.BATCHES[0]!.from;
    expect(() => validatePrototypeSeed(broken)).toThrow(/structure/);
  });
  it('maps unassigned organizational projects without inventing cohort membership', () => {
    const raw = readPrototypeSeed(process.cwd());
    raw.PROJECTS.push({
      ...raw.PROJECTS[0]!,
      id: 'test-independent',
      org: 'strategy',
      batch: undefined,
    });
    const last = mapPrototypeSeed(raw).projects.at(-1)!;
    expect(last.cohortId).toBeNull();
    expect(last.isTopic).toBe(false);
  });
});
