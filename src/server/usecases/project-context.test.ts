import { beforeEach, expect, it, vi } from 'vitest';
import { loadProjectContext } from './project-context';
import type { DbExecutor } from '../db/client';
const mocks = vi.hoisted(() => ({
  directory: vi.fn(),
  programs: vi.fn(),
  staffing: vi.fn(),
}));
vi.mock('../modules/directory', () => ({ readDirectory: mocks.directory }));
vi.mock('../modules/programs', () => ({ readProgramScopes: mocks.programs }));
vi.mock('../modules/staffing', () => ({ readStaffing: mocks.staffing }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.directory.mockResolvedValue({
    account: { id: 'a', personId: 'p', isSystemAdmin: false },
    grants: [],
    people: [],
  });
  mocks.programs.mockResolvedValue({ enrollments: [], assignments: [] });
  mocks.staffing.mockResolvedValue({ projects: [], members: [] });
});
it.each([null, { account: { id: 'a', personId: 'p', isSystemAdmin: true } }])(
  'denies unbound/admin before accessing projects or program data',
  async (directory) => {
    mocks.directory.mockResolvedValue(directory);
    await expect(
      loadProjectContext({} as DbExecutor, 'a', '2026-09-04'),
    ).rejects.toThrow('无权限');
    expect(mocks.programs).not.toHaveBeenCalled();
    expect(mocks.staffing).not.toHaveBeenCalled();
  },
);
it('loads current authorization facts from each domain entry', async () => {
  const result = await loadProjectContext({} as DbExecutor, 'a', '2026-09-04');
  expect(result.context).toEqual({
    account: { id: 'a', personId: 'p', isSystemAdmin: false },
    grants: [],
    people: [],
    projects: [],
    members: [],
    enrollments: [],
    assignments: [],
    now: '2026-09-04',
  });
});
