import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { mapPrototypeSeed, readPrototypeSeed } from '../db/seed';
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

// Execute the pinned prototype implementation as the oracle, not a copy of its counting rule.
function prototypePickerCounts(
  role: 'ceo' | 'hrbp',
): { id: string; count: number }[] {
  const vm = createContext(
    {
      window: { NT: {} },
      role,
      matchMedia: () => ({ matches: true }),
      document: { readyState: 'loading', addEventListener: () => {} },
    },
    { codeGeneration: { strings: false, wasm: false } },
  );
  runInContext(readFileSync('prototype/y/app/js/core.js', 'utf8'), vm, {
    timeout: 1000,
  });
  runInContext(
    'window.NT.clone = value => JSON.parse(JSON.stringify(value)); window.NT.param = () => role;',
    vm,
  );
  for (const file of ['data-xe6.js', 'data.js'])
    runInContext(readFileSync(`prototype/y/app/js/${file}`, 'utf8'), vm, {
      timeout: 1000,
    });
  // Use a pristine saved seed state, bypassing unrelated derived snapshot initialization.
  runInContext(
    `const seed = window.NT.SEED;
    const saved = JSON.stringify({ v: seed.version, projects: seed.PROJECTS, members: seed.MEMBERS, batches: seed.BATCHES });
    globalThis.localStorage = { getItem: key => key === 'nty-demo' ? saved : role, setItem: () => {} };`,
    vm,
  );
  const path = 'prototype/y/app/js/store.js';
  const source = readFileSync(path);
  const manifest = JSON.parse(
    readFileSync('tests/fixtures/prototype-manifest.json', 'utf8'),
  ) as { files: { path: string; sha: string }[] };
  expect(
    createHash('sha1')
      .update(`blob ${source.length}\0`)
      .update(source)
      .digest('hex'),
  ).toBe(manifest.files.find((file) => file.path === path)?.sha);
  runInContext(source.toString(), vm, { timeout: 1000 });
  return JSON.parse(
    runInContext(
      `JSON.stringify(window.NT.store.visiblePeople().filter(p => window.NT.store.scope(p.id) === 'full').map(p => ({id: p.id, count: window.NT.store.projectLoad(p.id).cur})))`,
      vm,
    ),
  );
}
it.each(['ceo', 'hrbp'] as const)(
  'matches every one of the 93 prototype picker counts for %s',
  async (role) => {
    const mapped = mapPrototypeSeed(readPrototypeSeed(process.cwd()));
    const account = mapped.accounts.find(
      (account) => account.id === `demo-${role}`,
    )!;
    mocks.session.mockResolvedValue({ user: { id: account.id } });
    mocks.load.mockResolvedValue({
      context: { ...mapped, account, now: '2026-09-04' },
      directory: {
        people: mapped.people,
        organizations: mapped.organizations.map((org) => ({
          ...org,
          shortName: org.name,
        })),
      },
      staffing: mapped,
    });
    const expected = prototypePickerCounts(role);
    const actual = (await listProjectsForCurrentUser()).eligiblePeople.map(
      (person) => ({ id: person.id, count: person.currentProjectCount }),
    );
    expect(expected).toHaveLength(93);
    expect(actual).toHaveLength(93);
    expect(actual).toEqual(expected);
  },
);
it.each(['已结束', '已归档'])(
  'picker still counts an unclosed membership on a %s project',
  async (status) => {
    loaded.staffing.projects[0].status = status;
    expect(
      (await listProjectsForCurrentUser()).eligiblePeople[0]
        .currentProjectCount,
    ).toBe(1);
  },
);
it('picker uses the unclosed-membership marker rather than evaluating membership dates', async () => {
  loaded.staffing.members[0].validFrom = '2026-12-01';
  expect(
    (await listProjectsForCurrentUser()).eligiblePeople[0].currentProjectCount,
  ).toBe(1);
  loaded.staffing.members[0].validFrom = '2026-01-01';
  loaded.staffing.members[0].validTo = '2026-12-01';
  expect(
    (await listProjectsForCurrentUser()).eligiblePeople[0].currentProjectCount,
  ).toBe(0);
});
it('picker count never discloses an unreadable project even for an eligible person', async () => {
  context.grants = [
    { ...context.grants[0], role: 'hr', scope: 'cohort', cohortId: 'mine' },
  ];
  context.enrollments = [
    {
      cohortId: 'mine',
      personId: 'p1',
      confirmed: true,
      validFrom: '2026-01-01',
      validTo: null,
      revokedAt: null,
    },
  ];
  // A future membership does not yet make this outside-cohort project readable.
  loaded.staffing.projects[0].creatorId = 'someone-else';
  loaded.staffing.projects[0].ownerId = null;
  loaded.staffing.members[0].validFrom = '2026-12-01';
  context.members = loaded.staffing.members;
  expect(
    (await listProjectsForCurrentUser()).eligiblePeople[0].currentProjectCount,
  ).toBe(0);
});
