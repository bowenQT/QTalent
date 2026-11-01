import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  service: vi.fn(),
  source: vi.fn(),
  start: vi.fn(),
  read: vi.fn(),
  judge: vi.fn(),
}));
vi.mock('../auth/next', () => ({ requireSession: mocks.session }));
vi.mock('../queries/staffing-match-runtime', () => ({
  staffingMatchService: mocks.service,
}));
vi.mock('../queries/sources', () => ({
  readSourceForCurrentUser: mocks.source,
}));
import {
  judgeStaffingMatchAction,
  openStaffingMatchAction,
  readStaffingMatchAction,
  readStaffingSourceAction,
} from './staffing-match';
import { staffingMatchService } from '../queries/staffing-match-runtime';

const snapshot = {
  schemaVersion: 1,
  jobId: 'run-1',
  kind: 'staffing_match',
  status: 'queued',
  attempt: 1,
  revision: 1,
  updatedAt: '2026-09-04T02:00:00.000Z',
  progress: null,
  result: null,
  error: null,
  canRetry: false,
  canCancel: false,
  cancelRequestedAt: null,
};
const judgment = {
  operationId: 'op-1',
  demandId: 'demo-demand',
  expectedRevision: 2,
  personId: 'p1',
  requirementId: 'r1',
  conclusion: 'insufficient',
  rationale: '演示：没有到岗记录',
  sources: [],
};
const judged = {
  status: 'success',
  demandId: 'demo-demand',
  personId: 'p1',
  revision: 2,
  match: {
    requirementId: 'r1',
    progress: 'completed',
    aiJudgment: null,
    humanJudgment: {
      conclusion: 'insufficient',
      rationale: '演示：没有到岗记录',
      sources: [],
      judgedBy: { id: 'demo-hr', name: '演示审核人' },
      judgedAt: '2026-09-04T02:00:00.000Z',
    },
  },
  replayed: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 'server-account' } });
  mocks.service.mockResolvedValue({
    start: mocks.start,
    read: mocks.read,
    judge: mocks.judge,
  });
});

it('answers not connected while the server composes no matching runtime', async () => {
  mocks.service.mockResolvedValue(null);
  expect(
    await openStaffingMatchAction({ demandId: 'demo-demand', revision: 2 }),
  ).toEqual({ status: 'not_connected' });
  expect(await readStaffingMatchAction('run-1')).toEqual({
    status: 'not_connected',
  });
  expect(await judgeStaffingMatchAction('run-1', judgment)).toEqual({
    status: 'not_connected',
  });
  expect(mocks.session).toHaveBeenCalledTimes(3);
});

it('the composition point has no runtime yet', async () => {
  const actual = await vi.importActual<
    typeof import('../queries/staffing-match-runtime')
  >('../queries/staffing-match-runtime');
  expect(await actual.staffingMatchService()).toBeNull();
  expect(staffingMatchService).toBe(mocks.service);
});

it('opens one run per demand revision for the session account, replaying it after', async () => {
  mocks.start.mockResolvedValue({
    status: 'success',
    runId: 'run-1',
    replayed: false,
    snapshot,
  });
  expect(
    await openStaffingMatchAction({ demandId: 'demo-demand', revision: 2 }),
  ).toEqual({ status: 'success', jobId: 'run-1', replayed: false });
  await openStaffingMatchAction({ demandId: 'demo-demand', revision: 2 });
  await openStaffingMatchAction({ demandId: 'demo-demand', revision: 3 });
  const [first, again, next] = mocks.start.mock.calls;
  expect(first![0]).toBe('server-account');
  expect(first![1]).toMatchObject({
    demandId: 'demo-demand',
    expectedRevision: 2,
  });
  expect(again![1].operationId).toBe(first![1].operationId);
  expect(next![1].operationId).not.toBe(first![1].operationId);
});

