import { isDeepStrictEqual } from 'node:util';
import { and, eq, sql } from 'drizzle-orm';
import {
  recordBatchDraftSetSchema,
  type RecordBatchDraftSet,
} from '../../../../contracts/record';
import type { Transaction } from '../../../db/client';
import { mediaRecordOriginalInputSchema } from '../arrange/input-state/original-input';
import { RecordWriteError, storeTrustedRecordDraftBatch } from '../write';
import { recordDraftBatches, recordDrafts } from './schema';

/** A file generation is independent of the parent batch's current revision.
 * Append only: even a confirmed or withdrawn old draft remains byte-for-byte
 * unchanged. The caller owns current source/review and job-claim authority. */
export function combineAppendedDrafts(
  current: RecordBatchDraftSet,
  addition: RecordBatchDraftSet,
): RecordBatchDraftSet {
  const before = recordBatchDraftSetSchema.parse(current);
  const incoming = recordBatchDraftSetSchema.parse(addition);
  if (
    before.batchId !== incoming.batchId ||
    incoming.drafts.some(
      (draft) =>
        draft.revision !== 1 ||
        before.drafts.some((old) => old.draftId === draft.draftId),
    )
  )
    throw new RecordWriteError('conflict', 'append_draft_identity_changed');
  const combined = recordBatchDraftSetSchema.safeParse({
    batchId: before.batchId,
    revision: before.revision + 1,
    drafts: [...before.drafts, ...incoming.drafts],
    duplicateCandidates: [
      ...before.duplicateCandidates,
      ...incoming.duplicateCandidates,
    ],
  });
  if (!combined.success)
    throw new RecordWriteError('conflict', 'append_draft_set_invalid');
  // Validation must not normalize any prior human-touched snapshot.
  return {
    ...combined.data,
    drafts: [...structuredClone(current.drafts), ...incoming.drafts],
    duplicateCandidates: [
      ...structuredClone(current.duplicateCandidates),
      ...incoming.duplicateCandidates,
    ],
  };
}

export async function appendTrustedRecordDraftBatch(
  tx: Transaction,
  value: Parameters<typeof storeTrustedRecordDraftBatch>[1],
): Promise<RecordBatchDraftSet> {
  const incoming = recordBatchDraftSetSchema.parse(value.draftSet);
  // This path must never turn a text regeneration into an append operation.
  const originalInput = mediaRecordOriginalInputSchema.parse(
    value.originalInput,
  );
  if (incoming.drafts.some((draft) => draft.revision !== 1))
    throw new RecordWriteError('conflict', 'append_requires_new_drafts');
  // There is no parent row to lock for the first file. A batch-local advisory
  // lock serializes that creation; existing rows then use save/undo's same
  // batch -> ordered draft lock order. No lock is held during model dispatch.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['record-media-append', incoming.batchId])}, 0))`,
  );
  const [batch] = await tx
    .select()
    .from(recordDraftBatches)
    .where(eq(recordDraftBatches.batchId, incoming.batchId))
    .for('update');
  if (!batch) {
    await storeTrustedRecordDraftBatch(tx, { ...value, originalInput });
    return incoming;
  }
  if (
    batch.createdByAccountId !== value.createdByAccountId ||
    batch.occurredOn !== value.occurredOn ||
    batch.modelVersion !== value.modelVersion ||
    !isDeepStrictEqual(batch.originalInput, originalInput)
  )
    throw new RecordWriteError('conflict', 'append_batch_binding_changed');
  const rows = await tx
    .select()
    .from(recordDrafts)
    .where(eq(recordDrafts.batchId, batch.batchId))
    .orderBy(recordDrafts.draftId)
    .for('update');
  if (
    rows.some(
      (row) =>
        row.draftId !== row.draft.draftId ||
        row.batchId !== row.draft.batchId ||
        row.revision !== row.draft.revision,
    )
  )
    throw new RecordWriteError('conflict', 'append_current_drafts_invalid');
  const combined = combineAppendedDrafts(
    {
      batchId: batch.batchId,
      revision: batch.revision,
      duplicateCandidates: batch.duplicateCandidates,
      drafts: rows.map((row) => row.draft),
    },
    incoming,
  );
  // Insert only. In particular, recordSaves, recordDraftEvents, old recordDrafts
  // and their revisions are not updated even when they have human history.
  await tx.insert(recordDrafts).values(
    incoming.drafts.map((draft) => ({
      draftId: draft.draftId,
      batchId: draft.batchId,
      revision: draft.revision,
      draft,
    })),
  );
  const changed = await tx
    .update(recordDraftBatches)
    .set({
      revision: combined.revision,
      duplicateCandidates: combined.duplicateCandidates,
    })
    .where(
      and(
        eq(recordDraftBatches.batchId, batch.batchId),
        eq(recordDraftBatches.revision, batch.revision),
      ),
    )
    .returning({ id: recordDraftBatches.batchId });
  if (changed.length !== 1)
    throw new RecordWriteError('conflict', 'append_batch_revision_changed');
  return combined;
}
