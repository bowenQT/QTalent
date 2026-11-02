import { z } from 'zod';
import { materialBatchInputSchema } from '../../../../../contracts/materials';
import { MAX_ATTACHMENTS } from '../../../../../contracts/media';
import { recordInputSchema } from '../../../../../contracts/record';

const materialId = materialBatchInputSchema.shape.operationId;

/** This intake's media-file subset, not textMaterial or historical uploads.
 * Consumers verify same-batch current membership, persisted materials and
 * complete current scope. Human decisions are required only for actual review
 * items; this type does not add a blanket confirmation gate or authorize use.
 */
export const mediaRecordOriginalInputSchema = z.strictObject({
  kind: z.literal('media'),
  operationId: materialId,
  materialIds: z
    .array(materialId)
    .min(1)
    .max(MAX_ATTACHMENTS)
    .refine((ids) => new Set(ids).size === ids.length),
});

// Preserve the public text contract, including its normalization and failures.
export const storedRecordOriginalInputSchema = z.union([
  recordInputSchema,
  mediaRecordOriginalInputSchema,
]);

export type MediaRecordOriginalInput = z.infer<
  typeof mediaRecordOriginalInputSchema
>;
export type StoredRecordOriginalInput = z.infer<
  typeof storedRecordOriginalInputSchema
>;
