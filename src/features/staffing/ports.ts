import type { z } from 'zod';
import type {
  confirmStaffingDemandInputSchema,
  createStaffingDemandInputSchema,
  editStaffingDemandInputSchema,
  HumanStaffingJudgmentInput,
  StaffingCreateDemandResult,
  StaffingDemandJobSnapshot,
  StaffingJobSnapshot,
  staffingDemandResultSchema,
  staffingJudgmentResultSchema,
} from '@/contracts/staffing';
import type { LoadSource } from '@/features/sources/SourceCite';

export type StaffingDemandResult = z.infer<typeof staffingDemandResultSchema>;
export type StaffingJudgmentResult = z.infer<
  typeof staffingJudgmentResultSchema
>;

/**
 * Everything the page does on the server. The route passes Server Actions and job reads
 * down; the client never imports server code. Inputs and results are the staffing
 * contract's, except where noted.
 */
export type StaffingPorts = {
  /** The page binds the project; the sentence alone comes from here. */
  createDemand(
    input: Omit<z.infer<typeof createStaffingDemandInputSchema>, 'projectId'>,
  ): Promise<StaffingCreateDemandResult>;
  readDemandJob(
    jobId: string,
    signal: AbortSignal,
  ): Promise<StaffingDemandJobSnapshot>;
  editDemand(
    input: z.infer<typeof editStaffingDemandInputSchema>,
  ): Promise<StaffingDemandResult>;
  confirmDemand(
    input: z.infer<typeof confirmStaffingDemandInputSchema>,
  ): Promise<StaffingDemandResult>;
  /**
   * The matching run for a confirmed demand revision, started once and replayed after
   * that. Not in the contract: returns the run (job) id, or null while matching is not
   * connected; a refusal rejects with a `JobReadError` carrying 403, 404 or 409.
   */
  openMatching(demand: {
    demandId: string;
    revision: number;
  }): Promise<string | null>;
  readMatchingJob(
    jobId: string,
    signal: AbortSignal,
  ): Promise<StaffingJobSnapshot>;
  /** Saved on the matching run (job) the judgment was made in. */
  judge(
    runId: string,
    input: HumanStaffingJudgmentInput,
  ): Promise<StaffingJudgmentResult>;
  loadSource: LoadSource;
};
