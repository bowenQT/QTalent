import { describe, expect, it } from 'vitest';
import type { AuthzContext } from '../../../authz';
import { canReadDemand, canWriteDemand } from './policy';

const project = {
  id: 'project', cohortId: 'cohort', isTopic: false,
  creatorId: 'creator', ownerId: 'owner',
};
function context(role: 'manager' | 'hr' | 'mentor', cohortId = 'cohort'): AuthzContext {
  return {
    account: { id: 'account', personId: 'person', isSystemAdmin: false },
    now: '2026-10-25T12:00:00Z',
    grants: [{
      accountId: 'account', role, scope: role === 'manager' ? 'company' : 'cohort',
      cohortId: role === 'manager' ? null : cohortId,
      validFrom: '2026-01-01', validTo: null, revokedAt: null,
    }],
    enrollments: [], assignments: [], projects: [project], members: [], people: [],
  };
}
const demand = { projectId: 'project', initiatorAccountId: 'initiator' };
describe('restricted staffing demand access', () => {
  it('permits manager and related HR', () => {
    for (const role of ['manager', 'hr'] as const) {
      expect(canReadDemand(context(role), demand)).toBe(true);
      expect(canWriteDemand(context(role), demand)).toBe(true);
    }
  });
  it('does not inherit basic project/member/owner access', () => {
    const mentor = context('mentor');
    mentor.account.personId = 'owner';
    mentor.members = [{ projectId: 'project', personId: 'owner', validFrom: '2026-01-01', validTo: null }];
    expect(canReadDemand(mentor, demand)).toBe(false);
    expect(canReadDemand(context('hr', 'unrelated'), demand)).toBe(false);
  });
  it('uses the union of complete active grants', () => {
    const ctx = context('mentor');
    ctx.grants.push(context('hr').grants[0]);
    expect(canReadDemand(ctx, demand)).toBe(true);
  });
  it('blocks administrator, revoked grants and stale initiator access', () => {
    const ctx = context('hr');
    const own = { ...demand, initiatorAccountId: 'account' };
    expect(canReadDemand(ctx, own)).toBe(true);
    ctx.grants[0].revokedAt = ctx.now;
    expect(canReadDemand(ctx, own)).toBe(false);
    ctx.grants[0].revokedAt = null;
    ctx.account.isSystemAdmin = true;
    expect(canWriteDemand(ctx, own)).toBe(false);
  });
  it('requires the project still exist and handles HR assigned project members', () => {
    const ctx = context('hr', 'other');
    ctx.enrollments = [{ personId: 'student', cohortId: 'other', confirmed: true, validFrom: '2026-01-01', validTo: null, revokedAt: null }];
    ctx.members = [{ projectId: 'project', personId: 'student', validFrom: '2026-01-01', validTo: null }];
    expect(canReadDemand(ctx, demand)).toBe(true);
    ctx.projects = [];
    expect(canReadDemand(ctx, demand)).toBe(false);
  });
});
