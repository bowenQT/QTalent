import { expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  compose: vi.fn(),
  producer: vi.fn(),
}));
vi.mock('../db/client', () => ({ getDatabase: () => 'test-database' }));
vi.mock('../env', () => ({ getEnv: () => ({ APP_ENV: 'demo' }) }));
vi.mock('../platform/jobs/app-runtime', () => ({
  getAppJobProducer: mocks.producer,
}));
vi.mock('../usecases/staffing-demand-runtime', () => ({
  createStaffingDemandRuntime: mocks.compose,
  staffingDemandQueue: 'staffing-demand',
}));
import { staffingDemandRuntime } from './staffing-runtime';

it('injects the existing demo business clock without starting the producer', async () => {
  await staffingDemandRuntime();
  const input = mocks.compose.mock.calls[0][0] as {
    businessDate: () => string;
    boss: () => Promise<unknown>;
  };
  expect(input.businessDate()).toBe('2026-09-04');
  expect(mocks.producer).not.toHaveBeenCalled();
  await input.boss();
  expect(mocks.producer).toHaveBeenCalledWith('staffing-demand');
});
