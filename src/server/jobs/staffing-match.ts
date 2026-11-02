import { z } from 'zod';
import type { PgBoss } from 'pg-boss';
import {
  staffingPageSchema,
  type StaffingPage,
} from '../../contracts/staffing';
import type { JobPolicy } from './service';
import type { JobRecord } from './state';
import {
  MatchingError,
  type MatchRun,
} from '../modules/staffing/matching/types';

export const staffingMatchQueue = 'staffing-match';
const payloadSchema = z.strictObject({
  jobId: z.string().min(1),
  attempt: z.number().int().positive(),
});
export async function runStaffingMatch(
  execute: (runId: string, attempt: number) => Promise<void>,
  payload: unknown,
) {
  const input = payloadSchema.parse(payload);
  await execute(input.jobId, input.attempt);
}
export async function registerStaffingMatch(
  boss: PgBoss,
  execute: (runId: string, attempt: number) => Promise<void>,
) {
  await boss.createQueue(staffingMatchQueue);
  await boss.work(staffingMatchQueue, async (jobs) => {
    for (const job of jobs) await runStaffingMatch(execute, job.data);
  });
}
export function staffingMatchJobPolicy<C>(ports: {
  loadRun(context: C, jobId: string): Promise<MatchRun | null>;
  project(accountId: string, run: MatchRun): Promise<StaffingPage>;
  enqueue(context: C, job: JobRecord): Promise<void>;
}): JobPolicy<C> {
  async function project(context: C, accountId: string, job: JobRecord) {
    if (job.kind !== 'staffing_match' || job.resourceId !== job.jobId)
      return null;
    const run = await ports.loadRun(context, job.jobId);
    if (!run || run.id !== job.jobId || run.inputVersion !== job.inputVersion)
      return null;
    try {
      return staffingPageSchema.parse(await ports.project(accountId, run));
    } catch (error) {
      if (error instanceof MatchingError) return null;
      throw error;
    }
  }
  return {
    kind: 'staffing_match',
    resultSchema: staffingPageSchema,
    can: async (context, accountId, job, action) =>
      ['read', 'cancel'].includes(action) &&
      (await project(context, accountId, job)) !== null,
    project: async (context, accountId, job) => {
      const page = await project(context, accountId, job);
      return {
        result: page,
        progress:
          page === null
            ? null
            : {
                completed: page.candidates
                  .flatMap((candidate) => candidate.requirements)
                  .filter((match) => match.progress === 'completed').length,
                total: page.candidates.length * page.demand.requirements.length,
              },
      };
    },
    inputVersion: async () => null,
    canResume: async () => false,
    enqueue: async (context, job, action) => {
      if (action !== 'cancel')
        throw new Error(
          'Only cancellation wake-up is supported; new model work requires an explicit match run',
        );
      await ports.enqueue(context, job);
    },
  };
}
