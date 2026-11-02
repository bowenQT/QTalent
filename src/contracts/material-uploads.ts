import { z } from 'zod';

const id = z.string().min(1).max(200).regex(/\S/);
const text = z.string().min(1).regex(/\S/);

/** One private staging collection per material submission. The server picks
 * the submitter's default intake node; the node is the intake scope only and
 * grants no parsing or model disclosure by itself. Upload requests echo the
 * returned evaluationNodeId in `target`.
 */
export const materialStagingCollectionInputSchema = z.strictObject({
  operationId: id,
});
export const materialStagingCollectionResultSchema = z.discriminatedUnion(
  'status',
  [
    z.strictObject({
      status: z.literal('success'),
      recordCollectionId: id,
      evaluationNodeId: id,
      expiresAt: z.iso.datetime(),
    }),
    z.strictObject({
      status: z.enum(['default_node_missing', 'default_node_ambiguous']),
      message: text,
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
