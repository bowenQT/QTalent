import { createHash } from 'node:crypto';
import { z } from 'zod';
import { newJob, type JobRecord } from '../jobs/state';
import {
  batchMetadataSchema,
  initialBatchMetadata,
} from './record-batch-arrange-state';

export const parsedAttachmentArrangeKind = 'record_attachment_organize';
const id = z.string().min(1).max(200).regex(/\S/);
/** Review revisions distinguish a new human decision from a delivery retry.
 * No parent ledger revision belongs here: another file may finish or receive a
 * human confirmation while this file's model request is still in flight. */
export const attachmentGenerationSchema = z
  .strictObject({
    parentInputId: id,
    parentInputVersion: id,
    batchId: id,
    materialId: id,
    originalVersionId: id,
    parseVersionId: id,
    captureAuditId: id,
    materialRevision: z.number().int().positive(),
    reviewItemId: id.nullable(),
    reviewOperationId: id.nullable(),
    itemRevision: z.number().int().positive().nullable(),
    accountId: id,
  })
  .refine(
    (value) =>
      (value.reviewItemId === null) === (value.reviewOperationId === null) &&
      (value.reviewItemId === null) === (value.itemRevision === null),
  );
export type AttachmentGeneration = z.infer<typeof attachmentGenerationSchema>;

export function attachmentGenerationIdentity(raw: AttachmentGeneration) {
  const value = attachmentGenerationSchema.parse(raw);
  const digest = createHash('sha256')
    .update(
      JSON.stringify([
        'parsed-attachment-generation-v1',
        value.parentInputId,
        value.parentInputVersion,
        value.batchId,
        value.materialId,
        value.originalVersionId,
        value.parseVersionId,
        value.captureAuditId,
        value.materialRevision,
        value.reviewItemId,
        value.reviewOperationId,
        value.itemRevision,
        value.accountId,
      ]),
    )
    .digest('hex');
  return {
    jobId: 'attachment-arrange-' + digest,
    inputVersion: 'attachment-generation-' + digest,
    operationId: 'attachment-operation-' + digest,
  };
}

export const attachmentArrangeMetadataSchema = z.strictObject({
  schemaVersion: z.literal(1),
  producer: z.literal('parsed_attachment_arrange'),
  generation: attachmentGenerationSchema,
  generationRevision: z.literal(1),
  arrange: batchMetadataSchema,
});
export type AttachmentArrangeMetadata = z.infer<
  typeof attachmentArrangeMetadataSchema
>;

/** Creates facts only; callers must prove scope and current permissions before
 * inserting this row or enqueuing it. This function never authorizes a file. */
export function newAttachmentArrangeJob(
  generation: AttachmentGeneration,
  actorPersonId: string,
  now: string,
): JobRecord {
  const identity = attachmentGenerationIdentity(generation);
  const result = attachmentArrangeMetadataSchema.parse({
    schemaVersion: 1,
    producer: 'parsed_attachment_arrange',
    generation,
    generationRevision: 1,
    arrange: initialBatchMetadata(actorPersonId, identity.operationId, []),
  });
  return {
    ...newJob(
      {
        jobId: identity.jobId,
        inputVersion: identity.inputVersion,
        resourceId: generation.materialId,
        kind: parsedAttachmentArrangeKind,
      },
      now,
    ),
    result,
  };
}

export function readAttachmentArrangeMetadata(
  job: JobRecord,
): AttachmentArrangeMetadata | null {
  const parsed = attachmentArrangeMetadataSchema.safeParse(job.result);
  if (!parsed.success || job.kind !== parsedAttachmentArrangeKind) return null;
  const identity = attachmentGenerationIdentity(parsed.data.generation);
  return job.jobId === identity.jobId &&
    job.inputVersion === identity.inputVersion &&
    job.resourceId === parsed.data.generation.materialId &&
    parsed.data.arrange.operationId === identity.operationId
    ? parsed.data
    : null;
}
