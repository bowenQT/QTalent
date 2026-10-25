import type { NavigationId } from '../../contracts/shell';
export interface Validity {
  validFrom: string;
  validTo: string | null;
  revokedAt: string | null;
}
export type BusinessRole = 'manager' | 'hr' | 'mentor';
export interface Grant extends Validity {
  accountId: string;
  role: BusinessRole;
  scope: 'company' | 'cohort';
  cohortId: string | null;
}
export interface Enrollment extends Validity {
  cohortId: string;
  personId: string;
  confirmed: boolean;
}
export interface Assignment extends Validity {
  cohortId: string;
  personId: string;
  studentId: string;
  kind: 'mentor' | 'assistant';
}
export interface AuthzProject {
  id: string;
  cohortId: string | null;
  isTopic: boolean;
  creatorId: string;
  ownerId: string | null;
}
export interface AuthzMember {
  projectId: string;
  personId: string;
  validFrom: string;
  validTo: string | null;
}
export interface AuthzPerson {
  id: string;
  noReview: boolean;
}
export interface AuthzContext {
  account: { id: string; personId: string; isSystemAdmin: boolean };
  now: string;
  grants: Grant[];
  enrollments: Enrollment[];
  assignments: Assignment[];
  projects: AuthzProject[];
  members: AuthzMember[];
  people: AuthzPerson[];
}
export function isCurrent(
  value: {
    validFrom: string;
    validTo: string | null;
    revokedAt?: string | null;
  },
  now: string,
): boolean {
  const instant = Date.parse(now);
  return (
    Date.parse(value.validFrom) <= instant &&
    (value.validTo === null || instant < Date.parse(value.validTo)) &&
    (value.revokedAt == null || instant < Date.parse(value.revokedAt))
  );
}
export function activeGrants(ctx: AuthzContext): Grant[] {
  return ctx.account.isSystemAdmin
    ? []
    : ctx.grants.filter(
        (grant) =>
          grant.accountId === ctx.account.id &&
          isCurrent(grant, ctx.now) &&
          ((grant.role === 'manager' &&
            grant.scope === 'company' &&
            grant.cohortId === null) ||
            (grant.role !== 'manager' &&
              grant.scope === 'cohort' &&
              grant.cohortId !== null)),
      );
}
function hasEnrollment(
  ctx: AuthzContext,
  grant: Grant,
  personId: string,
): boolean {
  return ctx.enrollments.some(
    (entry) =>
      entry.cohortId === grant.cohortId &&
      entry.personId === personId &&
      entry.confirmed &&
      isCurrent(entry, ctx.now),
  );
}
function fullPersonForGrant(
  ctx: AuthzContext,
  grant: Grant,
  personId: string,
): boolean {
  return (
    (grant.role === 'manager' && grant.scope === 'company') ||
    (grant.role === 'hr' &&
      grant.scope === 'cohort' &&
      hasEnrollment(ctx, grant, personId))
  );
}
function projectForGrant(
  ctx: AuthzContext,
  grant: Grant,
  project: AuthzProject,
): boolean {
  if (grant.role === 'manager' && grant.scope === 'company') return true;
  const participates = ctx.members.some(
    (member) =>
      member.projectId === project.id &&
      member.personId === ctx.account.personId &&
      isCurrent(member, ctx.now),
  );
  if (grant.role === 'hr' && grant.scope === 'cohort') {
    return (
      project.cohortId === grant.cohortId ||
      project.creatorId === ctx.account.personId ||
      project.ownerId === ctx.account.personId ||
      participates ||
      ctx.members.some(
        (member) =>
          member.projectId === project.id &&
          isCurrent(member, ctx.now) &&
          hasEnrollment(ctx, grant, member.personId),
      )
    );
  }
  if (grant.role === 'mentor' && grant.scope === 'cohort') {
    return (
      participates ||
      (project.isTopic &&
        project.cohortId === grant.cohortId &&
        ctx.assignments.some(
          (entry) =>
            entry.cohortId === grant.cohortId &&
            entry.personId === ctx.account.personId &&
            isCurrent(entry, ctx.now),
        ))
    );
  }
  return false;
}
export type AuthorizationRequest =
  | { action: 'projects.read'; purpose: string; project: AuthzProject }
  | { action: 'projects.create'; purpose: string }
  | { action: 'people.full'; purpose: string; personId: string }
  | { action: 'navigate'; purpose: string; navigationId: NavigationId };
const navigationRoles: Record<NavigationId, BusinessRole[]> = {
  work: ['manager', 'hr', 'mentor'],
  people: ['manager', 'hr', 'mentor'],
  review: ['manager', 'hr'],
  queue: ['hr'],
  programs: ['manager', 'hr', 'mentor'],
  projects: ['manager', 'hr', 'mentor'],
  rules: ['manager', 'hr'],
  judge: ['mentor'],
  tags: ['hr'],
  admin: [],
};
/** Each complete grant is tested independently. Never union actions and scopes separately. */
export function authorize(
  ctx: AuthzContext,
  request: AuthorizationRequest,
): boolean {
  if (request.action === 'navigate') {
    if (request.purpose !== 'shell') return false;
    if (ctx.account.isSystemAdmin) return request.navigationId === 'admin';
    return activeGrants(ctx).some((grant) =>
      navigationRoles[request.navigationId].includes(grant.role),
    );
  }
  if (ctx.account.isSystemAdmin) return false;
  const grants = activeGrants(ctx);
  switch (request.action) {
    case 'projects.read':
      return (
        request.purpose === 'project-list' &&
        grants.some((grant) => projectForGrant(ctx, grant, request.project))
      );
    case 'projects.create':
      return (
        request.purpose === 'project-create' &&
        grants.some(
          (grant) =>
            (grant.role === 'manager' && grant.scope === 'company') ||
            (grant.role === 'hr' &&
              grant.scope === 'cohort' &&
              grant.cohortId !== null),
        )
      );
    case 'people.full':
      return (
        request.purpose === 'project-create' &&
        ctx.people.some(
          (person) => person.id === request.personId && !person.noReview,
        ) &&
        grants.some((grant) => fullPersonForGrant(ctx, grant, request.personId))
      );
  }
}
export const canReadProject = (
  ctx: AuthzContext,
  project: AuthzProject,
): boolean =>
  authorize(ctx, { action: 'projects.read', purpose: 'project-list', project });
export const canCreateProject = (ctx: AuthzContext): boolean =>
  authorize(ctx, { action: 'projects.create', purpose: 'project-create' });
export const canReadFullPerson = (
  ctx: AuthzContext,
  personId: string,
): boolean =>
  authorize(ctx, {
    action: 'people.full',
    purpose: 'project-create',
    personId,
  });
export const visibleProjects = (ctx: AuthzContext): AuthzProject[] =>
  ctx.projects.filter((project) => canReadProject(ctx, project));
export const eligiblePeople = (ctx: AuthzContext): AuthzPerson[] =>
  canCreateProject(ctx)
    ? ctx.people.filter((person) => canReadFullPerson(ctx, person.id))
    : [];
export const activeRoles = (ctx: AuthzContext): BusinessRole[] => [
  ...new Set(activeGrants(ctx).map((grant) => grant.role)),
];
export const navigationFor = (ctx: AuthzContext): NavigationId[] =>
  (Object.keys(navigationRoles) as NavigationId[]).filter((navigationId) =>
    authorize(ctx, { action: 'navigate', purpose: 'shell', navigationId }),
  );
