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
   * The matching job for a confirmed demand revision. Not in the contract yet (BOW-854
   * exposes no read): returns the job id, or null while matching is unavailable.
   */
  openMatching(demand: {
    demandId: string;
    revision: number;
  }): Promise<string | null>;
  readMatchingJob(
    jobId: string,
    signal: AbortSignal,
  ): Promise<StaffingJobSnapshot>;
  judge(input: HumanStaffingJudgmentInput): Promise<StaffingJudgmentResult>;
  loadSource: LoadSource;
};
