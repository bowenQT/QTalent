import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import {
  recordArrangeResultSchema,
  recordSelectionRequiredSchema,
} from '../../contracts/record';
import type { JobPolicy } from './service';
import type { JobRecord } from './state';
import {
  prepareArrange,
  arrangeJobResultSchema,
  type ArrangeSnapshot,
} from '../modules/records/arrange';
export const recordArrangeQueue = 'record-arrange';
export interface RecordArrangePolicyDependencies<C> {
  authorize(
    context: C,
    accountId: string,
    job: JobRecord,
    action: 'read' | 'retry' | 'resume' | 'cancel',
  ): Promise<boolean>;
  load(
    context: C,
    resourceId: string,
    accountId: string,
  ): Promise<ArrangeSnapshot | null>;
  currentInputVersion(context: C, resourceId: string): Promise<string | null>;
  enqueue(
    context: C,
    job: JobRecord,
    action: 'retry' | 'resume' | 'cancel',
  ): Promise<void>;
}
export function createRecordArrangePolicy<C>(
  deps: RecordArrangePolicyDependencies<C>,
): JobPolicy<C> {
  async function visible(context: C, accountId: string, job: JobRecord) {
    const snapshot = await deps.load(context, job.resourceId, accountId);
    return snapshot ? prepareArrange(snapshot) : null;
  }
  return {
    kind: 'record_organize',
    resultSchema: recordArrangeResultSchema,
    async can(context, accountId, job, action) {
      if (
        job.kind !== 'record_organize' ||
        action === 'resume' ||
        !(await deps.authorize(context, accountId, job, action))
      )
        return false;
      // A superseded selection is retained as an empty cancelled snapshot.
      // Current control authority is still checked, but its old candidates and
      // original text must never be reconstructed for a historical receipt.
      if (job.status === 'cancelled' && action === 'read') return true;
      const current = await visible(context, accountId, job);
      if (!current || current.status === 'not_found') return false;
      if (action !== 'retry') return true;
      const result = arrangeJobResultSchema.safeParse(job.result);
      return (
        job.status === 'failed' &&
        job.attempt < 2 &&
        result.success &&
        result.data.state === 'failure' &&
        result.data.failure.kind === 'network' &&
        result.data.failure.retryable &&
        result.data.attemptsUsed === job.attempt &&
        result.data.inputVersion === job.inputVersion &&
        current.status === 'ready' &&
        current.snapshot.inputVersion === job.inputVersion
      );
    },
    async project(context, accountId, job) {
      const empty = { result: null, progress: null };
      if (
        job.kind !== 'record_organize' ||
        job.status === 'cancelled' ||
        !(await deps.authorize(context, accountId, job, 'read'))
      )
        return empty;
      if (job.result === null) return empty;
      const result = arrangeJobResultSchema.parse(job.result);
      if (result.state === 'selection_required') {
        const snapshot = await deps.load(context, job.resourceId, accountId);
        if (!snapshot || snapshot.inputVersion !== result.inputVersion)
          return empty;
        const prepared = await prepareArrange(snapshot);
        return prepared.status === 'selection_required'
          ? {
              result: recordSelectionRequiredSchema.parse({
                state: 'selection_required',
                draftId: snapshot.draftId,
                inputVersion: snapshot.inputVersion,
                originalInput: prepared.originalInput,
                people: prepared.people,
                project: prepared.project,
              }),
              progress: null,
            }
          : empty;
      }
      if (result.state !== 'draft') return empty;
      const current = await visible(context, accountId, job);
      return current?.status === 'ready' &&
        current.fingerprint === result.fingerprint
        ? { result: result.draft, progress: null }
        : empty;
    },
    inputVersion: (context, job) =>
      deps.currentInputVersion(context, job.resourceId),
    canResume: async () => false,
    enqueue: (context, job, action) => deps.enqueue(context, job, action),
  };
}
const queuePayloadSchema = z.strictObject({
  jobId: z.string().min(1),
  attempt: z.number().int().min(1).max(2),
});
/** At-least-once delivery still requires the usecase's durable attempt claim. */
export async function registerRecordArrangeJob(
  boss: Pick<PgBoss, 'createQueue' | 'work'>,
  handler: { run(jobId: string, attempt: number): Promise<string> },
): Promise<void> {
  await boss.createQueue(recordArrangeQueue, { retryLimit: 0 });
  await boss.work(recordArrangeQueue, async (jobs) => {
    for (const job of jobs) {
      const payload = queuePayloadSchema.parse(job.data);
      await handler.run(payload.jobId, payload.attempt);
    }
  });
}
