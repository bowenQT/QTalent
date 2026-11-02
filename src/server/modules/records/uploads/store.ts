import {
  and,
  asc,
  count,
  eq,
  gt,
  isNotNull,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import type { Database, DbExecutor, Transaction } from '../../../db/client';
import { originals, originalVersions } from '../schema';
import {
  uploadCollections,
  uploadIntents,
  uploadObjects,
  uploadReadTickets,
} from './schema';
import {
  UploadError,
  type UploadIntent,
  type UploadCollectionMembers,
  type UploadStore,
  type UploadTransaction,
} from './types';
import { hasExplicitCollectionIdentity } from './collection-identity';

export type UploadDispatch = (
  tx: DbExecutor,
  input: {
    purpose: UploadIntent['request']['purpose'];
    uploadId: string;
    recordCollectionId: string;
    originalId: string;
    originalVersionId: string;
    accountId: string;
    quotaScope: string;
    target: UploadIntent['request']['target'];
  },
) => Promise<{ jobId: string }>;

/** 846 calls this in its existing save/undo transaction BEFORE checking upload
 * membership and writing its ledger. Release/grant use the identical lock key.
 */
export async function lockUploadCollection(
  tx: Transaction,
  recordCollectionId: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`quota:${recordCollectionId}`}, 0))`,
  );
}

/** Native transaction fact reader for 846/859. The caller must use Read
 * Committed and retain this transaction through its own current-authority,
 * binding, and state checks and writes. A returned fact never grants permission.
 * No pagination or lifecycle/account filter: released/expired intents are facts
 * too, and a complete collection can contain more than ten historical members.
 */
export async function readUploadCollectionMembers(
  tx: Transaction,
  recordCollectionId: string,
): Promise<UploadCollectionMembers | null> {
  if (!recordCollectionId.trim())
    throw new UploadError('unavailable', 'record_collection_unresolved');
  const { rows } = await tx.execute<{ isolation: string }>(
    sql`select current_setting('transaction_isolation') as isolation`,
  );
  if (rows[0]?.isolation !== 'read committed')
    throw new UploadError('unavailable', 'upload_read_committed_required');
  await lockUploadCollection(tx, recordCollectionId);
  const [collection] = await tx
    .select()
    .from(uploadCollections)
    .where(eq(uploadCollections.id, recordCollectionId));
  if (!collection) return null;
  const members = await tx
    .select({ intent: uploadIntents, object: uploadObjects })
    .from(uploadIntents)
    .leftJoin(uploadObjects, eq(uploadObjects.uploadId, uploadIntents.id))
    .where(eq(uploadIntents.recordCollectionId, recordCollectionId))
    .orderBy(asc(uploadIntents.id));
  for (const { intent, object } of members) {
    if (
      !hasExplicitCollectionIdentity(intent) ||
      intent.recordCollectionId !== collection.id ||
      (intent.completed
        ? !object ||
          intent.completed.uploadId !== intent.id ||
          intent.completed.originalVersionId !== object.originalVersionId ||
          typeof intent.completed.originalId !== 'string' ||
          !intent.completed.originalId.trim() ||
          typeof intent.completed.jobId !== 'string' ||
          !intent.completed.jobId.trim()
        : object !== null) ||
      (object !== null &&
        (object.uploadId !== intent.id ||
          object.objectKey !== intent.objectKey ||
          object.byteLength !== intent.request.declaredBytes))
    )
      throw new UploadError('unavailable', 'upload_collection_inconsistent');
  }
  return { recordCollectionId: collection.id, collection, members };
}

export type PostgresUploadStore = UploadStore & {
  /** Standalone facts only. Cross-domain decisions must instead call the native
   * reader within their OWN transaction so the quota lock spans the decision.
   */
  readCollectionMembers(id: string): Promise<UploadCollectionMembers | null>;
};

/** dispatch MUST persist a real 859/866 job with this same executor. No detached
 * enqueue, singleton producer, or fabricated queued result is provided here.
 */
export function createPostgresUploadStore(
  db: Database,
  dispatch: UploadDispatch,
): PostgresUploadStore {
  return {
    readCollectionMembers(id) {
      return db.transaction((tx) => readUploadCollectionMembers(tx, id), {
        isolationLevel: 'read committed',
      });
    },
    transaction(locks, work) {
      return db.transaction(
        async (executor) => {
          for (const key of [...new Set(locks)].sort())
            await executor.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
            );
          const tx: UploadTransaction = {
            executor,
            async findCollection(id) {
              const [row] = await executor
                .select()
                .from(uploadCollections)
                .where(eq(uploadCollections.id, id));
              return row ?? null;
            },
            async findCollectionOperation(accountId, operationId) {
              const [row] = await executor
                .select()
                .from(uploadCollections)
                .where(
                  and(
                    eq(uploadCollections.creatorAccountId, accountId),
                    eq(uploadCollections.operationId, operationId),
                  ),
                );
              return row ?? null;
            },
            async insertCollection(collection) {
              await executor.insert(uploadCollections).values(collection);
            },
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
                    eq(uploadIntents.recordCollectionId, scope),
                    isNull(uploadIntents.releasedAt),
                    or(
                      isNotNull(uploadIntents.completed),
                      gt(uploadIntents.expiresAt, now),
                    ),
                  ),
                );
              return row.count;
            },
            async insertIntent(intent) {
              if (!hasExplicitCollectionIdentity(intent))
                throw new UploadError('conflict', 'record_collection_changed');
              await executor.insert(uploadIntents).values({
                ...intent,
                declaredBytes: intent.request.declaredBytes,
              });
            },
            async archiveAndDispatch(intent, object, ids) {
              if (!hasExplicitCollectionIdentity(intent))
                throw new UploadError('conflict', 'record_collection_changed');
              await executor.insert(originals).values({
                id: ids.originalId,
                title: intent.request.filename,
                kind: 'original',
              });
              await executor.insert(originalVersions).values({
                id: ids.originalVersionId,
                originalId: ids.originalId,
                version: 1,
                contentDigest: object.sha256,
              });
              await executor.insert(uploadObjects).values({
                ...object,
                uploadId: intent.id,
                originalVersionId: ids.originalVersionId,
              });
              const { jobId } = await dispatch(executor, {
                ...ids,
                uploadId: intent.id,
                recordCollectionId: intent.recordCollectionId,
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
            async saveRelease(intent) {
              const rows = await executor
                .update(uploadIntents)
                .set({
                  releasedAt: intent.releasedAt,
                  releaseOperationId: intent.releaseOperationId,
                  releaseFingerprint: intent.releaseFingerprint,
                  revision: intent.revision,
                })
                .where(
                  and(
                    eq(uploadIntents.id, intent.id),
                    eq(uploadIntents.revision, intent.revision - 1),
                    isNull(uploadIntents.releasedAt),
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
        },
        { isolationLevel: 'read committed' },
      );
    },
  };
}
