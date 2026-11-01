import { fromDrizzle, type PgBoss } from 'pg-boss';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  registerRecordArrangeJob,
  recordArrangeQueue,
} from '../jobs/record-arrange';
import type { ModelinkMaasClient } from '../integrations/maas';
import {
  createRecordBatchArrange,
  type BatchArrangeRequest,
} from './record-batch-arrange';
import { createRecordBatchArrangeRequests } from './record-batch-arrange-requests';
import {
  parseBatchMetadata,
  updateBatchJob,
} from './record-batch-arrange-state';
import {
  requireNativeInput,
  NativeArrangeUnavailable,
} from './record-arrange-context';

/** Actual batch producer, native842 row locks, and846 initial writer composition.
 * Caller supplies an explicit Modelink client configured with maxAttempts:1.
 * X1 owns the shared worker/registry and the single pg-boss producer lifecycle. */
export function createRecordArrangeApplication(input: {
  db: Database;
  boss: PgBoss;
  client: ModelinkMaasClient;
  businessNow(): string;
  now(): Date;
  newId?(): string;
}) {
  const requests = createRecordBatchArrangeRequests({
    ...input,
    enqueue: async (tx, job) => {
      const sent = await input.boss.send(
        recordArrangeQueue,
        { jobId: job.jobId, attempt: job.attempt },
        { db: fromDrizzle(tx, sql), retryLimit: 0 },
      );
      if (!sent)
        throw new Error('Record arrangement enqueue was not committed');
    },
  });
  const arrange = createRecordBatchArrange(requests.native.ports, input.client);
  async function markFailed(
    jobId: string,
    attempt: number,
    inputChanged: boolean,
  ) {
    return requests.native.store.locked(jobId, async (locked) => {
      const job = locked.record;
      const metadata = job && parseBatchMetadata(job.result);
      if (
        !job ||
        !metadata ||
        job.attempt !== attempt ||
        !['queued', 'running', 'partial'].includes(job.status)
      )
        return job?.status ?? 'ignored';
      const next = updateBatchJob(
        job,
        job.cancelRequestedAt ? 'cancelled' : 'failed',
        {
          ...metadata,
          failure: inputChanged
            ? { kind: 'input_changed', retryable: false }
            : null,
        },
        input.now().toISOString(),
      );
      await locked.save(next);
      return next.status;
    });
  }
  const runner = {
    async run(
      jobId: string,
      attempt: number,
      signal?: AbortSignal,
    ): Promise<string> {
      let request: BatchArrangeRequest | null;
      try {
        request = await requests.native.store.locked(jobId, async (locked) => {
          const job = locked.record;
          const metadata = job && parseBatchMetadata(job.result);
          if (
            !job ||
            !metadata ||
            job.kind !== 'record_organize' ||
            job.attempt !== attempt
          )
            return null;
          const row = await requests.native.inputForJob(locked.context, job);
          if (!row || row.supersededByInputId !== null) return null;
          const native = requireNativeInput(row);
          return {
            accountId: row.creatorAccountId,
            batchId: native.batchId,
            operationId: metadata.operationId,
            attempt,
          };
        });
        if (!request) return 'ignored';
        const outcome = await arrange(request, signal);
        if (['not_ready', 'not_found'].includes(outcome.status))
          return markFailed(jobId, attempt, true);
        if (outcome.status === 'ignored') return 'ignored';
        return requests.native.store.locked(
          jobId,
          async (locked) => locked.record?.status ?? 'ignored',
        );
      } catch (error) {
        // No queue/model retry. A failed final write rolls back its draft rows;
        // mark the unique job failed in a separate transaction without claiming
        // the vendor was not sent. An already committed terminal job is retained.
        return markFailed(
          jobId,
          attempt,
          error instanceof NativeArrangeUnavailable,
        );
      }
    },
  };
  return {
    requests,
    policy: requests.policy,
    runner,
    register: () => registerRecordArrangeJob(input.boss, runner),
  };
}
