import { z } from 'zod';
import { MAX_ATTACHMENTS, materialFileInputSchema } from './media';
import {
  materialReviewItemSchema,
  materialReviewResolvedItemSchema,
} from './material-review';
import { recordActionResultSchema, recordBatchDraftSetSchema } from './record';

const id = z.string().min(1).max(200).regex(/\S/);
const text = z.string().min(1).regex(/\S/);
const revision = z.number().int().positive();
const ids = z
  .array(id)
  .refine((values) => new Set(values).size === values.length);
/** Lookup identities are not grants. Resolve current subjects AND scope before
 * model disclosure; unassigned personIds:[] never means "all people". A project
 * is intake context, not a substitute for node/source permission. Same actor,
 * operationId and semantic payload replay; changed payload conflicts.
 */
export const materialBatchInputSchema = z
  .strictObject({
    operationId: id,
    evaluationNodeId: id,
    personIds: ids,
    projectId: id.nullable(),
    text: z.string(),
    files: z.array(materialFileInputSchema).max(MAX_ATTACHMENTS),
  })
  .refine((input) => input.text.trim().length > 0 || input.files.length > 0)
  .refine(
    (input) =>
      new Set(input.files.map((file) => file.clientFileId)).size ===
        input.files.length &&
      new Set(input.files.map((file) => file.uploadId)).size ===
        input.files.length,
  );

const file = {
  materialId: id,
  clientFileId: id,
  filename: text,
  originalVersionId: id.nullable(),
};
/** original_only and attachment_only settle this file without model disclosure.
 * Retention never creates a directory person, score, or a broader audience.
 * The whole-image reader must authorize every subject before returning bytes.
 */
export const materialFileReceiptSchema = z.discriminatedUnion('status', [
  z.strictObject({ ...file, status: z.literal('processing'), jobId: id }),
  z.strictObject({
    ...file,
    status: z.literal('parsed'),
    originalVersionId: id,
    parseVersionId: id,
  }),
  z.strictObject({
    ...file,
    status: z.literal('needs_review'),
    reviewItemIds: ids.min(1),
  }),
  z.strictObject({
    ...file,
    status: z.literal('unsupported'),
    reason: z.enum(['format', 'scanned', 'no_usable_content']),
    message: text,
  }),
  z.strictObject({
    ...file,
    status: z.literal('failed'),
    code: z.enum(['invalid_content', 'processing_failed']),
    message: text,
    retryable: z.boolean(),
  }),
  z.strictObject({
    ...file,
    status: z.literal('original_only'),
    originalVersionId: id,
  }),
  z.strictObject({
    ...file,
    status: z.literal('attachment_only'),
    originalVersionId: id,
  }),
]);
const count = z.number().int().nonnegative();
const confirmedDraftSchema = z.strictObject({
  draftId: id,
  revision,
  // Persisted HUMAN confirmations only. These mappings are not AI suggestions.
  events: z
    .array(z.strictObject({ personId: id, eventId: id }))
    .min(1)
    .refine(
      (events) =>
        new Set(events.map((entry) => entry.personId)).size === events.length &&
        new Set(events.map((entry) => entry.eventId)).size === events.length,
    ),
});
/** One current snapshot is the source of progress. Counts have explicit units:
 * files, event drafts (not people), and unresolved review items. Never persist
 * a second mutable batch status/count ledger. A different file's open review
 * does not block an authorized, unblocked event's individual confirmation.
 */
