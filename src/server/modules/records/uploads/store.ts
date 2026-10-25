import { and, count, eq, gt, isNotNull, or, sql } from 'drizzle-orm';
import type { Database, DbExecutor } from '../../../db/client';
import { originals, originalVersions } from '../schema';
import { uploadIntents, uploadObjects, uploadReadTickets } from './schema';
import {
  UploadError,
  type UploadIntent,
  type UploadStore,
  type UploadTransaction,
} from './types';

export type UploadDispatch = (
  tx: DbExecutor,
  input: {
    purpose: UploadIntent['request']['purpose'];
    uploadId: string;
    originalId: string;
    originalVersionId: string;
    accountId: string;
    quotaScope: string;
    target: UploadIntent['request']['target'];
  },
) => Promise<{ jobId: string }>;

/** dispatch MUST persist a real 859/866 job with this same executor. No detached
 * enqueue, singleton producer, or fabricated queued result is provided here.
 */
export function createPostgresUploadStore(
  db: Database,
  dispatch: UploadDispatch,
): UploadStore {
  return {
    transaction(locks, work) {
      return db.transaction(async (executor) => {
        for (const key of [...new Set(locks)].sort())
          await executor.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
          );
        const tx: UploadTransaction = {
          executor,
          async findOperation(accountId, operationId) {
            const [row] = await executor
              .select()
              .from(uploadIntents)
              .where(
                and(
                  eq(uploadIntents.accountId, accountId),
                  eq(uploadIntents.operationId, operationId),
                ),
              );
            return row ?? null;
          },
          async findIntent(id) {
            const [row] = await executor
              .select()
              .from(uploadIntents)
              .where(eq(uploadIntents.id, id));
            return row ?? null;
          },
          async activeCount(scope, now) {
            const [row] = await executor
              .select({ count: count() })
              .from(uploadIntents)
              .where(
                and(
                  eq(uploadIntents.quotaScope, scope),
                  or(
                    isNotNull(uploadIntents.completed),
                    gt(uploadIntents.expiresAt, now),
                  ),
                ),
              );
            return row.count;
          },
          async insertIntent(intent) {
            await executor
              .insert(uploadIntents)
              .values({
                ...intent,
                declaredBytes: intent.request.declaredBytes,
              });
          },
          async archiveAndDispatch(intent, object, ids) {
            await executor
              .insert(originals)
              .values({
                id: ids.originalId,
                title: intent.request.filename,
                kind: 'original',
              });
            await executor
              .insert(originalVersions)
              .values({
                id: ids.originalVersionId,
                originalId: ids.originalId,
                version: 1,
                contentDigest: object.sha256,
              });
            await executor
              .insert(uploadObjects)
              .values({
                ...object,
                uploadId: intent.id,
                originalVersionId: ids.originalVersionId,
              });
            const { jobId } = await dispatch(executor, {
              ...ids,
              uploadId: intent.id,
              purpose: intent.request.purpose,
              accountId: intent.accountId,
              quotaScope: intent.quotaScope,
              target: intent.request.target,
            });
            if (!jobId.trim())
              throw new UploadError('unavailable', 'dispatch_missing_job');
            return jobId;
          },
          async saveCompletion(intent) {
            const rows = await executor
              .update(uploadIntents)
              .set({
                revision: intent.revision,
                completed: intent.completed,
                completionOperationId: intent.completionOperationId,
                completionFingerprint: intent.completionFingerprint,
              })
              .where(
                and(
                  eq(uploadIntents.id, intent.id),
                  eq(uploadIntents.revision, intent.revision - 1),
                ),
              )
              .returning({ id: uploadIntents.id });
            if (rows.length !== 1)
              throw new UploadError('conflict', 'upload_changed');
          },
          async findObject(version) {
            const [row] = await executor
              .select()
              .from(uploadObjects)
              .where(eq(uploadObjects.originalVersionId, version));
            return row ?? null;
          },
          async insertTicket(ticket) {
            await executor.insert(uploadReadTickets).values(ticket);
          },
          async findTicket(digest) {
            const [row] = await executor
              .select()
              .from(uploadReadTickets)
              .where(eq(uploadReadTickets.digest, digest));
            return row ?? null;
          },
        };
        return work(tx);
      });
    },
  };
}
