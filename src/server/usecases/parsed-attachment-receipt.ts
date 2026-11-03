import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import type { StoredArrangeInput } from '../modules/records/arrange/input-state/schema';
import { mediaRecordOriginalInputSchema } from '../modules/records/arrange/input-state/original-input';
import {
  recordDraftBatches,
  recordDrafts,
  recordSaves,
} from '../modules/records';
import { mediaMaterials } from '../modules/records/material-review/schema';
import { jobSnapshots } from '../jobs/schema';
import { recordSaveReceiptSchema } from '../../contracts/record';
import type {
  MaterialBatchReceipt,
  MaterialFileReceipt,
} from '../../contracts/materials';
import { projectBatchReceipt } from '../modules/records/arrange/batch-receipt';
import { readIntakeTable } from './talent-source-projection';
import {
  currentAttachmentReviewItems,
  loadAttachmentMaterial,
} from './record-arrange-media-context';
import {
  readAttachmentArrangeMetadata,
  parsedAttachmentArrangeKind,
} from './parsed-attachment-state';
import { attachmentJobResultSchema } from '../modules/records/attachments/flow';

/** Current receipt, not a second batch status ledger. Caller already holds the
 * intake lock and parent job; parent ledger precedes source locks just as846. */
export async function readParsedAttachmentReceipt(
  tx: Transaction,
  input: StoredArrangeInput,
  at: string,
): Promise<MaterialBatchReceipt | null> {
  const original = mediaRecordOriginalInputSchema.safeParse(
    input.originalInput,
  );
  if (!original.success || !input.batchId || !input.evaluationNodeId)
    return null;
  const [batch] = await tx
    .select()
    .from(recordDraftBatches)
    .where(eq(recordDraftBatches.batchId, input.batchId))
    .for('update');
  const drafts = batch
    ? await tx
        .select()
        .from(recordDrafts)
        .where(eq(recordDrafts.batchId, input.batchId))
        .orderBy(recordDrafts.draftId)
        .for('update')
    : [];
  const materials = await tx
    .select()
    .from(mediaMaterials)
    .where(
      and(
        eq(mediaMaterials.inputId, input.id),
        eq(mediaMaterials.inputVersion, input.inputVersion),
      ),
    );
  const children = materials.length
    ? await tx
        .select()
        .from(jobSnapshots)
        .where(
          and(
            eq(jobSnapshots.kind, parsedAttachmentArrangeKind),
            inArray(
              jobSnapshots.resourceId,
              materials.map((row) => row.id),
            ),
          ),
        )
    : [];
  const intake = await readIntakeTable(tx, 'snapshot');
  const files: MaterialFileReceipt[] = [];
  const items: MaterialBatchReceipt['items'] = [];
  const resolvedItems: MaterialBatchReceipt['resolvedItems'] = [];
  const visibleDraftIds = new Set<string>();
  let hasHiddenContent = false;
  let activeJobId: string | null = null;
  for (const materialId of original.data.materialIds) {
    const loaded = await loadAttachmentMaterial(
      tx,
      materialId,
      at,
      intake,
      input.creatorAccountId,
    );
    if (!loaded || (loaded.scopeKnown && !loaded.scopeAllowed)) {
      hasHiddenContent = true;
      continue;
    }
    const { state, parseJob, canonical } = loaded;
    const reviews = await currentAttachmentReviewItems(tx, loaded);
    items.push(...reviews.pending);
    resolvedItems.push(...reviews.resolved);
    const file = {
      materialId,
      clientFileId: state.material.clientFileId,
      filename: state.upload!.filename,
      originalVersionId: state.material.originalVersionId,
    };
    const currentChildren = children.flatMap((job) => {
      const meta = readAttachmentArrangeMetadata({
        ...job,
        result: job.result ?? null,
      });
      if (
        !meta ||
        meta.generation.parentInputId !== input.id ||
        meta.generation.parentInputVersion !== input.inputVersion ||
        meta.generation.materialId !== materialId
      )
        return [];
      if (
        meta.generation.reviewOperationId !== null &&
        !state.items.some(
          (item) =>
            item.state === 'resolved' &&
            item.currentOperationId === meta.generation.reviewOperationId &&
            item.revision === meta.generation.itemRevision,
        )
      )
        return [];
      return [{ job, meta }];
    });
    for (const child of currentChildren) {
      if (['queued', 'running', 'partial'].includes(child.job.status))
        activeJobId ??= child.job.jobId;
      if (loaded.scopeAllowed)
        for (const event of child.meta.arrange.manifest)
          visibleDraftIds.add(event.draftId);
    }
    if (
      reviews.resolved.some(
        (item) =>
          item.kind === 'unknown_person' &&
          item.resolution.action === 'keep_original_only',
      )
    )
      files.push({ ...file, status: 'original_only' });
    else if (
      !parseJob ||
      ['queued', 'running', 'partial'].includes(parseJob.status)
    )
      files.push({
        ...file,
        status: 'processing',
        jobId: state.material.parseJobId,
      });
    else if (reviews.pending.length)
      files.push({
        ...file,
        status: 'needs_review',
        reviewItemIds: reviews.pending.map((item) => item.itemId),
      });
    else if (currentChildren.some(({ job }) => job.status === 'cancelled'))
      files.push({
        ...file,
        status: 'failed',
        code: 'processing_failed',
        message: '此文件的整理已取消，原文件已保留',
        retryable: false,
      });
    else if (currentChildren.some(({ job }) => job.status === 'failed'))
      files.push({
        ...file,
        status: 'failed',
        code: 'processing_failed',
        message: '整理未完成，原文件已保留',
        retryable: false,
      });
    else if (canonical)
      files.push({
        ...file,
        status: 'parsed',
        parseVersionId: canonical.binding.parseVersionId,
      });
    else {
      const result = attachmentJobResultSchema.safeParse(parseJob.result);
      const reason = result.success ? result.data.failureReason : undefined;
      if (reason === 'format' || reason === 'scanned' || reason === 'empty')
        files.push({
          ...file,
          status: 'unsupported',
          reason: reason === 'empty' ? 'no_usable_content' : reason,
          message: '该文件暂不能整理，原文件已保留',
        });
      else
        files.push({
          ...file,
          status: 'failed',
          code:
            reason === 'integrity' || reason === 'invalid_content'
              ? 'invalid_content'
              : 'processing_failed',
          message: '文件处理未完成，原文件已保留',
          retryable: false,
        });
    }
  }
  const allVisible = drafts.filter((row) => visibleDraftIds.has(row.draftId));
  const saved = await tx
    .select()
    .from(recordSaves)
    .where(
      and(
        eq(recordSaves.batchId, input.batchId),
        isNull(recordSaves.withdrawnAt),
      ),
    );
  const confirmed = new Map<
    string,
    MaterialBatchReceipt['confirmedDrafts'][number]
  >();
  for (const row of saved) {
    const draft = allVisible.find((draft) => draft.draftId === row.draftId);
    if (!draft) continue;
    const receipt = recordSaveReceiptSchema.parse(row.receipt);
    confirmed.set(row.draftId, {
      draftId: row.draftId,
      revision: draft.revision,
      events: receipt.events,
    });
  }
  const pendingDrafts = allVisible
    .filter((row) => !confirmed.has(row.draftId))
    .map((row) => row.draft);
  const allUnusable =
    files.length > 0 &&
    files.every(
      (file) => file.status === 'unsupported' || file.status === 'failed',
    ) &&
    !items.length &&
    !allVisible.length &&
    !activeJobId;
  const [parent] = await tx
    .select()
    .from(jobSnapshots)
    .where(eq(jobSnapshots.jobId, input.jobId));
  return projectBatchReceipt({
    batchId: input.batchId,
    revision: batch?.revision ?? 1,
    evaluationNodeId: input.evaluationNodeId,
    personIds: [
      ...new Set(allVisible.flatMap((row) => row.draft.personIds)),
    ].sort(),
    projectId: null,
    hasHiddenContent,
    files,
    textMaterial: null,
    jobId: activeJobId,
    items,
    resolvedItems,
    draftSet:
      batch && pendingDrafts.length
        ? {
            batchId: input.batchId,
            revision: batch.revision,
            drafts: pendingDrafts,
            duplicateCandidates: batch.duplicateCandidates.filter((group) =>
              group.draftIds.every((id) =>
                pendingDrafts.some((draft) => draft.draftId === id),
              ),
            ),
          }
        : null,
    confirmedDrafts: [...confirmed.values()],
    error:
      parent?.status === 'cancelled'
        ? {
            code: 'processing_failed',
            message: '整理已取消，原文件仍保留',
            retryable: false,
          }
        : allUnusable
          ? {
              code: 'all_materials_unusable',
              message: '本次文件均未能整理，原文件仍保留',
              retryable: false,
            }
          : null,
  });
}
