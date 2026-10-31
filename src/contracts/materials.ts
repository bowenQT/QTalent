import { z } from 'zod';
import { MAX_ATTACHMENTS, materialFileInputSchema } from './media';
import { materialReviewItemSchema } from './material-review';
import { recordActionResultSchema, recordBatchDraftSetSchema } from './record';

const id = z.string().min(1).max(200).regex(/\S/);
const text = z.string().min(1).regex(/\S/);
const revision = z.number().int().positive();
const ids = z
  .array(id)
  .refine((values) => new Set(values).size === values.length);
/**
 * Empty personIds is deliberate unassigned intake, never "all people".
 * Upload IDs and node IDs are lookup identities, not grants. No parsing/model
 * disclosure or profile writes until the server resolves current scope.
 * Same actor + operationId + semantic payload replays the same batch receipt;
 * changed payload conflicts. Duplicate file lookups inside one batch are rejected.
 */
export const materialBatchInputSchema = z
  .strictObject({
    operationId: id,
    evaluationNodeId: id,
    personIds: ids,
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
]);
const batch = {
  batchId: id,
  revision,
  evaluationNodeId: id,
  personIds: ids,
  files: z.array(materialFileReceiptSchema).max(MAX_ATTACHMENTS),
};
/**
 * Four aggregate states; file failures stay visible even when other files work.
 * needs_review exposes choices, never fabricated SBI/scores. awaiting_confirmation
 * contains AI suggestions only; a pending duplicate choice still blocks saving.
 * A batch receipt is not evidence of confirmation, import, or completed HR action.
 */
export const materialBatchReceiptSchema = z
  .discriminatedUnion('status', [
    z.strictObject({ ...batch, status: z.literal('processing'), jobId: id }),
    z.strictObject({
      ...batch,
      status: z.literal('needs_review'),
      items: z.array(materialReviewItemSchema).min(1),
    }),
    z.strictObject({
      ...batch,
      status: z.literal('awaiting_confirmation'),
      draftSet: recordBatchDraftSetSchema,
    }),
    z.strictObject({
      ...batch,
      status: z.literal('failed'),
      code: z.enum(['all_materials_unusable', 'processing_failed']),
      message: text,
      retryable: z.boolean(),
    }),
  ])
  .refine(
    (value) =>
      new Set(value.files.map((entry) => entry.materialId)).size ===
        value.files.length &&
      new Set(value.files.map((entry) => entry.clientFileId)).size ===
        value.files.length,
  )
  .refine(
    (value) =>
      value.status !== 'needs_review' ||
      (new Set(value.items.map((entry) => entry.itemId)).size ===
        value.items.length &&
        value.items.every(
          (entry) =>
            entry.batchId === value.batchId &&
            entry.evaluationNodeId === value.evaluationNodeId,
        ) &&
        value.files.every(
          (entry) =>
            entry.status !== 'needs_review' ||
            entry.reviewItemIds.every((itemId) =>
              value.items.some((item) => item.itemId === itemId),
            ),
        )),
  )
  .refine(
    (value) =>
      value.status !== 'awaiting_confirmation' ||
      (value.personIds.length > 0 &&
        value.draftSet.batchId === value.batchId &&
        value.draftSet.revision === value.revision &&
        value.draftSet.drafts.every(
          (draft) =>
            draft.evaluationNodeId === value.evaluationNodeId &&
            draft.personIds.every((personId) =>
              value.personIds.includes(personId),
            ),
        ) &&
        value.files.every(
          (entry) =>
            entry.status !== 'processing' && entry.status !== 'needs_review',
        )),
  );
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
