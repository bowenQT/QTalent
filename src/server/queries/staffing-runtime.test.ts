import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AuthzContext } from '../authz';
import { canReadDemand } from '../modules/staffing/demand/policy';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  compose: vi.fn(),
  producer: vi.fn(),
  env: { APP_ENV: 'demo' },
}));
vi.mock('../db/client', () => ({ getDatabase: () => 'test-database' }));
vi.mock('../env', () => ({ getEnv: () => mocks.env }));
vi.mock('../platform/jobs/app-runtime', () => ({
  getAppJobProducer: mocks.producer,
}));
vi.mock('../usecases/staffing-demand-runtime', () => ({
  createStaffingDemandRuntime: mocks.compose,
  staffingDemandQueue: 'staffing-demand',
}));
import { staffingDemandRuntime } from './staffing-runtime';

const demand = { projectId: 'project', initiatorAccountId: 'account' };
function context(now: string): AuthzContext {
  return {
    account: { id: 'account', personId: 'person', isSystemAdmin: false },
    now,
    grants: [
      {
        accountId: 'account',
        role: 'manager',
        scope: 'company',
        cohortId: null,
        validFrom: '2026-09-04T00:00:00.000Z',
        validTo: '2026-09-04T00:00:00.001Z',
        revokedAt: null,
      },
    ],
    enrollments: [],
    assignments: [],
    members: [],
    people: [],
    projects: [
      {
        id: 'project',
        cohortId: null,
        isTopic: false,
        creatorId: 'person',
        ownerId: null,
      },
    ],
  };
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());
it.each(['demo', 'test'])(
  'uses the %s business instant for actual demand authorization, independently of wall time',
  async (environment) => {
    mocks.env.APP_ENV = environment;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-01T12:00:00.000Z'));
    await staffingDemandRuntime();
    const input = mocks.compose.mock.calls[0][0] as {
      now: () => string;
      boss: () => Promise<unknown>;
    };
    expect(input).not.toHaveProperty('businessDate');
    expect(input.now()).toBe('2026-09-04T00:00:00.000Z');
    expect(canReadDemand(context(input.now()), demand)).toBe(true);
    vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
    expect(canReadDemand(context(input.now()), demand)).toBe(true);
    const revoked = context(input.now());
    revoked.grants[0].revokedAt = input.now();
    expect(canReadDemand(revoked, demand)).toBe(false);
    expect(mocks.producer).not.toHaveBeenCalled();
    await input.boss();
    expect(mocks.producer).toHaveBeenCalledWith('staffing-demand');
  },
);
it.each(['production', 'local'])(
  'uses a dynamic full instant and half-open authorization in %s',
  async (environment) => {
    mocks.env.APP_ENV = environment;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-03T23:59:59.999Z'));
    await staffingDemandRuntime();
    const input = mocks.compose.mock.calls[0][0] as { now: () => string };
    expect(canReadDemand(context(input.now()), demand)).toBe(false);
    vi.setSystemTime(new Date('2026-09-04T00:00:00.000Z'));
    expect(canReadDemand(context(input.now()), demand)).toBe(true);
    vi.setSystemTime(new Date('2026-09-04T00:00:00.001Z'));
    expect(input.now()).toBe('2026-09-04T00:00:00.001Z');
    expect(canReadDemand(context(input.now()), demand)).toBe(false);
  },
);
