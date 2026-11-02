import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StaffingDemand } from '@/contracts/staffing';

const actions = vi.hoisted(() => ({
  createStaffingDemandAction: vi.fn(),
  editStaffingDemandAction: vi.fn(),
  confirmStaffingDemandAction: vi.fn(),
}));
vi.mock('@/server/actions/staffing-demand', () => actions);

import { livePorts } from './live-ports';

afterEach(() => {
  vi.unstubAllGlobals();
  for (const action of Object.values(actions)) action.mockReset();
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

  it('keeps matching not connected until BOW-854 is on main', async () => {
    const ports = livePorts('demo-project');
    expect(
      await ports.openMatching({ demandId: 'demo-demand', revision: 2 }),
    ).toBeNull();
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
    expect(await ports.judge(judgment)).toEqual({
      status: 'not_found',
      message: '人工判断待接通',
      input: judgment,
    });
    expect(
      await ports.loadSource({ fragmentId: 'f', originalVersionId: 'v' }),
    ).toEqual({ status: 'not_found', message: '来源读取待接通' });
    // The matching read itself is the shared job read, ready for when 854 lands.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ...snapshot('staffing_match', null),
              status: 'queued',
            }),
          ),
      ),
    );
    expect(
      (await ports.readMatchingJob('job-2', new AbortController().signal))
        .status,
    ).toBe('queued');
  });
});
