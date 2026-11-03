import { isDeepStrictEqual } from 'node:util';
import { and, eq, sql } from 'drizzle-orm';
import {
  materialReviewCommandSchema,
  materialReviewItemSchema,
  materialReviewResolutionReceiptSchema,
} from '../../contracts/material-review';
import type { RecordBatchDraft } from '../../contracts/record';
import type { Transaction } from '../db/client';
import { jobSnapshots } from '../jobs/schema';
import {
  parsedAttachmentArrangeKind,
  readAttachmentArrangeMetadata,
} from './parsed-attachment-state';
import {
  mediaMaterials,
  mediaReviewDraftDependencies,
  mediaReviewItems,
  mediaReviewOperations,
} from '../modules/records/material-review/schema';
import { auditEvents } from '../platform/audit/schema';
import { arrangeOperationFingerprint } from '../modules/records/arrange/input-state/bind';

export type MediaDraftDependencyFacts = {
  dependency: typeof mediaReviewDraftDependencies.$inferSelect;
  item: typeof mediaReviewItems.$inferSelect;
  operation: typeof mediaReviewOperations.$inferSelect;
  material: typeof mediaMaterials.$inferSelect;
  audit: typeof auditEvents.$inferSelect;
};

/** A binding authorizes attribution only, not complete source scope. This check
 * makes a retained old draft unusable after undo/rebind; ordinary source and
 * current-permission checks remain the existing confirmation usecase's job. */
export function currentMediaDraftDependency(
  draft: RecordBatchDraft,
  facts: MediaDraftDependencyFacts,
): boolean {
  const { dependency: dep, item, operation: op, material, audit } = facts;
  const command = materialReviewCommandSchema.safeParse(op.command);
  const receipt = materialReviewResolutionReceiptSchema.safeParse(op.receipt);
  const question = materialReviewItemSchema.safeParse(item.question);
  if (
    !question.success ||
    question.data.kind !== 'unknown_person' ||
    question.data.batchId !== draft.batchId ||
    question.data.evaluationNodeId !== draft.evaluationNodeId ||
    question.data.originalVersionId !== material.originalVersionId ||
    question.data.itemId !== item.id ||
    question.data.materialId !== material.id ||
    !command.success ||
    !receipt.success ||
    command.data.kind !== 'unknown_person' ||
    receipt.data.kind !== 'unknown_person' ||
    command.data.resolution.action !== 'bind_people' ||
    receipt.data.resolution.action !== 'bind_people' ||
    op.action !== 'resolve' ||
    op.fingerprint !== arrangeOperationFingerprint(op.command) ||
    op.sourceOperationId !== null ||
    dep.draftId !== draft.draftId ||
    dep.draftRevision > draft.revision ||
    dep.operationId !== op.id ||
    dep.itemId !== item.id ||
    item.currentOperationId !== op.id ||
    item.state !== 'resolved' ||
    item.materialId !== material.id ||
    op.materialId !== material.id ||
    op.itemId !== item.id ||
    item.kind !== 'unknown_person' ||
    command.data.operationId !== op.operationId ||
    command.data.itemId !== item.id ||
    command.data.batchId !== draft.batchId ||
    receipt.data.batchId !== draft.batchId ||
    receipt.data.itemId !== item.id ||
    receipt.data.materialId !== material.id ||
    receipt.data.revision !== item.revision ||
    item.revision !== command.data.expectedRevision + 1 ||
    !isDeepStrictEqual(command.data.resolution, receipt.data.resolution) ||
    op.changes.length !== 1 ||
    op.changes[0]!.itemId !== item.id ||
    op.changes[0]!.previousRevision !== command.data.expectedRevision ||
    op.changes[0]!.revision !== item.revision ||
    audit.id !== op.auditId ||
    audit.actorId !== op.actorAccountId ||
    audit.action !== 'material.review' ||
    audit.resourceId !== material.id
  )
    return false;
  const boundPeople = command.data.resolution.personIds;
  return (
    draft.personIds.every((id) => boundPeople.includes(id)) &&
    draft.sourceReferences.some(
      (source) => source.originalVersionId === material.originalVersionId,
    )
  );
}

/** Caller holds the intake SHARE lock and the batch/draft locks. Every review
 * mutation takes intake WRITE first, so the rows cannot move under this check.
 * Only c902's durable generation manifest requires a c902 dependency. Other
 * canonical producers retain their own confirmation rules; parsing alone does
 * not create an unknown_person gate. */
export async function mediaDraftDependenciesCurrent(
  tx: Transaction,
  draft: RecordBatchDraft,
): Promise<boolean> {
  const producers = await tx
    .select()
    .from(jobSnapshots)
    .where(
      and(
        eq(jobSnapshots.kind, parsedAttachmentArrangeKind),
        sql`${jobSnapshots.result}->'arrange'->'manifest' @> ${JSON.stringify([{ draftId: draft.draftId }])}::jsonb`,
      ),
    );
  // Other producers own their actual speaker/image/etc dependencies. This
  // narrow assertion must not add a new unknown_person gate to their drafts.
  if (!producers.length) return true;
  if (producers.length !== 1) return false;
  const rows = await tx
    .select({
      dependency: mediaReviewDraftDependencies,
      item: mediaReviewItems,
      operation: mediaReviewOperations,
      material: mediaMaterials,
      audit: auditEvents,
    })
    .from(mediaReviewDraftDependencies)
    .innerJoin(
      mediaReviewItems,
      eq(mediaReviewItems.id, mediaReviewDraftDependencies.itemId),
    )
    .innerJoin(
      mediaReviewOperations,
      eq(mediaReviewOperations.id, mediaReviewDraftDependencies.operationId),
    )
    .innerJoin(
      mediaMaterials,
      eq(mediaMaterials.id, mediaReviewOperations.materialId),
    )
    .innerJoin(auditEvents, eq(auditEvents.id, mediaReviewOperations.auditId))
    .where(eq(mediaReviewDraftDependencies.draftId, draft.draftId));
  const dependencies = await tx
    .select()
    .from(mediaReviewDraftDependencies)
    .where(eq(mediaReviewDraftDependencies.draftId, draft.draftId));
  if (
    rows.length !== dependencies.length ||
    !rows.every((row) => currentMediaDraftDependency(draft, row))
  )
    return false;
  const metadata = readAttachmentArrangeMetadata({
    ...producers[0]!,
    result: producers[0]!.result ?? null,
  });
  if (!metadata || producers[0]!.status === 'cancelled') return false;
  if (metadata.generation.reviewOperationId === null)
    return metadata.generation.batchId === draft.batchId;
  return (
    metadata.generation.batchId === draft.batchId &&
    rows.some(
      (row) =>
        row.dependency.operationId === metadata.generation.reviewOperationId &&
        row.dependency.itemId === metadata.generation.reviewItemId &&
        row.item.revision === metadata.generation.itemRevision,
    )
  );
}
