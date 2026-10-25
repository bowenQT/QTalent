import { expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ read: vi.fn(), runtime: vi.fn() }));
vi.mock('../auth/next', () => ({ requireSession: async () => ({ user: { id: 'account' } }) }));
vi.mock('./staffing-runtime', () => ({ staffingDemandRuntime: mocks.runtime }));
import { readStaffingDemand } from './staffing-demand';
import { DemandAccessError } from '../modules/staffing/demand/service';
it('passes current identity and requested history through the authorized service', async () => {
  mocks.runtime.mockResolvedValue({ service: { read: mocks.read } });
  mocks.read.mockResolvedValueOnce({ id: 'demand' });
  expect(await readStaffingDemand('demand', 2)).toEqual({ id: 'demand' });
  expect(mocks.read).toHaveBeenCalledWith('account', 'demand', 2);
  mocks.read.mockRejectedValueOnce(new DemandAccessError());
  expect(await readStaffingDemand('demand')).toBeNull();
  mocks.read.mockRejectedValueOnce(new Error('database failed'));
  await expect(readStaffingDemand('demand')).rejects.toThrow('database failed');
  expect(await readStaffingDemand('', 2)).toBeNull();
  expect(await readStaffingDemand('demand', -1)).toBeNull();
});
