import { z } from 'zod';

export const jobStatusSchema = z.enum([
  'queued',
  'running',
  'partial',
  'awaiting_manual',
  'failed',
  'completed',
  'cancelled',
]);
export type JobStatus = z.infer<typeof jobStatusSchema>;
export const jobErrorCodeSchema = z.enum([
  'processing_failed',
  'input_changed',
  'dependency_unavailable',
]);
export type JobErrorCode = z.infer<typeof jobErrorCodeSchema>;
export const jobProgressSchema = z
  .object({
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .strict()
  .refine((value) => value.completed <= value.total);
export const jobCommandSchema = z
  .object({
    jobId: z.string().min(1).max(200),
    action: z.enum(['retry', 'resume', 'cancel']),
    operationId: z.string().min(1).max(200),
    expectedRevision: z.number().int().positive(),
  })
  .strict();
export type JobCommand = z.infer<typeof jobCommandSchema>;
/** Consumers compose their explicit kind and strict public result schema here; never use unknown JSON as a public result. */
export function createJobSnapshotSchema<K extends string, S extends z.ZodType>(
  kind: K,
  resultSchema: S,
) {
  return z
    .object({
      schemaVersion: z.literal(1),
      jobId: z.string().min(1),
      kind: z.literal(kind),
      status: jobStatusSchema,
      attempt: z.number().int().positive(),
      revision: z.number().int().positive(),
      updatedAt: z.iso.datetime(),
      progress: jobProgressSchema.nullable(),
      result: resultSchema.nullable(),
      error: z
        .object({ code: jobErrorCodeSchema, message: z.string().min(1) })
        .strict()
        .nullable(),
      canRetry: z.boolean(),
      canCancel: z.boolean(),
      cancelRequestedAt: z.iso.datetime().nullable(),
    })
    .strict();
}
export interface JobSnapshot<R = unknown> {
  schemaVersion: 1;
  jobId: string;
  kind: string;
  status: JobStatus;
  attempt: number;
  revision: number;
  updatedAt: string;
  progress: { completed: number; total: number } | null;
  result: R | null;
  error: { code: JobErrorCode; message: string } | null;
  canRetry: boolean;
  canCancel: boolean;
  cancelRequestedAt: string | null;
}
export type JobFailureStatus =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation_error'
  | 'unavailable';
export type JobResponse<R = unknown> =
  | { status: 'success'; snapshot: JobSnapshot<R> }
  | { status: JobFailureStatus };
