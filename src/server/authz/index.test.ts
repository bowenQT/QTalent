import { describe, expect, it } from 'vitest';
import {
  authorize,
  navigationFor,
  activeRoles,
  canReadProject,
  canReadFullPerson,
  canCreateProject,
  type AuthzContext,
} from './index';
const time = { validFrom: '2026-07-01', validTo: null, revokedAt: null };
const project = {
  id: 'test-p',
  cohortId: 'test-a',
  isTopic: true,
  creatorId: 'other',
  ownerId: null,
};
const context = (): AuthzContext => ({
  account: {
    id: 'test-account',
    personId: 'test-mentor',
    isSystemAdmin: false,
  },
  now: '2026-09-04',
  people: [{ id: 'test-student', noReview: false }],
  projects: [project],
  members: [],
  grants: [
    {
      accountId: 'test-account',
      role: 'mentor',
      scope: 'cohort',
      cohortId: 'test-a',
      ...time,
    },
  ],
  assignments: [
    {
      cohortId: 'test-a',
      personId: 'test-mentor',
      studentId: 'test-student',
      kind: 'mentor',
      ...time,
    },
  ],
  enrollments: [
    { cohortId: 'test-a', personId: 'test-student', confirmed: true, ...time },
  ],
});
describe('current account × action × scope × purpose', () => {
  it('requires current assignment for topics and denies a second cohort', () => {
    const ctx = context();
    expect(canReadProject(ctx, project)).toBe(true);
    expect(canReadProject(ctx, { ...project, cohortId: 'test-b' })).toBe(false);
    ctx.assignments[0]!.validTo = '2026-09-04';
    expect(canReadProject(ctx, project)).toBe(false);
  });
  it('never mixes HR actions with a mentor scope', () => {
    const ctx = context();
    ctx.grants.push({
      accountId: 'test-account',
      role: 'hr',
      scope: 'cohort',
      cohortId: 'test-b',
      ...time,
    });
    expect(canReadFullPerson(ctx, 'test-student')).toBe(false);
    expect(canCreateProject(ctx)).toBe(true);
    ctx.enrollments.push({
      cohortId: 'test-b',
      personId: 'test-student',
      confirmed: true,
      ...time,
    });
    expect(canReadFullPerson(ctx, 'test-student')).toBe(true);
    ctx.grants[1]!.revokedAt = ctx.now;
    expect(canReadFullPerson(ctx, 'test-student')).toBe(false);
  });
  it('requires approved current enrollment and denies forged IDs', () => {
    const ctx = context();
    ctx.grants[0]!.role = 'hr';
    expect(canReadFullPerson(ctx, 'test-student')).toBe(true);
    expect(canReadFullPerson(ctx, 'forged')).toBe(false);
    ctx.enrollments[0]!.confirmed = false;
    expect(canReadFullPerson(ctx, 'test-student')).toBe(false);
  });
  it('rejects wrong purposes, wrong account, revoked and future grants', () => {
    const ctx = context();
    expect(
      authorize(ctx, {
        action: 'projects.read',
        purpose: 'project-create',
        project,
      }),
    ).toBe(false);
    ctx.grants[0]!.accountId = 'another';
    expect(canReadProject(ctx, project)).toBe(false);
    ctx.grants[0]!.accountId = ctx.account.id;
    ctx.grants[0]!.validFrom = '2027-01-01';
    expect(canReadProject(ctx, project)).toBe(false);
  });
  it('administrator never inherits business even from malformed grants', () => {
    const ctx = context();
    ctx.account.isSystemAdmin = true;
    ctx.grants[0]!.role = 'manager';
    ctx.grants[0]!.scope = 'company';
    ctx.grants[0]!.cohortId = null;
    expect(canReadProject(ctx, project)).toBe(false);
    expect(canCreateProject(ctx)).toBe(false);
    expect(canReadFullPerson(ctx, 'test-student')).toBe(false);
    expect(
      authorize(ctx, {
        action: 'navigate',
        purpose: 'shell',
        navigationId: 'admin',
      }),
    ).toBe(true);
  });
});

