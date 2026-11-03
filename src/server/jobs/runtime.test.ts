import { afterEach, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({
  db: {},
  example: { kind: 'example' },
  demand: { kind: 'staffing_demand' },
  arrange: { kind: 'record_organize' },
  parsedAttachment: { kind: 'record_attachment_organize' },
  parsedAttachmentRuntime: vi.fn(),
  match: { kind: 'staffing_match' },
  matchRuntime: vi.fn(),
  arrangeStore: {},
  arrangeRuntime: vi.fn(),
  create: vi.fn(),
  demandRuntime: vi.fn(),
  producer: vi.fn(),
  env: { APP_ENV: 'test' },
}));
vi.mock('../db/client', () => ({ getDatabase: () => f.db }));
vi.mock('../env', () => ({ getEnv: () => f.env }));
vi.mock('./service', () => ({ createJobService: f.create }));
vi.mock('./progress-example', () => ({ exampleJobPolicy: () => f.example }));
vi.mock('../platform/jobs/app-runtime', () => ({
  getAppJobProducer: f.producer,
}));
vi.mock('../usecases/staffing-demand-runtime', () => ({
  staffingDemandQueue: 'staffing-demand',
  createStaffingDemandRuntime: f.demandRuntime,
}));
vi.mock('../usecases/record-arrange-runtime', () => ({
  recordArrangeRequestsForServer: f.arrangeRuntime,
}));
vi.mock('../usecases/parsed-attachment-runtime', () => ({
  parsedAttachmentRequestsForServer: f.parsedAttachmentRuntime,
}));
vi.mock('../usecases/staffing-match-runtime', () => ({
  createStaffingMatchServerRuntime: f.matchRuntime,
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
    f.arrangeRuntime.mockReturnValue({
      policy: f.arrange,
      native: { store: f.arrangeStore },
    });
    f.parsedAttachmentRuntime.mockReturnValue({
      policy: f.parsedAttachment,
    });
    f.matchRuntime.mockReturnValue({ policy: f.match });
    jobService();
    expect(f.create).toHaveBeenCalledWith(
      f.arrangeStore,
      [f.example, f.demand, f.arrange, f.parsedAttachment, f.match],
      expect.any(Function),
    );
    expect(f.parsedAttachmentRuntime).toHaveBeenCalledOnce();
    expect(f.parsedAttachmentRuntime).toHaveBeenCalledWith();
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
    const match = f.matchRuntime.mock.calls[0][0];
    expect(match).toMatchObject({ db: f.db, environment, env: f.env });
    expect(match.boss).toBe(f.producer);
    expect(match.wallNow().toISOString()).toBe('2026-10-25T12:00:00.001Z');
  },
);
