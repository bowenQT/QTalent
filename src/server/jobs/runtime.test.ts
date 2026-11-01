import { afterEach, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({
  db: {},
  store: {},
  example: { kind: 'example' },
  demand: { kind: 'staffing_demand' },
  create: vi.fn(),
  demandRuntime: vi.fn(),
  producer: vi.fn(),
  env: { APP_ENV: 'test' },
}));
vi.mock('../db/client', () => ({ getDatabase: () => f.db }));
vi.mock('../env', () => ({ getEnv: () => f.env }));
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
it.each(['demo', 'test', 'production', 'local'])(
  'composes dynamic %s demand time while retaining the job audit wall clock',
  async (environment) => {
    f.env.APP_ENV = environment;
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
    const fixed = environment === 'demo' || environment === 'test';
    expect(input.db).toBe(f.db);
    expect(input).not.toHaveProperty('businessDate');
    expect(input.now()).toBe(
      fixed ? '2026-09-04T00:00:00.000Z' : '2026-10-25T12:00:00.000Z',
    );
    expect(f.create.mock.calls[0][2]()).toBe('2026-10-25T12:00:00.000Z');
    vi.setSystemTime(new Date('2026-10-25T12:00:00.001Z'));
    expect(input.now()).toBe(
      fixed ? '2026-09-04T00:00:00.000Z' : '2026-10-25T12:00:00.001Z',
    );
    expect(f.create.mock.calls[0][2]()).toBe('2026-10-25T12:00:00.001Z');
    await input.boss();
    expect(f.producer).toHaveBeenCalledWith('staffing-demand');
  },
);
