import { beforeEach, expect, it, vi } from 'vitest';
import { commandJobAction } from './jobs';
const mocks = vi.hoisted(() => ({ account: vi.fn(), command: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../jobs/request', () => ({ jobAccount: mocks.account }));
vi.mock('../jobs/runtime', () => ({
  jobService: () => ({ command: mocks.command }),
}));
const input = {
  jobId: 'j',
  action: 'retry',
  expectedRevision: 1,
  operationId: 'op',
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.account.mockResolvedValue('account');
  mocks.command.mockResolvedValue({ status: 'forbidden' });
});
it('rejects invalid or unauthenticated mutations before storage', async () => {
  expect(await commandJobAction({ ...input, accountId: 'attacker' })).toEqual({
    status: 'validation_error',
  });
  mocks.account.mockResolvedValue(null);
  expect(await commandJobAction(input)).toEqual({ status: 'unauthenticated' });
  expect(mocks.command).not.toHaveBeenCalled();
});
it('uses the server session rather than client account claims', async () => {
  expect(await commandJobAction(input)).toEqual({ status: 'forbidden' });
  expect(mocks.command).toHaveBeenCalledWith('account', input);
});
