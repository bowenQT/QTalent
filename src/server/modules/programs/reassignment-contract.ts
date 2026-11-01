import { z } from 'zod';

const id = z.string().min(1).max(200).regex(/\S/);
const revision = z.number().int().positive();
export const evaluationWorkKindSchema = z.enum([
  'confirmation',
  'speaker',
  'unknown_person',
  'image_scope',
  'unknown_interviewer',
  'unknown_project',
  'unknown_interview_candidate',
]);
/** A trusted source task must already have a server-resolved node and subject. */
export const evaluationWorkRegistrationSchema = z.strictObject({
  id,
  evaluationNodeId: id,
  personId: id,
  assignedRelationId: id,
  assignedEvaluatorId: id,
  kind: evaluationWorkKindSchema,
  resourceId: id,
});
export const reassignEvaluationWorkInputSchema = z.strictObject({
  operationId: id,
  workItemId: id,
  expectedRevision: revision,
  targetRelationId: id,
});
export const evaluationReassignmentReceiptSchema = z.strictObject({
  workItemId: id,
  evaluationNodeId: id,
  personId: id,
  kind: evaluationWorkKindSchema,
  resourceId: id,
  previousRelationId: id,
  previousEvaluatorId: id,
  assignedRelationId: id,
  assignedEvaluatorId: id,
  revision,
  reassignedBy: id,
  reassignedAt: z.iso.datetime(),
});
export const reassignEvaluationWorkResultSchema = z.discriminatedUnion(
  'status',
  [
    z.strictObject({
      status: z.literal('success'),
      replayed: z.boolean(),
      receipt: evaluationReassignmentReceiptSchema,
    }),
    z.strictObject({
      status: z.literal('validation_error'),
      fieldErrors: z.record(z.string(), z.array(z.string())),
      input: z.unknown(),
    }),
    z.strictObject({
      status: z.literal('conflict'),
      message: id,
      input: reassignEvaluationWorkInputSchema,
    }),
    z.strictObject({
      status: z.enum(['forbidden', 'not_found']),
      message: id,
    }),
  ],
);
export type ReassignEvaluationWorkInput = z.infer<
  typeof reassignEvaluationWorkInputSchema
>;
export type EvaluationReassignmentReceipt = z.infer<
  typeof evaluationReassignmentReceiptSchema
>;
export type ReassignEvaluationWorkResult = z.infer<
  typeof reassignEvaluationWorkResultSchema
>;
export interface EvaluationWorkItem extends z.infer<
  typeof evaluationWorkRegistrationSchema
> {
  state: 'pending' | 'processing' | 'completed' | 'cancelled';
  revision: number;
  updatedAt: string;
}
