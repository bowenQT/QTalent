import { beforeEach, expect, it, vi } from 'vitest';
import { getAdminConnectionsPage } from './admin';

const mocks = vi.hoisted(() => ({ directory: vi.fn(), session: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../auth/next', () => ({ requireSession: mocks.session }));
vi.mock('../db/client', () => ({ getDatabase: () => ({}) }));
vi.mock('../modules/directory', () => ({ readDirectory: mocks.directory }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 'a' } });
});

it('gives system administrators every block as not connected, never zero', async () => {
  mocks.directory.mockResolvedValue({ account: { isSystemAdmin: true } });
  const page = await getAdminConnectionsPage();
  expect(page.status).toBe('ok');
  if (page.status !== 'ok') return;
  expect(Object.values(page.data)).toEqual(
    Array(6).fill({ status: 'not_connected' }),
  );
});

it.each([
  ['a business account', { account: { isSystemAdmin: false } }],
  ['an account missing from the directory', null],
])('refuses %s', async (_, directory) => {
  mocks.directory.mockResolvedValue(directory);
  expect(await getAdminConnectionsPage()).toEqual({ status: 'forbidden' });
});
