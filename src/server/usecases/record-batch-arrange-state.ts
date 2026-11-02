import { z } from 'zod';
import { materialReviewItemSchema } from '../../contracts/material-review';
import type { RecordBatchDraftSet } from '../../contracts/record';
import { batchId, batchQuoteSchema } from '../modules/records/arrange/batch';
import { BATCH_PROMPT_VERSION } from '../modules/records/arrange/batch-prompt';
import { MODELINK_MODEL } from '../integrations/maas';
import { advanceJob, applyJobCommand, type JobRecord } from '../jobs/state';
import type { BatchArrangeOperation } from './record-batch-arrange';

const trace = z.strictObject({
  inputVersion: batchId,
  boundAt: z.iso.datetime(),
  occurredOn: z.iso.date(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  promptVersion: z.literal(BATCH_PROMPT_VERSION),
  modelVersion: z.literal(MODELINK_MODEL),
  dimensionVersionId: batchId,
  anchorVersionId: batchId,
});
export const batchMetadataSchema = z.strictObject({
  schemaVersion: z.literal(1),
  producer: z.literal('record_batch_arrange'),
  actorPersonId: batchId,
  operationId: batchId,
  trace: trace.nullable(),
  manifest: z.array(
    z.strictObject({
      eventKey: batchId,
      draftId: batchId,
      witnesses: z.array(batchQuoteSchema).min(1),
    }),
  ),
  pending: z.array(materialReviewItemSchema),
  failure: z
    .strictObject({
      kind: z.enum([
        'configuration',
        'invalid_request',
        'authentication',
        'permission',
        'network',
        'outcome_unknown',
        'invalid_response',
        'cancelled',
        'input_changed',
      ]),
      retryable: z.boolean(),
    })
    .nullable(),
});
export type BatchJobMetadata = z.infer<typeof batchMetadataSchema>;
export function initialBatchMetadata(
  actorPersonId: string,
  operationId: string,
  pending: BatchJobMetadata['pending'],
): BatchJobMetadata {
  return batchMetadataSchema.parse({
    schemaVersion: 1,
    producer: 'record_batch_arrange',
    actorPersonId,
    operationId,
    trace: null,
    manifest: [],
    pending,
    failure: null,
  });
}
export function parseBatchMetadata(value: unknown): BatchJobMetadata | null {
  const checked = batchMetadataSchema.safeParse(value);
  return checked.success ? checked.data : null;
}
export function batchOperationFromJob(
  job: JobRecord,
  input: {
    batchId: string | null;
    creatorAccountId: string;
    inputVersion: string;
  },
  metadata: BatchJobMetadata,
  draftSet: RecordBatchDraftSet | null,
): BatchArrangeOperation {
  if (!input.batchId || job.inputVersion !== input.inputVersion)
    throw new Error('native_batch_input_required');
  const phase: BatchArrangeOperation['phase'] =
    job.status === 'queued'
      ? 'queued'
      : job.status === 'running' || job.status === 'partial'
        ? 'running'
        : job.status === 'cancelled'
          ? 'cancelled'
          : job.status === 'failed'
            ? 'failed'
            : draftSet === null
              ? 'needs_review'
              : 'done';
  return {
    revision: job.revision,
    accountId: input.creatorAccountId,
    batchId: input.batchId,
    operationId: metadata.operationId,
    attempt: job.attempt,
    inputVersion: input.inputVersion,
    phase,
    cancelRequested: job.cancelRequestedAt !== null,
    failure: metadata.failure,
    trace: metadata.trace,
    draftSet,
  };
}
/** Only the existing job state is persisted. Metadata has no phase or draft set. */
export function updateBatchJob(
  current: JobRecord,
  phase: BatchArrangeOperation['phase'],
  result: BatchJobMetadata,
  now: string,
): JobRecord {
  batchMetadataSchema.parse(result);
  if (phase === 'cancelled') {
    if (current.status === 'cancelled') return current;
    const cancelled =
      current.cancelRequestedAt === null
        ? applyJobCommand(
            current,
            { action: 'cancel', expectedRevision: current.revision },
            now,
          )
        : current;
    return advanceJob(
      cancelled,
      {
        attempt: cancelled.attempt,
        expectedRevision: cancelled.revision,
        status: 'cancelled',
        result,
      },
      now,
    );
  }
  const status =
    phase === 'done' || phase === 'needs_review'
      ? 'awaiting_manual'
      : phase === 'failed'
        ? 'failed'
        : phase === 'queued'
          ? 'queued'
          : 'running';
  let record = current;
  // The platform permits queued -> running -> awaiting_manual/failed. An
  // unresolved intake follows that exact state machine without model dispatch.
  if (record.status === 'queued' && status !== 'running' && status !== 'queued')
    record = advanceJob(
      record,
      {
        attempt: record.attempt,
        expectedRevision: record.revision,
        status: 'running',
        result,
      },
      now,
    );
  return advanceJob(
    record,
    {
      attempt: record.attempt,
      expectedRevision: record.revision,
      status,
      result,
      ...(status === 'failed'
        ? {
            errorCode:
              result.failure?.kind === 'input_changed'
                ? ('input_changed' as const)
                : ('processing_failed' as const),
          }
        : {}),
    },
    now,
  );
}
