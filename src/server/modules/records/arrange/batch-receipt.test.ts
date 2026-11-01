import { describe, expect, it } from 'vitest';
import {
  materialReviewItemsFixture,
  recordBatchDraftFixture,
} from '../../../../contracts/materials.fixtures';
import {
  projectBatchReceipt,
  BatchReceiptProjectionError,
  type BatchReceiptFacts,
} from './batch-receipt';

function fixture(): BatchReceiptFacts {
  const pending = structuredClone(materialReviewItemsFixture[3]);
  pending.materialId = 'demo-pdf-material';
  return {
    batchId: 'demo-batch',
    revision: 2,
    evaluationNodeId: 'demo-node',
    personIds: ['demo-person'],
    projectId: null,
    hasHiddenContent: true,
    jobId: null,
    textMaterial: null,
    files: [
      {
        materialId: 'demo-document-material',
        originalVersionId: 'demo-document-v1',
        clientFileId: 'demo-file-document',
        filename: '演示段落',
        status: 'parsed',
        parseVersionId: 'demo-parse',
      },
      {
        materialId: pending.materialId,
        originalVersionId: pending.originalVersionId,
        clientFileId: 'demo-file-pdf',
        filename: '演示面评',
        status: 'needs_review',
        reviewItemIds: [pending.itemId],
      },
    ],
    items: [pending],
    resolvedItems: [],
    draftSet: {
      batchId: 'demo-batch',
      revision: 2,
      drafts: [structuredClone(recordBatchDraftFixture)],
      duplicateCandidates: [],
    },
    confirmedDrafts: [],
    error: null,
  };
}
describe('845 final897 receipt projection from authorized current facts', () => {
  it('retains an independent actionable draft alongside another material review', () => {
    const input = fixture(),
      before = structuredClone(input);
    const result = projectBatchReceipt(input);
    expect(input).toEqual(before);
    expect(result.status).toBe('needs_review');
    expect(result.draftSet?.drafts).toEqual(input.draftSet?.drafts);
    expect(result.counts).toEqual({
      files: {
        total: 2,
        processing: 0,
        parsed: 1,
        needs_review: 1,
        unsupported: 0,
        failed: 0,
        original_only: 0,
        attachment_only: 0,
      },
      events: { total: 1, awaiting_confirmation: 1, confirmed: 0 },
      reviewItems: 1,
    });
    expect(result.hasHiddenContent).toBe(true);
    expect(result).not.toHaveProperty('hiddenCount');
  });
  it('processing labels do not discard already available drafts', () => {
    const input = fixture();
    input.jobId = 'demo-running-work';
    const result = projectBatchReceipt(input);
    expect(result.status).toBe('processing');
    expect(result.draftSet).toEqual(input.draftSet);
  });
  it('counts human mappings independently, never from AI score/person counts', () => {
    const input = fixture();
    input.confirmedDrafts = [
      {
        draftId: 'demo-human-draft',
        revision: 3,
        events: [{ personId: 'demo-person', eventId: 'demo-saved-event' }],
      },
    ];
    expect(projectBatchReceipt(input).counts.events).toEqual({
      total: 2,
      awaiting_confirmation: 1,
      confirmed: 1,
    });
  });
  it('rejects hidden counts or an absent authority-produced hidden flag', () => {
    const input = { ...fixture(), hiddenCount: 7 };
    expect(() => projectBatchReceipt(input)).toThrow(
      BatchReceiptProjectionError,
    );
    const missing = fixture();
    Reflect.deleteProperty(missing, 'hasHiddenContent');
    expect(() => projectBatchReceipt(missing)).toThrow(
      BatchReceiptProjectionError,
    );
  });
  it('does not turn a contradictory batch-wide error into success or erase drafts', () => {
    const input = fixture();
    input.error = {
      code: 'processing_failed',
      message: '演示失败',
      retryable: false,
    };
    expect(() => projectBatchReceipt(input)).toThrow(
      BatchReceiptProjectionError,
    );
  });
  it('completes a settled batch without inventing a confirmation', () => {
    const input = fixture();
    input.items = [];
    input.draftSet = null;
    input.files[1] = {
      materialId: 'demo-pdf-material',
      originalVersionId: 'demo-pdf-v1',
      clientFileId: 'demo-file-pdf',
      filename: '演示面评',
      status: 'original_only',
    };
    const result = projectBatchReceipt(input);
    expect(result.status).toBe('completed');
    expect(result.counts.events).toEqual({
      total: 0,
      awaiting_confirmation: 0,
      confirmed: 0,
    });
    expect(result.counts.files.original_only).toBe(1);
  });
});
