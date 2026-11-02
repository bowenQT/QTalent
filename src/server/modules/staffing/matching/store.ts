import { and, eq, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../../db/client';
import { jobSnapshots } from '../../../jobs/schema';
import type { JobRecord } from '../../../jobs/state';
import { matchRuns, matchOperations } from './schema';
import { matchRunSchema, matchOperationSchema } from './storage';
import type { MatchRun, MatchStore } from './types';

export async function loadMatchRun(
  tx: Transaction,
  runId: string,
): Promise<MatchRun | null> {
  const [row] = await tx
    .select()
    .from(matchRuns)
    .where(eq(matchRuns.id, runId));
  return row ? matchRunSchema.parse(row.payload) : null;
}
export function createPostgresMatchStore(
  db: Database,
  enqueue: (tx: Transaction, job: JobRecord) => Promise<void>,
): MatchStore<Transaction> {
  return {
    transaction: (key, work) =>
      db.transaction(async (context) => {
        await context.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${'staffing-match:' + key},0))`,
        );
        return work({
          context,
          load: async (runId) => {
            // Match the shared job service lock order to avoid job↔run deadlocks.
            const [job] = await context
              .select()
              .from(jobSnapshots)
              .where(eq(jobSnapshots.jobId, runId))
              .for('update');
            const [row] = await context
              .select()
              .from(matchRuns)
              .where(eq(matchRuns.id, runId))
              .for('update');
            if (!row || !job) return null;
            return {
              run: matchRunSchema.parse(row.payload),
              job: {
                ...job,
                result: job.result ?? null,
                updatedAt: new Date(job.updatedAt).toISOString(),
                cancelRequestedAt:
                  job.cancelRequestedAt === null
                    ? null
                    : new Date(job.cancelRequestedAt).toISOString(),
              },
            };
          },
          insert: async (run, job) => {
            const payload = matchRunSchema.parse(run);
            await context.insert(jobSnapshots).values(job);
            await context.insert(matchRuns).values({
              id: run.id,
              demandId: run.demand.id,
              demandRevision: run.demand.revision,
              initiatorAccountId: run.initiatorAccountId,
              createdAt: run.createdAt,
              payload,
            });
          },
          save: async (run, job) => {
            await context
              .update(matchRuns)
              .set({ payload: matchRunSchema.parse(run) })
              .where(eq(matchRuns.id, run.id));
            await context
              .update(jobSnapshots)
              .set(job)
              .where(eq(jobSnapshots.jobId, run.id));
          },
          operation: async (accountId, operationId) => {
            const [row] = await context
              .select()
              .from(matchOperations)
              .where(
                and(
                  eq(matchOperations.accountId, accountId),
                  eq(matchOperations.operationId, operationId),
                ),
              );
            return row ? matchOperationSchema.parse(row.payload) : null;
          },
          saveOperation: async (accountId, operationId, value) => {
            await context.insert(matchOperations).values({
              accountId,
              operationId,
              runId: value.runId,
              payload: matchOperationSchema.parse(value),
            });
          },
          enqueue: (job) => enqueue(context, job),
        });
      }),
  };
}
