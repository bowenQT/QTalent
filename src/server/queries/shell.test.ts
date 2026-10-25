import { beforeEach, expect, it, vi } from 'vitest';
import { getShellForCurrentUser } from './shell';
import type { Grant } from '../authz';
const mocks = vi.hoisted(() => ({ directory: vi.fn(), session: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../auth/next', () => ({ requireSession: mocks.session }));
vi.mock('../db/client', () => ({ getDatabase: () => ({}) }));
vi.mock('../env', () => ({ getEnv: () => ({ APP_ENV: 'test' }) }));
vi.mock('../modules/directory', () => ({ readDirectory: mocks.directory }));
const grant: Grant = {
  accountId: 'a',
  role: 'manager',
  scope: 'company',
  cohortId: null,
  validFrom: '2026-01-01',
  validTo: null,
  revokedAt: null,
};
let directory: {
  account: { id: string; personId: string; isSystemAdmin: boolean };
  grants: Grant[];
  people: { id: string; hue: number }[];
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({
    user: { id: 'a', name: '测试账号', email: 'test@example.test' },
  });
  directory = {
    account: { id: 'a', personId: 'p', isSystemAdmin: false },
    grants: [{ ...grant }],
    people: [{ id: 'p', hue: 123 }],
  };
  mocks.directory.mockImplementation(async () => directory);
});
it('manager shell has no manufactured counts or recent items', async () => {
  const result = await getShellForCurrentUser();
  expect(result.role).toBe('manager');
  expect(result.counts).toEqual({ status: 'not_connected' });
  expect(result.recent).toEqual({ status: 'not_connected' });
  expect(result.navigation.map((n) => n.id)).toEqual([
    'work',
    'people',
    'review',
    'programs',
    'projects',
    'rules',
  ]);
});
it('administrator has no search or business navigation even when malformed grants exist', async () => {
  directory.account.isSystemAdmin = true;
  const result = await getShellForCurrentUser();
  expect(result.navigation.map((n) => n.id)).toEqual(['admin']);
  expect(result.canSearch).toBe(false);
  expect(result.account.roles).toEqual(['admin']);
});
it.each(['hr', 'mentor'] as const)('uses current %s preset', async (role) => {
  directory.grants = [{ ...grant, role, scope: 'cohort', cohortId: 'c' }];
  const result = await getShellForCurrentUser();
  expect(result.role).toBe(role);
  if (role === 'mentor')
    expect(result.navigation.find((n) => n.id === 'people')?.label).toBe(
      '所带学员',
    );
});
it('multiple roles get union navigation without changing active account', async () => {
  directory.grants.push({
    ...grant,
    role: 'hr',
    scope: 'cohort',
    cohortId: 'c',
  });
  const result = await getShellForCurrentUser();
  expect(result.account.roles).toEqual(['manager', 'hr']);
  expect(result.navigation.some((n) => n.id === 'queue')).toBe(true);
});
it('missing binding or revoked roles are denied, never defaulted to a business preset', async () => {
  mocks.directory.mockResolvedValueOnce(null);
  await expect(getShellForCurrentUser()).rejects.toThrow('无权限');
  directory.grants[0].revokedAt = '2026-09-04';
  await expect(getShellForCurrentUser()).rejects.toThrow('无权限');
});
it('missing own avatar uses a neutral default', async () => {
  directory.people = [];
  expect((await getShellForCurrentUser()).account.hue).toBe(220);
});
it.each([
  ['demo-ceo', 'manager', '公司层：看人、找人，确认规则与方案'],
  ['demo-hrbp', 'hr', '人才项目：XEngineer、Landing、校招、黑客松'],
  ['demo-mentor', 'mentor', '分镜工厂 · 二组、口语搭子 · 一组的学员'],
] as const)(
  'preserves baseline account presentation for %s',
  async (id, role, scopeLabel) => {
    directory.account.id = id;
    directory.grants = [
      {
        ...grant,
        accountId: id,
        role,
        scope: role === 'manager' ? 'company' : 'cohort',
        cohortId: role === 'manager' ? null : 'b-xe6',
      },
    ];
    mocks.session.mockResolvedValue({
      user: { id, name: '测试账号', email: 'test@example.test' },
    });
    const result = await getShellForCurrentUser();
    expect(result.account.scopeLabel).toBe(scopeLabel);
    expect(result.navigation.find((n) => n.id === 'programs')?.href).toBe(
      role === 'manager' ? '/program-actions' : '/programs',
    );
  },
);
