import type { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import type { Database, Transaction } from '../db/client';
import { jobSnapshots, jobOperations } from './schema';
import { advanceJob, type JobRecord, type JobUpdate } from './state';
import type { JobStore } from './service';
function normalized(row: typeof jobSnapshots.$inferSelect): JobRecord {
  return {
    ...row,
    result: row.result ?? null,
    updatedAt: new Date(row.updatedAt).toISOString(),
    cancelRequestedAt:
      row.cancelRequestedAt === null
        ? null
        : new Date(row.cancelRequestedAt).toISOString(),
  };
}
/** Reads on the caller's transaction; locking uses the same job-first order as workers. */
export async function readJobInTransaction(
  tx: Transaction,
  jobId: string,
  lock = false,
): Promise<JobRecord | null> {
  const query = tx
    .select()
    .from(jobSnapshots)
    .where(eq(jobSnapshots.jobId, jobId));
  const [row] = lock ? await query.for('update') : await query;
  return row ? normalized(row) : null;
}
export function createJobStore(db: Database): JobStore<Transaction> {
  return {
    locked: (jobId, run) =>
      db.transaction(async (context) => {
        const record = await readJobInTransaction(context, jobId, true);
        return run({
          context,
          record,
          save: async (record) => {
            await context
              .update(jobSnapshots)
              .set(record)
              .where(eq(jobSnapshots.jobId, jobId));
          },
          operation: async (accountId, operationId) => {
            const [entry] = await context
              .select()
              .from(jobOperations)
              .where(
                and(
                  eq(jobOperations.jobId, jobId),
                  eq(jobOperations.accountId, accountId),
                  eq(jobOperations.operationId, operationId),
                ),
              );
            return entry
              ? { fingerprint: entry.fingerprint, record: entry.record }
              : null;
          },
          saveOperation: async (accountId, operationId, operation) => {
            await context
              .insert(jobOperations)
              .values({ jobId, accountId, operationId, ...operation });
          },
        });
      }),
  };
}
export async function insertJob(tx: Transaction, record: JobRecord) {
  await tx.insert(jobSnapshots).values(record);
}
/** The business write executes only after the attempt/revision/cancel fence and inside the same transaction. */
export async function commitJobUpdate(
  db: Database,
  jobId: string,
  update: JobUpdate,
  now: string,
  resultSchema: z.ZodType,
  commitBusiness?: (tx: Transaction) => Promise<void>,
): Promise<JobRecord | null> {
  return createJobStore(db).locked(jobId, async (tx) => {
    if (!tx.record) return null;
    const validated =
      update.result === undefined
        ? update
        : { ...update, result: resultSchema.parse(update.result) };
    const next = advanceJob(tx.record, validated, now);
    if (update.status !== 'cancelled') await commitBusiness?.(tx.context);
    await tx.save(next);
    return next;
  });
}
