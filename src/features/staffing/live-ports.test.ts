import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StaffingDemand } from '@/contracts/staffing';

const actions = vi.hoisted(() => ({
  createStaffingDemandAction: vi.fn(),
  editStaffingDemandAction: vi.fn(),
  confirmStaffingDemandAction: vi.fn(),
}));
const matching = vi.hoisted(() => ({
  openStaffingMatchAction: vi.fn(),
  readStaffingMatchAction: vi.fn(),
  judgeStaffingMatchAction: vi.fn(),
  readStaffingSourceAction: vi.fn(),
}));
vi.mock('@/server/actions/staffing-demand', () => actions);
vi.mock('@/server/actions/staffing-match', () => matching);

import { livePorts } from './live-ports';

afterEach(() => {
  vi.unstubAllGlobals();
  for (const action of [...Object.values(actions), ...Object.values(matching)])
    action.mockReset();
});

const demand: StaffingDemand = {
  id: 'demo-demand',
  projectId: 'demo-project',
  revision: 1,
  inputText: '演示：寻找服务端负责人',
  requirements: [{ id: 'r1', text: '独立交付模块', priority: 'required' }],
  status: 'draft',
};
const snapshot = (kind: string, result: unknown) => ({
  schemaVersion: 1,
  jobId: 'job-1',
  kind,
  status: 'completed',
  attempt: 1,
  revision: 1,
  updatedAt: '2026-09-04T02:00:00Z',
  progress: null,
  result,
  error: null,
  canRetry: false,
  canCancel: false,
  cancelRequestedAt: null,
});

