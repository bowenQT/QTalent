import {
  confirmStaffingDemandAction,
  createStaffingDemandAction,
  editStaffingDemandAction,
} from '@/server/actions/staffing-demand';
import {
  staffingDemandJobSnapshotSchema,
  staffingJobSnapshotSchema,
  type StaffingDemandJobSnapshot,
  type StaffingJobSnapshot,
} from '@/contracts/staffing';
import { readJobSnapshot } from '@/lib/job-subscription';
import type { StaffingPorts } from './ports';

/**
 * The page's ports on the real server: the demand card (BOW-852) through its Server
 * Actions and the shared job read. Matching (BOW-854) is not on main: `openMatching`
 * answers null, so the page shows matching as not connected and never reaches the
 * judgment or source reads below.
 */
export function livePorts(projectId: string): StaffingPorts {
  return {
    createDemand: (input) =>
      createStaffingDemandAction({ ...input, projectId }),
    // Parsed by exactly this schema; the shared reader only widens the job kind.
    readDemandJob: (jobId, signal) =>
      readJobSnapshot(
        jobId,
        signal,
        staffingDemandJobSnapshotSchema,
      ) as Promise<StaffingDemandJobSnapshot>,
    editDemand: (input) => editStaffingDemandAction(input),
    confirmDemand: (input) => confirmStaffingDemandAction(input),
    openMatching: async () => null,
    readMatchingJob: (jobId, signal) =>
      readJobSnapshot(
        jobId,
        signal,
        staffingJobSnapshotSchema,
      ) as Promise<StaffingJobSnapshot>,
    judge: async (input) => ({
      status: 'not_found',
      message: '人工判断待接通',
      input,
    }),
    loadSource: async () => ({
      status: 'not_found',
      message: '来源读取待接通',
    }),
  };
}
