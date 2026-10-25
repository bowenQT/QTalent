import { afterEach, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({
  db: {},
  store: {},
  example: { kind: 'example' },
  demand: { kind: 'staffing_demand' },
  create: vi.fn(),
  demandRuntime: vi.fn(),
  producer: vi.fn(),
}));
vi.mock('../db/client', () => ({ getDatabase: () => f.db }));
vi.mock('../env', () => ({ getEnv: () => ({ APP_ENV: 'test' }) }));
vi.mock('./repository', () => ({ createJobStore: () => f.store }));
vi.mock('./service', () => ({ createJobService: f.create }));
vi.mock('./progress-example', () => ({ exampleJobPolicy: () => f.example }));
vi.mock('../platform/jobs/app-runtime', () => ({
  getAppJobProducer: f.producer,
}));
vi.mock('../usecases/staffing-demand-runtime', () => ({
  staffingDemandQueue: 'staffing-demand',
  createStaffingDemandRuntime: f.demandRuntime,
}));
import { jobService } from './runtime';
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
it('retains existing policy and composes lazy demand policy with business date and real wall time', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-25T12:00:00.000Z'));
  f.demandRuntime.mockReturnValue({ policy: f.demand });
  jobService();
  expect(f.create).toHaveBeenCalledWith(
    f.store,
    expect.arrayContaining([f.example, f.demand]),
    expect.any(Function),
  );
  expect(f.producer).not.toHaveBeenCalled();
  const input = f.demandRuntime.mock.calls[0][0];
  expect(input.db).toBe(f.db);
  expect(input.businessDate()).toBe('2026-09-04');
  expect(f.create.mock.calls[0][2]()).toBe('2026-10-25T12:00:00.000Z');
  await input.boss();
  expect(f.producer).toHaveBeenCalledWith('staffing-demand');
});
