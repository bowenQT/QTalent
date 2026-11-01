import {
  confirmStaffingDemandAction,
  createStaffingDemandAction,
  editStaffingDemandAction,
} from '@/server/actions/staffing-demand';
import {
  judgeStaffingMatchAction,
  openStaffingMatchAction,
  readStaffingMatchAction,
  readStaffingSourceAction,
} from '@/server/actions/staffing-match';
import {
  staffingDemandJobSnapshotSchema,
  staffingJobSnapshotSchema,
  type StaffingDemandJobSnapshot,
} from '@/contracts/staffing';
import { JobReadError, readJobSnapshot } from '@/lib/job-subscription';
import type { StaffingPorts } from './ports';

/** A matching refusal, as the job subscription and the page tell them apart. */
const refusal = { forbidden: 403, not_found: 404, conflict: 409 } as const;

/**
 * The page's ports on the real server: the demand card (BOW-852) through its Server
 * Actions and the shared job read; candidate matching (BOW-854) and cited sources
 * through `staffing-match` actions. Until matching is composed on the server those
 * answer `not_connected`: `openMatching` gives null and the page says matching is not
 * connected, so it never reads a run or saves a judgment.
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
    async openMatching(demand) {
      const result = await openStaffingMatchAction(demand);
      if (result.status === 'success') return result.jobId;
      if (result.status === 'not_connected') return null;
      throw new JobReadError(
        result.status === 'validation_error' ? 400 : refusal[result.status],
      );
    },
    async readMatchingJob(jobId, signal) {
      const result = await readStaffingMatchAction(jobId);
      signal.throwIfAborted();
      if (result.status === 'success')
        return staffingJobSnapshotSchema.parse(result.snapshot);
      // Not connected cannot happen for a run the page opened; treat it as gone.
      throw new JobReadError(
        result.status === 'not_connected' ? 404 : refusal[result.status],
      );
    },
    async judge(runId, input) {
      const result = await judgeStaffingMatchAction(runId, input);
      return result.status === 'not_connected'
        ? { status: 'not_found', message: '人工判断待接通', input }
        : result;
    },
    loadSource: (input) => readStaffingSourceAction(input),
  };
}