describe('project scope paths and navigation', () => {
  it('permits current HR own, owner, member and enrolled-member projects but not a stranger', () => {
    const ctx = context();
    ctx.grants[0]!.role = 'hr';
    const other = { ...project, id: 'other', cohortId: 'test-b' };
    expect(canReadProject(ctx, other)).toBe(false);
    expect(
      canReadProject(ctx, { ...other, creatorId: ctx.account.personId }),
    ).toBe(true);
    expect(
      canReadProject(ctx, { ...other, ownerId: ctx.account.personId }),
    ).toBe(true);
    ctx.members.push({
      projectId: 'other',
      personId: 'test-student',
      validFrom: time.validFrom,
      validTo: null,
    });
    expect(canReadProject(ctx, other)).toBe(true);
    ctx.enrollments[0]!.revokedAt = ctx.now;
    expect(canReadProject(ctx, other)).toBe(false);
    ctx.members[0]!.personId = ctx.account.personId;
    expect(canReadProject(ctx, other)).toBe(true);
    ctx.members[0]!.validTo = ctx.now;
    expect(canReadProject(ctx, other)).toBe(false);
  });
  it('mentor participation does not expose unrelated non-topic projects', () => {
    const ctx = context();
    const other = { ...project, isTopic: false };
    expect(canReadProject(ctx, other)).toBe(false);
    ctx.members.push({
      projectId: project.id,
      personId: ctx.account.personId,
      validFrom: time.validFrom,
      validTo: null,
    });
    expect(canReadProject(ctx, other)).toBe(true);
  });
  it('manager company grant permits projects and eligible people but not non-review staff', () => {
    const ctx = context();
    ctx.grants[0]!.role = 'manager';
    ctx.grants[0]!.scope = 'company';
    ctx.grants[0]!.cohortId = null;
    expect(canReadProject(ctx, { ...project, cohortId: 'other' })).toBe(true);
    expect(canCreateProject(ctx)).toBe(true);
    expect(canReadFullPerson(ctx, 'test-student')).toBe(true);
    ctx.people[0]!.noReview = true;
    expect(canReadFullPerson(ctx, 'test-student')).toBe(false);
  });
  it('navigation exposes only granted business actions and admin remains isolated', () => {
    const ctx = context();
    expect(
      authorize(ctx, {
        action: 'navigate',
        purpose: 'shell',
        navigationId: 'queue',
      }),
    ).toBe(false);
    expect(
      authorize(ctx, {
        action: 'navigate',
        purpose: 'shell',
        navigationId: 'judge',
      }),
    ).toBe(true);
    expect(
      authorize(ctx, {
        action: 'navigate',
        purpose: 'model',
        navigationId: 'judge',
      }),
    ).toBe(false);
    ctx.account.isSystemAdmin = true;
    expect(
      authorize(ctx, {
        action: 'navigate',
        purpose: 'shell',
        navigationId: 'projects',
      }),
    ).toBe(false);
  });
  it('rejects purpose reuse for person and create actions', () => {
    const ctx = context();
    ctx.grants[0]!.role = 'hr';
    expect(
      authorize(ctx, {
        action: 'people.full',
        purpose: 'model',
        personId: 'test-student',
      }),
    ).toBe(false);
    expect(
      authorize(ctx, { action: 'projects.create', purpose: 'shell' }),
    ).toBe(false);
  });
});

it('filters malformed presets and reports only current role navigation', () => {
  const ctx = context();
  expect(activeRoles(ctx)).toEqual(['mentor']);
  expect(navigationFor(ctx)).toEqual([
    'work',
    'people',
    'programs',
    'projects',
    'judge',
  ]);
  ctx.grants[0]!.cohortId = null;
  expect(activeRoles(ctx)).toEqual([]);
  expect(canReadProject(ctx, { ...project, cohortId: null })).toBe(false);
  ctx.account.isSystemAdmin = true;
  expect(navigationFor(ctx)).toEqual(['admin']);
});
