import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { Transaction } from '../../../db/client';
import { jobSnapshots } from '../../../jobs/schema';
import { arrangeInputs } from '../arrange/input-state/schema';
import { readUploadCollectionMembers } from '../uploads/store';
import { validatedUploadFromFacts } from '../uploads/handoff';
import { uploadObjects } from '../uploads/schema';
import { originalVersions, fragments } from '../schema';
import { auditEvents } from '../../../platform/audit/schema';
import {
  mediaMaterials,
  mediaReviewItems,
  mediaReviewOperations,
  mediaReviewDraftDependencies,
} from './schema';

/** Internal facts, NOT a processing grant or a DTO. Start with no job/material
 * row locks. Lock order: collection quota -> job -> input -> material -> ordered
 * items -> ordered operations. Retain the caller's Read Committed transaction
 * through authorization and writes. Never hold it across an external request.
 * The hint locates locks only; every identity is rechecked after waiting.
 */
export async function readMediaReviewStateInTransaction(
  tx: Transaction,
  materialId: string,
) {
  const { rows } = await tx.execute<{ isolation: string }>(
    sql`select current_setting('transaction_isolation') as isolation`,
  );
  if (rows[0]?.isolation !== 'read committed')
    throw new Error('media_read_committed_required');
  const [hint] = await tx
    .select({ material: mediaMaterials, jobId: arrangeInputs.jobId })
    .from(mediaMaterials)
    .innerJoin(arrangeInputs, eq(arrangeInputs.id, mediaMaterials.inputId))
    .where(eq(mediaMaterials.id, materialId));
  if (!hint) return null;
  const collection = await readUploadCollectionMembers(
    tx,
    hint.material.recordCollectionId,
  );
  if (!collection) return null;
  const [job] = await tx
    .select()
    .from(jobSnapshots)
    .where(eq(jobSnapshots.jobId, hint.jobId))
    .for('update');
  const [input] = await tx
    .select()
    .from(arrangeInputs)
    .where(eq(arrangeInputs.id, hint.material.inputId))
    .for('update');
  const [material] = await tx
    .select()
    .from(mediaMaterials)
    .where(eq(mediaMaterials.id, materialId))
    .for('update');
  if (
    !job ||
    !input ||
    !material ||
    material.inputId !== input.id ||
    material.inputVersion !== input.inputVersion ||
    material.recordCollectionId !== collection.recordCollectionId ||
    material.uploadId !== hint.material.uploadId ||
    material.originalVersionId !== hint.material.originalVersionId ||
    input.jobId !== job.jobId ||
    job.resourceId !== input.id ||
    job.inputVersion !== input.inputVersion ||
    job.kind !== 'record_organize'
  )
    return null;
  // Read again after ALL waits, including waiting for the job or material row.
  // Quota ownership prevents release/completion until this transaction ends.
  const currentCollection = await readUploadCollectionMembers(
    tx,
    material.recordCollectionId,
  );
  if (!currentCollection) return null;
  const member = currentCollection.members.find(
    (row) => row.intent.id === material.uploadId,
  );
  if (!member) return null;
  // These parent locks also fence insertion of a new material/canonical fragment
  // referring to this exact original while its complete initial scope is read.
  const [version] = await tx
    .select()
    .from(originalVersions)
    .where(eq(originalVersions.id, material.originalVersionId))
    .for('update');
  await tx
    .select()
    .from(uploadObjects)
    .where(eq(uploadObjects.originalVersionId, material.originalVersionId))
    .for('update');
  const originalMaterials = await tx
    .select()
    .from(mediaMaterials)
    .where(eq(mediaMaterials.originalVersionId, material.originalVersionId))
    .orderBy(asc(mediaMaterials.id))
    .for('share');
  const batchMaterials = await tx
    .select()
    .from(mediaMaterials)
    .where(eq(mediaMaterials.inputId, input.id))
    .orderBy(asc(mediaMaterials.id));
  const canonicalFragments = await tx
    .select()
    .from(fragments)
    .where(eq(fragments.originalVersionId, material.originalVersionId));
  const upload = validatedUploadFromFacts(member.intent, member.object, {
    uploadId: material.uploadId,
    originalVersionId: material.originalVersionId,
  });
  const items = await tx
    .select()
    .from(mediaReviewItems)
    .where(eq(mediaReviewItems.materialId, material.id))
    .orderBy(asc(mediaReviewItems.id))
    .for('update');
  const operations = await tx
    .select()
    .from(mediaReviewOperations)
    .where(eq(mediaReviewOperations.materialId, material.id))
    .orderBy(asc(mediaReviewOperations.id))
    .for('update');
  const dependencies = operations.length
    ? await tx
        .select()
        .from(mediaReviewDraftDependencies)
        .where(
          inArray(
            mediaReviewDraftDependencies.operationId,
            operations.map((row) => row.id),
          ),
        )
        .orderBy(
          asc(mediaReviewDraftDependencies.operationId),
          asc(mediaReviewDraftDependencies.itemId),
          asc(mediaReviewDraftDependencies.draftId),
          asc(mediaReviewDraftDependencies.draftRevision),
        )
    : [];
  const auditIds = [
    ...new Set([
      ...originalMaterials.flatMap((row) =>
        row.scopeAuditId ? [row.scopeAuditId] : [],
      ),
      ...operations.map((row) => row.auditId),
    ]),
  ];
  const audits = auditIds.length
    ? await tx
        .select()
        .from(auditEvents)
        .where(inArray(auditEvents.id, auditIds))
    : [];
  // Historical/released facts remain present; availability cannot be inferred
  // from a non-null upload or from pending-task counts.
  const availability =
    input.supersededByInputId !== null
      ? ('superseded' as const)
      : job.cancelRequestedAt !== null || job.status === 'cancelled'
        ? ('cancelled' as const)
        : member.intent.releasedAt !== null
          ? ('released' as const)
          : upload === null
            ? ('unvalidated' as const)
            : ('current' as const);
  return {
    material,
    input,
    job,
    collection: currentCollection,
    member,
    upload,
    items,
    operations,
    dependencies,
    availability,
    version,
    originalMaterials,
    batchMaterials,
    canonicalFragments,
    audits,
  };
}

export type MediaReviewState = NonNullable<
  Awaited<ReturnType<typeof readMediaReviewStateInTransaction>>
>;
