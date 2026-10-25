import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  runtime: vi.fn(),
  create: vi.fn(),
  change: vi.fn(),
}));
vi.mock('../auth/next', () => ({ requireSession: mocks.session }));
vi.mock('../queries/staffing-runtime', () => ({
  staffingDemandRuntime: mocks.runtime,
}));
import {
  createStaffingDemandAction,
  editStaffingDemandAction,
  confirmStaffingDemandAction,
} from './staffing-demand';
import { DemandAccessError } from '../modules/staffing/demand/service';
import { DemandConflictError } from '../modules/staffing/demand/version';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 'server-account' } });
  mocks.runtime.mockResolvedValue({
    service: { create: mocks.create, change: mocks.change },
  });
});
it('retains invalid input without starting the producer or invoking business logic', async () => {
  expect(await createStaffingDemandAction({ inputText: '' })).toMatchObject({
    status: 'validation_error',
    input: { inputText: '' },
  });
  expect(await editStaffingDemandAction({})).toMatchObject({
    status: 'validation_error',
  });
  expect(await confirmStaffingDemandAction({})).toMatchObject({
    status: 'validation_error',
  });
  expect(mocks.runtime).not.toHaveBeenCalled();
});
it('uses the server session and returns the queued snapshot, not a fabricated demand', async () => {
  const snapshot = {
    schemaVersion: 1,
    jobId: 'job',
    kind: 'staffing_demand',
    status: 'queued',
    attempt: 1,
    revision: 1,
    updatedAt: '2026-10-25T00:00:00.000Z',
    progress: null,
    result: null,
    error: null,
    canRetry: false,
    canCancel: true,
    cancelRequestedAt: null,
  };
  mocks.create.mockResolvedValue({ snapshot, replayed: false });
  const input = {
    projectId: 'project',
    inputText: '演示需求',
    operationId: 'operation',
  };
  expect(await createStaffingDemandAction(input)).toEqual({
    status: 'success',
    snapshot,
    replayed: false,
  });
  expect(mocks.create).toHaveBeenCalledWith('server-account', input);
});
it('maps forbidden/conflict while preserving submitted changes and does not hide unknown errors', async () => {
  const input = {
    demandId: 'demand',
    operationId: 'operation',
    expectedRevision: 1,
  };
  mocks.change.mockRejectedValueOnce(new DemandAccessError());
  expect(await confirmStaffingDemandAction(input)).toMatchObject({
    status: 'forbidden',
    input,
  });
  const edit = {
    ...input,
    requirements: [{ id: 'r', text: '工程经验', priority: 'required' }],
  };
  mocks.change.mockRejectedValueOnce(new DemandConflictError());
  expect(await editStaffingDemandAction(edit)).toMatchObject({
    status: 'conflict',
    input: edit,
  });
  mocks.create.mockRejectedValueOnce(new Error('database unavailable'));
  await expect(
    createStaffingDemandAction({
      operationId: 'op',
      projectId: 'p',
      inputText: '演示',
    }),
  ).rejects.toThrow('database unavailable');
});
