import { z } from 'zod';
import type { PgBoss } from 'pg-boss';
import type { Database } from '../db/client';
import { createJobStore } from './repository';
import { advanceJob } from './state';
import { exampleResultSchema } from './progress-example';
export const progressExampleQueue = 'progress-example';
const payloadSchema = z
  .object({ jobId: z.string().min(1), attempt: z.number().int().positive() })
  .strict();
/** Synthetic deterministic work only. Repeated deliveries have no external/business side effects. */
export async function runProgressExample(
  db: Database,
  payload: unknown,
  now = () => new Date().toISOString(),
) {
  const input = payloadSchema.parse(payload);
  const store = createJobStore(db);
  // Each phase is durable and separately observable; the same row lock fences cancellation.
  for (const phase of ['running', 'partial', 'completed'] as const) {
    const proceed = await store.locked(input.jobId, async (tx) => {
      const current = tx.record;
      if (
        !current ||
        current.kind !== 'test-job' ||
        current.attempt !== input.attempt ||
        ['completed', 'cancelled'].includes(current.status)
      )
        return false;
      if (current.cancelRequestedAt !== null) {
        await tx.save(
          advanceJob(
            current,
            {
              status: 'cancelled',
              attempt: input.attempt,
              expectedRevision: current.revision,
            },
            now(),
          ),
        );
        return false;
      }
      if (['failed', 'awaiting_manual'].includes(current.status)) return false;
      if (phase === 'running' && current.status !== 'queued') return true;
      const result =
        phase === 'running'
          ? undefined
          : exampleResultSchema.parse({
              units: [{ id: 'synthetic-unit', label: '演示单元已处理' }],
            });
      await tx.save(
        advanceJob(
          current,
          {
            status: phase,
            attempt: input.attempt,
            expectedRevision: current.revision,
            result,
          },
          now(),
        ),
      );
      return true;
    });
    if (!proceed) return;
  }
}
export async function registerProgressExample(boss: PgBoss, db: Database) {
  await boss.createQueue(progressExampleQueue);
  await boss.work(progressExampleQueue, async (jobs) => {
    for (const job of jobs) await runProgressExample(db, job.data);
  });
}
