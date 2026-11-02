import {
  materialBatchReceiptSchema,
  type MaterialBatchReceipt,
} from '../../../../contracts/materials';

/** All fields are the current server-authorized facts. No count/status is stored
 * separately, and absence of a source never becomes a fabricated empty value. */
export type BatchReceiptFacts = Omit<MaterialBatchReceipt, 'status' | 'counts'>;
export class BatchReceiptProjectionError extends Error {
  constructor() {
    super('batch_receipt_snapshot_inconsistent');
    this.name = 'BatchReceiptProjectionError';
  }
}
export function projectBatchReceipt(
  facts: BatchReceiptFacts,
): MaterialBatchReceipt {
  const source = structuredClone(facts);
  const files = source.files;
  const waiting = source.draftSet?.drafts.length ?? 0;
  const value: MaterialBatchReceipt = {
    ...source,
    status:
      source.error !== null
        ? 'failed'
        : source.jobId !== null ||
            files.some((file) => file.status === 'processing')
          ? 'processing'
          : source.items.length > 0
            ? 'needs_review'
            : source.draftSet !== null
              ? 'awaiting_confirmation'
              : 'completed',
    counts: {
      files: {
        total: files.length,
        processing: files.filter((file) => file.status === 'processing').length,
        parsed: files.filter((file) => file.status === 'parsed').length,
        needs_review: files.filter((file) => file.status === 'needs_review')
          .length,
        unsupported: files.filter((file) => file.status === 'unsupported')
          .length,
        failed: files.filter((file) => file.status === 'failed').length,
        original_only: files.filter((file) => file.status === 'original_only')
          .length,
        attachment_only: files.filter(
          (file) => file.status === 'attachment_only',
        ).length,
      },
      events: {
        total: waiting + source.confirmedDrafts.length,
        awaiting_confirmation: waiting,
        confirmed: source.confirmedDrafts.length,
      },
      reviewItems: source.items.length,
    },
  };
  if (!materialBatchReceiptSchema.safeParse(value).success)
    throw new BatchReceiptProjectionError();
  // Keep original quote bytes; successful shape validation is not a text rewrite.
  return value;
}