export const materialBatchReceiptSchema = z
  .strictObject({
    batchId: id,
    revision,
    evaluationNodeId: id,
    personIds: ids,
    projectId: id.nullable(),
    // One owner-authorized bit, never a hidden count or identity/category list.
    hasHiddenContent: z.boolean(),
    status: z.enum([
      'processing',
      'needs_review',
      'awaiting_confirmation',
      'completed',
      'failed',
    ]),
    // Active text/arrangement work can exist without a file. Null means no such job.
    jobId: id.nullable(),
    files: z.array(materialFileReceiptSchema).max(MAX_ATTACHMENTS),
    // Inline text also has an authoritative original; it is not counted as a file.
    textMaterial: z
      .strictObject({ materialId: id, originalVersionId: id })
      .nullable(),
    items: z.array(materialReviewItemSchema),
    resolvedItems: z.array(materialReviewResolvedItemSchema),
    draftSet: recordBatchDraftSetSchema.nullable(),
    confirmedDrafts: z.array(confirmedDraftSchema),
    counts: z.strictObject({
      files: z.strictObject({
        total: count,
        processing: count,
        parsed: count,
        needs_review: count,
        unsupported: count,
        failed: count,
        original_only: count,
        attachment_only: count,
      }),
      events: z.strictObject({
        total: count,
        awaiting_confirmation: count,
        confirmed: count,
      }),
      reviewItems: count,
    }),
    error: z
      .strictObject({
        code: z.enum(['all_materials_unusable', 'processing_failed']),
        message: text,
        retryable: z.boolean(),
      })
      .nullable(),
  })
  .refine((value) => {
    const materialIds = value.files.map((entry) => entry.materialId);
    return (
      new Set(materialIds).size === materialIds.length &&
      new Set(value.files.map((entry) => entry.clientFileId)).size ===
        value.files.length &&
      (value.textMaterial === null ||
        !materialIds.includes(value.textMaterial.materialId))
    );
  }, '材料查找身份不得重复')
  .refine((value) => {
    const set = value.draftSet;
    return (
      set === null ||
      (set.batchId === value.batchId &&
        set.revision === value.revision &&
        set.drafts.every(
          (draft) =>
            draft.evaluationNodeId === value.evaluationNodeId &&
            draft.personIds.every((personId) =>
              value.personIds.includes(personId),
            ),
        ))
    );
  }, '草稿须属于当前批次、修订与已确定主体')
  .refine((value) => {
    const confirmedIds = value.confirmedDrafts.map((entry) => entry.draftId);
    const eventIds = value.confirmedDrafts.flatMap((entry) =>
      entry.events.map((event) => event.eventId),
    );
    return (
      new Set(confirmedIds).size === confirmedIds.length &&
      new Set(eventIds).size === eventIds.length &&
      value.confirmedDrafts.every((entry) =>
        entry.events.every((event) => value.personIds.includes(event.personId)),
      ) &&
      (value.draftSet === null ||
        value.draftSet.drafts.every(
          (draft) => !confirmedIds.includes(draft.draftId),
        ))
    );
  }, '待确认与已确认事件不可重复计数，确认主体不可越出当前批次')
  .refine((value) => {
    const reviews = [...value.items, ...value.resolvedItems];
    if (new Set(reviews.map((entry) => entry.itemId)).size !== reviews.length)
      return false;
    return (
      reviews.every((item) => {
        const material =
          value.files.find((entry) => entry.materialId === item.materialId) ??
          (value.textMaterial?.materialId === item.materialId
            ? value.textMaterial
            : undefined);
        return (
          item.batchId === value.batchId &&
          item.evaluationNodeId === value.evaluationNodeId &&
          material !== undefined &&
          material.originalVersionId === item.originalVersionId
        );
      }) &&
      value.files.every(
        (entry) =>
          entry.status !== 'needs_review' ||
          entry.reviewItemIds.every((itemId) =>
            value.items.some(
              (item) =>
                item.itemId === itemId && item.materialId === entry.materialId,
            ),
          ),
      )
    );
  }, '待核对须关联同一材料、原件版本、批次与节点')
  .refine((value) => {
    const files = value.counts.files;
    return (
      files.total === value.files.length &&
      Object.entries(files).every(
        ([status, amount]) =>
          status === 'total' ||
          value.files.filter((entry) => entry.status === status).length ===
            amount,
      ) &&
      value.counts.events.awaiting_confirmation ===
        (value.draftSet?.drafts.length ?? 0) &&
      value.counts.events.confirmed === value.confirmedDrafts.length &&
      value.counts.events.total ===
        (value.draftSet?.drafts.length ?? 0) + value.confirmedDrafts.length &&
      value.counts.reviewItems === value.items.length
    );
  }, '回执计数须来自同一份逐项快照')
  .refine((value) => {
    const awaiting = value.draftSet !== null;
    const review = value.items.length > 0;
    const processing =
      value.jobId !== null ||
      value.files.some((entry) => entry.status === 'processing');
    if (value.error !== null)
      return !awaiting && !review && !processing && value.status === 'failed';
    // Prototype intake.js: the label reports running work first, then review,
    // then confirmation. It never gates the independent draftSet actions.
    const expected = processing
      ? 'processing'
      : review
        ? 'needs_review'
        : awaiting
          ? 'awaiting_confirmation'
          : 'completed';
    return value.status === expected;
  }, '批次状态由逐项进度推导；失败须有明确原因，完成须无未结事项');

export const materialBatchReadInputSchema = z.strictObject({ batchId: id });
export const materialBatchSubmitResultSchema = recordActionResultSchema(
  materialBatchInputSchema,
  materialBatchReceiptSchema,
);
export const materialBatchReadResultSchema = recordActionResultSchema(
  materialBatchReadInputSchema,
  materialBatchReceiptSchema,
);
export type MaterialBatchInput = z.infer<typeof materialBatchInputSchema>;
export type MaterialFileReceipt = z.infer<typeof materialFileReceiptSchema>;
export type MaterialBatchReceipt = z.infer<typeof materialBatchReceiptSchema>;
export type MaterialBatchReadInput = z.infer<
  typeof materialBatchReadInputSchema
>;
export type MaterialBatchSubmitResult = z.infer<
  typeof materialBatchSubmitResultSchema
>;
export type MaterialBatchReadResult = z.infer<
  typeof materialBatchReadResultSchema
>;