describe('live ports', () => {
  it('binds the page project to the sentence and passes edits through', async () => {
    const ports = livePorts('demo-project');
    actions.createStaffingDemandAction.mockResolvedValue({ status: 'x' });
    await ports.createDemand({ operationId: 'op-1', inputText: '找人' });
    expect(actions.createStaffingDemandAction).toHaveBeenCalledWith({
      operationId: 'op-1',
      inputText: '找人',
      projectId: 'demo-project',
    });
    const edit = {
      operationId: 'op-2',
      demandId: 'demo-demand',
      expectedRevision: 1,
      requirements: demand.requirements,
    };
    await ports.editDemand(edit);
    expect(actions.editStaffingDemandAction).toHaveBeenCalledWith(edit);
    const confirm = {
      operationId: 'op-3',
      demandId: 'demo-demand',
      expectedRevision: 2,
    };
    await ports.confirmDemand(confirm);
    expect(actions.confirmStaffingDemandAction).toHaveBeenCalledWith(confirm);
  });

  it('reads the drafting job through the shared job endpoint, checked against the demand schema', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify(snapshot('staffing_demand', demand))),
    );
    vi.stubGlobal('fetch', fetch);
    const read = await livePorts('demo-project').readDemandJob(
      'job-1',
      new AbortController().signal,
    );
    expect(read.result).toEqual(demand);
    expect(fetch).toHaveBeenCalledWith('/api/jobs/job-1', expect.anything());
    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify(snapshot('staffing_match', demand))),
    );
    await expect(
      livePorts('demo-project').readDemandJob(
        'job-1',
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });

  const judgment = {
    operationId: 'op-4',
    demandId: 'demo-demand',
    expectedRevision: 2,
    personId: 'p1',
    requirementId: 'r1',
    conclusion: 'insufficient' as const,
    rationale: '演示',
    sources: [],
  };
  const statusOf = (promise: Promise<unknown>) =>
    promise.then(
      () => 'resolved',
      (error: { status?: number }) => error.status,
    );

  it('keeps matching not connected while the server has no matching runtime', async () => {
    const ports = livePorts('demo-project');
    matching.openStaffingMatchAction.mockResolvedValue({
      status: 'not_connected',
    });
    expect(
      await ports.openMatching({ demandId: 'demo-demand', revision: 2 }),
    ).toBeNull();
    expect(matching.openStaffingMatchAction).toHaveBeenCalledWith({
      demandId: 'demo-demand',
      revision: 2,
    });
    matching.judgeStaffingMatchAction.mockResolvedValue({
      status: 'not_connected',
    });
    expect(await ports.judge('run-1', judgment)).toEqual({
      status: 'not_found',
      message: '人工判断待接通',
      input: judgment,
    });
    matching.readStaffingMatchAction.mockResolvedValue({
      status: 'not_connected',
    });
    expect(
      await statusOf(
        ports.readMatchingJob('run-1', new AbortController().signal),
      ),
    ).toBe(404);
  });

  it('opens, reads and judges the matching run through its actions', async () => {
    const ports = livePorts('demo-project');
    matching.openStaffingMatchAction.mockResolvedValue({
      status: 'success',
      jobId: 'run-1',
      replayed: true,
    });
    expect(
      await ports.openMatching({ demandId: 'demo-demand', revision: 2 }),
    ).toBe('run-1');
    const queued = { ...snapshot('staffing_match', null), status: 'queued' };
    matching.readStaffingMatchAction.mockResolvedValue({
      status: 'success',
      snapshot: queued,
    });
    expect(
      (await ports.readMatchingJob('run-1', new AbortController().signal))
        .status,
    ).toBe('queued');
    expect(matching.readStaffingMatchAction).toHaveBeenCalledWith('run-1');
    // A snapshot of another kind is not this page's.
    matching.readStaffingMatchAction.mockResolvedValue({
      status: 'success',
      snapshot: snapshot('staffing_demand', demand),
    });
    await expect(
      ports.readMatchingJob('run-1', new AbortController().signal),
    ).rejects.toThrow();
    const saved = { status: 'conflict', message: 'x', input: judgment };
    matching.judgeStaffingMatchAction.mockResolvedValue(saved);
    expect(await ports.judge('run-1', judgment)).toBe(saved);
    expect(matching.judgeStaffingMatchAction).toHaveBeenCalledWith(
      'run-1',
      judgment,
    );
    const source = { fragmentId: 'f', originalVersionId: 'v' };
    matching.readStaffingSourceAction.mockResolvedValue({
      status: 'not_found',
      message: '来源不存在或不可见',
    });
    expect(await ports.loadSource(source)).toEqual({
      status: 'not_found',
      message: '来源不存在或不可见',
    });
    expect(matching.readStaffingSourceAction).toHaveBeenCalledWith(source);
  });

  it('turns refusals into the job read statuses the page tells apart', async () => {
    const ports = livePorts('demo-project');
    for (const [status, code] of [
      ['forbidden', 403],
      ['not_found', 404],
      ['conflict', 409],
    ] as const) {
      matching.openStaffingMatchAction.mockResolvedValueOnce({
        status,
        message: 'x',
      });
      expect(
        await statusOf(
          ports.openMatching({ demandId: 'demo-demand', revision: 2 }),
        ),
      ).toBe(code);
      matching.readStaffingMatchAction.mockResolvedValueOnce({
        status,
        message: 'x',
      });
      expect(
        await statusOf(
          ports.readMatchingJob('run-1', new AbortController().signal),
        ),
      ).toBe(code);
    }
    matching.openStaffingMatchAction.mockResolvedValueOnce({
      status: 'validation_error',
      fieldErrors: {},
    });
    expect(
      await statusOf(
        ports.openMatching({ demandId: 'demo-demand', revision: 2 }),
      ),
    ).toBe(400);
    // A read the page gave up on is not handed back.
    const aborted = new AbortController();
    aborted.abort();
    matching.readStaffingMatchAction.mockResolvedValueOnce({
      status: 'success',
      snapshot: snapshot('staffing_match', null),
    });
    await expect(
      ports.readMatchingJob('run-1', aborted.signal),
    ).rejects.toThrow();
  });
});
