import { beforeEach, expect, it, vi } from 'vitest';
import { readJobForCurrentUser } from './jobs';
const mocks = vi.hoisted(() => ({ account: vi.fn(), read: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../jobs/request', () => ({ jobAccount: mocks.account }));
vi.mock('../jobs/runtime', () => ({
  jobService: () => ({ read: mocks.read }),
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.account.mockResolvedValue('account');
  mocks.read.mockResolvedValue({ status: 'not_found' });
});
it('validates resource ID and rejects unauthenticated reads before storage', async () => {
  expect(await readJobForCurrentUser('')).toEqual({
    status: 'validation_error',
  });
  expect(await readJobForCurrentUser('x'.repeat(201))).toEqual({
    status: 'validation_error',
  });
  mocks.account.mockResolvedValue(null);
  expect(await readJobForCurrentUser('job')).toEqual({
    status: 'unauthenticated',
  });
  expect(mocks.read).not.toHaveBeenCalled();
});
it('passes trusted current account to the domain service', async () => {
  expect(await readJobForCurrentUser('job')).toEqual({ status: 'not_found' });
  expect(mocks.read).toHaveBeenCalledWith('account', 'job');
});
