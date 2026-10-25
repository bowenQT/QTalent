import { beforeEach, expect, it, vi } from 'vitest';
import { jobAccount } from './request';
const mocks = vi.hoisted(() => ({ session: vi.fn(), access: vi.fn() }));
vi.mock('../auth', () => ({ getSession: mocks.session }));
vi.mock('../access', () => ({ verifyAccessRequest: mocks.access }));
beforeEach(() => vi.resetAllMocks());
it('checks Access and current session, returning only account ID', async () => {
  const headers = new Headers();
  mocks.session.mockResolvedValue({ user: { id: 'account' } });
  expect(await jobAccount(headers)).toBe('account');
  expect(mocks.access).toHaveBeenCalledWith(headers);
  mocks.session.mockResolvedValue(null);
  expect(await jobAccount(headers)).toBeNull();
  mocks.access.mockRejectedValue(new Error('expired Access'));
  mocks.session.mockClear();
  expect(await jobAccount(headers)).toBeNull();
  expect(mocks.session).not.toHaveBeenCalled();
});
it('does not turn auth database failure into a successful anonymous read', async () => {
  mocks.session.mockRejectedValue(new Error('database'));
  await expect(jobAccount(new Headers())).rejects.toThrow('database');
});
