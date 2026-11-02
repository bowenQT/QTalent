import { z } from 'zod';

const id = z.string().min(1).max(200).regex(/\S/);
const text = z.string().min(1).regex(/\S/);

/** One private staging collection per material submission. The node is the
 * intake scope only; it grants no parsing or model disclosure by itself.
 */
export const materialStagingCollectionInputSchema = z.strictObject({
  operationId: id,
  evaluationNodeId: id,
});
export const materialStagingCollectionResultSchema = z.discriminatedUnion(
  'status',
  [
    z.strictObject({
      status: z.literal('success'),
      recordCollectionId: id,
      expiresAt: z.iso.datetime(),
    }),
    z.strictObject({
      status: z.literal('validation_error'),
      fieldErrors: z.record(z.string(), z.array(z.string())),
      input: z.unknown(),
    }),
    z.strictObject({
      status: z.enum([
        'unauthenticated',
        'forbidden',
        'not_found',
        'conflict',
        'unavailable',
      ]),
      message: text,
    }),
  ],
);
export type MaterialStagingCollectionInput = z.infer<
  typeof materialStagingCollectionInputSchema
>;
export type MaterialStagingCollectionResult = z.infer<
  typeof materialStagingCollectionResultSchema
>;
