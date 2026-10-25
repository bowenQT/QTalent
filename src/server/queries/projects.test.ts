import { beforeEach, expect, it, vi } from 'vitest';
import { listProjectsForCurrentUser, getProjectsPage } from './projects';
import type { AuthzContext } from '../authz';
import { ForbiddenError } from '../usecases/project-context';
const mocks = vi.hoisted(() => ({ load: vi.fn(), session: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../db/client', () => ({ getDatabase: () => ({}) }));
vi.mock('../auth/next', () => ({ requireSession: mocks.session }));
vi.mock('../env', () => ({ getEnv: () => ({ APP_ENV: 'test' }) }));
vi.mock('../usecases/project-context', () => ({
  loadProjectContext: mocks.load,
  ForbiddenError: class extends Error {},
}));
let context: AuthzContext;
const project = {
  id: 'pr',
  name: '项目',
  type: '业务项目',
  status: '进行中',
  goal: '目标',
  organizationId: 'org',
  cohortId: null,
  isTopic: false,
  ownerId: 'p1' as string | null,
  creatorId: 'p1',
  from: '2026-01-01',
  to: '2026-12-31',
  sortOrder: 0,
};
const person = {
  id: 'p1',
  name: '测试一',
  organizationId: 'org',
  hue: 220,
  photo: null,
  noReview: false,
  demo: true,
};
const member = {
  id: 'm',
  projectId: 'pr',
  personId: 'p1',
  role: 'owner',
  mode: '兼职',
  validFrom: '2026-01-01',
  validTo: null as string | null,
  by: 'p1',
};
let loaded: {
  context: AuthzContext;
  directory: {
    people: (typeof person)[];
    organizations: { id: string; shortName: string }[];
  };
  staffing: { projects: (typeof project)[]; members: (typeof member)[] };
};
beforeEach(() => {
  vi.clearAllMocks();
  context = {
    account: { id: 'a', personId: 'p1', isSystemAdmin: false },
    now: '2026-09-04',
    grants: [
      {
        accountId: 'a',
        role: 'manager',
        scope: 'company',
        cohortId: null,
        validFrom: '2026-01-01',
        validTo: null,
        revokedAt: null,
      },
    ],
    people: [person],
    projects: [{ ...project, isTopic: false }],
    members: [member],
    enrollments: [],
    assignments: [],
  };
  loaded = {
    context,
    directory: {
      people: [person],
      organizations: [{ id: 'org', shortName: '组织' }],
    },
    staffing: { projects: [{ ...project }], members: [{ ...member }] },
  };
  mocks.session.mockResolvedValue({ user: { id: 'a' } });
  mocks.load.mockImplementation(async () => loaded);
});
it('returns minimal card and eligible picker projection', async () => {
  const result = await listProjectsForCurrentUser();
  expect(result.projects[0]).toEqual({
    id: 'pr',
    name: '项目',
    type: '业务项目',
    status: '进行中',
    goal: '目标',
    orgName: '组织',
    from: '2026-01-01',
    to: '2026-12-31',
    owner: { id: 'p1', name: '测试一' },
    members: [{ id: 'p1', name: '测试一', hue: 220, photo: null }],
    memberCount: 1,
  });
  expect(result.eligiblePeople[0].currentProjectCount).toBe(1);
  expect(result.canCreate).toBe(true);
  expect(result.projects[0]).not.toHaveProperty('creatorId');
});
it('does not expose projects or person picker on revoked grant', async () => {
  context.grants[0].revokedAt = context.now;
  expect(await listProjectsForCurrentUser()).toEqual({
    canCreate: false,
    eligiblePeople: [],
    projects: [],
  });
});
it('expired member excluded while project ongoing, included on ended project', async () => {
  loaded.staffing.members[0].validTo = '2026-09-01';
  expect((await listProjectsForCurrentUser()).projects[0].memberCount).toBe(0);
  loaded.staffing.projects[0].status = '已结束';
  expect((await listProjectsForCurrentUser()).projects[0].memberCount).toBe(1);
});
it('owner can be unset and empty members rendered without fabricated people', async () => {
  loaded.staffing.projects[0].ownerId = null;
  loaded.staffing.members = [];
  const result = await listProjectsForCurrentUser();
  expect(result.projects[0].owner).toBeNull();
  expect(result.projects[0].members).toEqual([]);
});
it('broken member references are errors, not silently successful empty rows', async () => {
  loaded.directory.people = [];
  await expect(listProjectsForCurrentUser()).rejects.toThrow(
    '项目成员引用不存在',
  );
});
it('maps only explicit authorization errors to forbidden', async () => {
  mocks.load.mockRejectedValue(new ForbiddenError());
  expect(await getProjectsPage()).toEqual({ status: 'forbidden' });
  mocks.load.mockRejectedValue(new Error('db unavailable'));
  await expect(getProjectsPage()).rejects.toThrow('db unavailable');
});
it('successful page retains discriminated result', async () => {
  expect((await getProjectsPage()).status).toBe('ok');
});