it('refuses bad input before the session or the runtime', async () => {
  for (const input of [
    {},
    { demandId: '', revision: 1 },
    { demandId: 'd', revision: 0 },
    { demandId: 'd', revision: 1, accountId: 'forged' },
  ])
    expect(await openStaffingMatchAction(input)).toMatchObject({
      status: 'validation_error',
    });
  expect(await readStaffingMatchAction('')).toMatchObject({
    status: 'not_found',
  });
  expect(await judgeStaffingMatchAction(42, judgment)).toMatchObject({
    status: 'not_found',
  });
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.service).not.toHaveBeenCalled();
});

it('passes the usecase refusals through, not a decision of its own', async () => {
  for (const status of ['forbidden', 'not_found', 'conflict'] as const) {
    mocks.start.mockResolvedValueOnce({ status, message: '匹配已变化' });
    expect(
      await openStaffingMatchAction({ demandId: 'demo-demand', revision: 2 }),
    ).toEqual({ status, message: '匹配已变化' });
  }
  mocks.start.mockResolvedValueOnce({
    status: 'validation_error',
    fieldErrors: { demandId: ['x'] },
    input: {},
  });
  expect(
    await openStaffingMatchAction({ demandId: 'demo-demand', revision: 2 }),
  ).toEqual({ status: 'validation_error', fieldErrors: { demandId: ['x'] } });
  mocks.start.mockResolvedValueOnce({ status: 'surprise' });
  await expect(
    openStaffingMatchAction({ demandId: 'demo-demand', revision: 2 }),
  ).rejects.toThrow('Unexpected matching result');
});

it('reads the run as a checked job snapshot and words a moved revision as a conflict', async () => {
  mocks.read.mockResolvedValueOnce({ status: 'success', page: {}, snapshot });
  expect(await readStaffingMatchAction('run-1')).toEqual({
    status: 'success',
    snapshot,
  });
  expect(mocks.read).toHaveBeenCalledWith('server-account', 'run-1');
  mocks.read.mockResolvedValueOnce({
    status: 'stale',
    runId: 'run-1',
    demandId: 'd',
    demandRevision: 1,
  });
  expect(await readStaffingMatchAction('run-1')).toMatchObject({
    status: 'conflict',
  });
  mocks.read.mockResolvedValueOnce({ status: 'not_found' });
  expect(await readStaffingMatchAction('run-1')).toEqual({
    status: 'not_found',
    message: '这次核对不存在或不可见',
  });
  mocks.read.mockResolvedValueOnce({ status: 'forbidden', message: 'x' });
  expect(await readStaffingMatchAction('run-1')).toEqual({
    status: 'forbidden',
    message: 'x',
  });
  mocks.read.mockResolvedValueOnce({
    status: 'success',
    page: {},
    snapshot: { ...snapshot, kind: 'staffing_demand' },
  });
  await expect(readStaffingMatchAction('run-1')).rejects.toThrow();
});

it('saves a judgment on its run for the session account and checks the answer', async () => {
  mocks.judge.mockResolvedValueOnce(judged);
  expect(await judgeStaffingMatchAction('run-1', judgment)).toEqual(judged);
  expect(mocks.judge).toHaveBeenCalledWith('server-account', 'run-1', judgment);
  const refused = { status: 'conflict', message: 'x', input: judgment };
  mocks.judge.mockResolvedValueOnce(refused);
  expect(await judgeStaffingMatchAction('run-1', judgment)).toEqual(refused);
  // A success without the signed conclusion is not passed on.
  mocks.judge.mockResolvedValueOnce({
    ...judged,
    match: { ...judged.match, humanJudgment: null },
  });
  await expect(judgeStaffingMatchAction('run-1', judgment)).rejects.toThrow();
});

it('opens a cited source through the current-account source read', async () => {
  const result = { status: 'not_found', message: '来源不存在或不可见' };
  mocks.source.mockResolvedValue(result);
  const reference = { fragmentId: 'f', originalVersionId: 'v' };
  expect(await readStaffingSourceAction(reference)).toBe(result);
  expect(mocks.source).toHaveBeenCalledWith(reference);
});
