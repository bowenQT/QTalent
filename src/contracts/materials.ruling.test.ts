import { describe, expect, it } from 'vitest';
import {
  materialBatchInputSchema,
  materialBatchReceiptSchema,
  materialFileReceiptSchema,
} from './materials';
import { recordBatchDraftSchema } from './record';
import {
  materialReviewItemSchema,
  materialReviewCommandSchema,
  materialReviewResolutionReceiptSchema,
  materialReviewCommandResultSchema,
  MATERIAL_REVIEW_POLICIES,
} from './material-review';
import {
  materialBatchInputFixture,
  recordBatchDraftFixture,
  materialReviewItemsFixture,
  materialReferencesFixture,
} from './materials.fixtures';

const review = {
  ...materialReviewItemsFixture[2],
  materialId: 'image',
  itemId: 'image-review',
};
const draft = { ...recordBatchDraftFixture, projectId: 'demo-project' };
const parsed = {
  materialId: 'document',
  clientFileId: 'doc-file',
  filename: '演示.txt',
  originalVersionId: 'demo-document-v1',
  status: 'parsed',
  parseVersionId: 'parse-1',
};
const processing = {
  materialId: 'audio',
  clientFileId: 'audio-file',
  filename: '演示.wav',
  originalVersionId: null,
  status: 'processing',
  jobId: 'audio-job',
};
const waiting = {
  materialId: 'image',
  clientFileId: 'image-file',
  filename: '演示.png',
  originalVersionId: 'demo-image-v1',
  status: 'needs_review',
  reviewItemIds: ['image-review'],
};
const confirmed = {
  draftId: 'confirmed-draft',
  revision: 3,
  events: [{ personId: 'demo-person', eventId: 'committed-event' }],
};
const command = {
  operationId: 'resolve-1',
  batchId: 'demo-batch',
  itemId: 'review-1',
  expectedRevision: 2,
};
const resolution = {
  batchId: 'demo-batch',
  materialId: 'image',
  itemId: 'review-1',
  revision: 3,
  remainingReviewItemIds: [],
  blockingReviewItemIds: [],
  invalidatedDraftIds: [],
  kind: 'image_scope',
  resolution: { action: 'keep_attachment_only' },
  resume: null,
};
function mixedReceipt() {
  return {
    batchId: 'demo-batch',
    revision: 1,
    evaluationNodeId: 'demo-node',
    personIds: ['demo-person'],
    projectId: 'demo-project',
    status: 'processing',
    jobId: null,
    files: [parsed, processing, waiting],
    textMaterial: null,
    items: [review],
    draftSet: {
      batchId: 'demo-batch',
      revision: 1,
      drafts: [draft],
      duplicateCandidates: [],
    },
    confirmedDrafts: [confirmed],
    error: null,
    counts: {
      files: {
        total: 3,
        processing: 1,
        parsed: 1,
        needs_review: 1,
        unsupported: 0,
        failed: 0,
        original_only: 0,
        attachment_only: 0,
      },
      events: { total: 2, awaiting_confirmation: 1, confirmed: 1 },
      reviewItems: 1,
    },
  };
}

describe('11/1 owner ruling: independent material receipt progress', () => {
  it('keeps the prototype summary label independent from confirmable events', () => {
    const value = mixedReceipt();
    const waitingForReview = {
      ...value,
      status: 'needs_review',
      files: [parsed, waiting],
      counts: {
        ...value.counts,
        files: { ...value.counts.files, total: 2, processing: 0 },
      },
    };
    expect(materialBatchReceiptSchema.parse(waitingForReview)).toEqual(
      waitingForReview,
    );
    expect(waitingForReview.counts.events.awaiting_confirmation).toBe(1);
    expect(
      materialBatchReceiptSchema.safeParse({
        ...waitingForReview,
        status: 'completed',
      }).success,
    ).toBe(false);
  });

  it('supports unresolved inline text without pretending it is an uploaded file', () => {
    const item = {
      ...materialReviewItemsFixture[1],
      materialId: 'inline-text',
      originalVersionId: 'inline-v1',
    };
    const value = {
      ...mixedReceipt(),
      status: 'needs_review',
      personIds: [],
      projectId: null,
      files: [],
      textMaterial: {
        materialId: 'inline-text',
        originalVersionId: 'inline-v1',
      },
      items: [item],
      draftSet: null,
      confirmedDrafts: [],
      counts: {
        files: {
          total: 0,
          processing: 0,
          parsed: 0,
          needs_review: 0,
          unsupported: 0,
          failed: 0,
          original_only: 0,
          attachment_only: 0,
        },
        events: { total: 0, awaiting_confirmation: 0, confirmed: 0 },
        reviewItems: 1,
      },
    };
    expect(materialBatchReceiptSchema.parse(value)).toEqual(value);
    expect(
      materialBatchReceiptSchema.safeParse({ ...value, textMaterial: null })
        .success,
    ).toBe(false);
    const mixed = mixedReceipt();
    expect(
      materialBatchReceiptSchema.safeParse({
        ...mixed,
        textMaterial: {
          materialId: parsed.materialId,
          originalVersionId: parsed.originalVersionId,
        },
      }).success,
    ).toBe(false);
  });

  it('preserves explicit project input and per-event project attribution', () => {
    const input = { ...materialBatchInputFixture, projectId: 'demo-project' };
    expect(materialBatchInputSchema.parse(input)).toEqual(input);
    expect(
      materialBatchInputSchema.parse({ ...input, projectId: null }).projectId,
    ).toBeNull();
    expect(recordBatchDraftSchema.parse(draft).projectId).toBe('demo-project');
    for (const projectId of ['', ' ', 1, { state: 'needs_selection' }]) {
      expect(
        recordBatchDraftSchema.safeParse({ ...draft, projectId }).success,
      ).toBe(false);
      expect(
        materialBatchInputSchema.safeParse({ ...input, projectId }).success,
      ).toBe(false);
    }
  });

  it('allows one confirmed event and one confirmable event while files and review remain open', () => {
    const value = mixedReceipt();
    expect(materialBatchReceiptSchema.parse(value)).toEqual(value);
    // Counts have explicit units; a review item is neither an event nor a file.
    expect(value.counts.events).toEqual({
      total: 2,
      awaiting_confirmation: 1,
      confirmed: 1,
    });
  });

  it('rejects stale counters rather than maintaining a second truth', () => {
    const value = mixedReceipt();
    for (const counts of [
      { ...value.counts, files: { ...value.counts.files, processing: 0 } },
      { ...value.counts, events: { ...value.counts.events, confirmed: 2 } },
      { ...value.counts, reviewItems: 0 },
      { ...value.counts, events: { ...value.counts.events, total: 99 } },
    ])
      expect(
        materialBatchReceiptSchema.safeParse({ ...value, counts }).success,
      ).toBe(false);
  });

  it('reports completed only after all file work, reviews and event confirmations settle', () => {
    const value = mixedReceipt();
    const completed = {
      ...value,
      status: 'completed',
      files: [parsed],
      items: [],
      draftSet: null,
      confirmedDrafts: [confirmed],
      counts: {
        files: {
          total: 1,
          processing: 0,
          parsed: 1,
          needs_review: 0,
          unsupported: 0,
          failed: 0,
          original_only: 0,
          attachment_only: 0,
        },
        events: { total: 1, awaiting_confirmation: 0, confirmed: 1 },
        reviewItems: 0,
      },
    };
    expect(materialBatchReceiptSchema.parse(completed)).toEqual(completed);
    expect(
      materialBatchReceiptSchema.safeParse({ ...value, status: 'completed' })
        .success,
    ).toBe(false);
    expect(
      materialBatchReceiptSchema.safeParse({
        ...completed,
        jobId: 'still-running',
      }).success,
    ).toBe(false);
  });

  it('does not double count the same draft or accept foreign confirmation identities', () => {
    const value = mixedReceipt();
    const twoCounts = {
      ...value.counts,
      events: { total: 3, awaiting_confirmation: 1, confirmed: 2 },
    };
    expect(
      materialBatchReceiptSchema.safeParse({
        ...value,
        confirmedDrafts: [confirmed, confirmed],
        counts: twoCounts,
      }).success,
    ).toBe(false);
    expect(
      materialBatchReceiptSchema.safeParse({
        ...value,
        confirmedDrafts: [
          confirmed,
          { ...confirmed, draftId: 'different-id-same-event' },
        ],
        counts: twoCounts,
      }).success,
    ).toBe(false);
    for (const patch of [
      { confirmedDrafts: [{ ...confirmed, draftId: draft.draftId }] },
      {
        confirmedDrafts: [
          { ...confirmed, events: [{ personId: 'outside', eventId: 'other' }] },
        ],
      },
      { draftSet: { ...value.draftSet, revision: 99 } },
      {
        draftSet: {
          ...value.draftSet,
          drafts: [{ ...draft, evaluationNodeId: 'outside-node' }],
        },
      },
    ])
      expect(
        materialBatchReceiptSchema.safeParse({ ...value, ...patch }).success,
      ).toBe(false);
  });

  it('keeps unresolved identity and scope free of AI draft payloads', () => {
    const value = mixedReceipt();
    expect(
      materialReviewItemSchema.safeParse({
        ...review,
        sbi: draft.sbi,
        scores: draft.scores,
      }).success,
    ).toBe(false);
    expect(
      materialBatchReceiptSchema.safeParse({ ...value, personIds: [] }).success,
    ).toBe(false);
    expect(
      recordBatchDraftSchema.safeParse({ ...draft, personIds: [] }).success,
    ).toBe(false);
  });

  it('links every review to the current file, version, batch and node', () => {
    const value = mixedReceipt();
    for (const patch of [
      { items: [{ ...review, batchId: 'elsewhere' }] },
      { items: [{ ...review, evaluationNodeId: 'elsewhere' }] },
      { items: [{ ...review, materialId: 'missing-file' }] },
      { items: [] },
      { files: [{ ...waiting, reviewItemIds: ['unknown-review'] }] },
      { files: [parsed, parsed] },
    ])
      expect(
        materialBatchReceiptSchema.safeParse({ ...value, ...patch }).success,
      ).toBe(false);
  });
});

describe('11/1 owner ruling: original-only and attachment-only resolutions', () => {
  it('accepts outside-directory original retention without inventing a directory person', () => {
    const value = {
      ...command,
      kind: 'unknown_person',
      resolution: { action: 'keep_original_only' },
    };
    expect(materialReviewCommandSchema.parse(value)).toEqual(value);
    expect(
      materialReviewCommandSchema.safeParse({
        ...value,
        resolution: { action: 'keep_original_only', personId: 'invented' },
      }).success,
    ).toBe(false);
    expect(
      materialFileReceiptSchema.parse({
        materialId: 'document',
        clientFileId: 'doc-file',
        filename: '演示.txt',
        originalVersionId: 'demo-document-v1',
        status: 'original_only',
      }),
    ).toBeDefined();
  });

  it('accepts a whole-image attachment without a model disclosure permission flag', () => {
    const value = {
      ...command,
      kind: 'image_scope',
      resolution: { action: 'keep_attachment_only' },
    };
    expect(materialReviewCommandSchema.parse(value)).toEqual(value);
    expect(
      materialReviewCommandSchema.safeParse({ ...value, authorized: true })
        .success,
    ).toBe(false);
    expect(
      materialReviewCommandSchema.safeParse({
        ...value,
        resolution: { ...value.resolution, personIds: ['outside'] },
      }).success,
    ).toBe(false);
    const file = {
      materialId: 'image',
      clientFileId: 'image-file',
      filename: '演示.png',
      originalVersionId: 'demo-image-v1',
      status: 'attachment_only',
    };
    expect(materialFileReceiptSchema.parse(file)).toEqual(file);
    expect(
      materialFileReceiptSchema.safeParse({ ...file, originalVersionId: null })
        .success,
    ).toBe(false);
  });

  it('never enqueues arranging for original-only, attachment-only, defer or unbind outcomes', () => {
    for (const [kind, action] of [
      ['unknown_person', 'keep_original_only'],
      ['image_scope', 'keep_attachment_only'],
      ['speaker', 'defer'],
      ['speaker', 'unbind'],
    ]) {
      const value = { ...resolution, kind, resolution: { action } };
      expect(
        materialReviewResolutionReceiptSchema.parse(value).resume,
      ).toBeNull();
      expect(
        materialReviewResolutionReceiptSchema.safeParse({
          ...value,
          resume: {
            stage: kind === 'image_scope' ? 'image_scope_check' : 'organizing',
            jobId: 'must-not-run',
          },
        }).success,
      ).toBe(false);
    }
  });

  it('can finish an original-only batch without producing any event or AI suggestion', () => {
    const file = {
      materialId: 'original',
      clientFileId: 'original-file',
      filename: '演示.txt',
      originalVersionId: 'original-v1',
      status: 'original_only',
    };
    const value = {
      ...mixedReceipt(),
      status: 'completed',
      personIds: [],
      files: [file],
      items: [],
      draftSet: null,
      confirmedDrafts: [],
      counts: {
        files: {
          total: 1,
          processing: 0,
          parsed: 0,
          needs_review: 0,
          unsupported: 0,
          failed: 0,
          original_only: 1,
          attachment_only: 0,
        },
        events: { total: 0, awaiting_confirmation: 0, confirmed: 0 },
        reviewItems: 0,
      },
    };
    expect(materialBatchReceiptSchema.parse(value)).toEqual(value);
  });
});

describe('11/1 owner ruling: project and interview candidate review', () => {
  it('represents a project review and only existing authorized project lookup choices', () => {
    const item = {
      ...review,
      kind: 'unknown_project',
      itemId: 'project-review',
      source: null,
      proposedRegion: undefined,
      observedName: '演示课题',
      candidates: [{ projectId: 'demo-project', displayName: '演示课题甲' }],
    };
    delete item.proposedRegion;
    expect(materialReviewItemSchema.parse(item)).toEqual(item);
    const link = {
      ...command,
      kind: 'unknown_project',
      resolution: {
        action: 'link_existing_project',
        projectId: 'demo-project',
      },
    };
    expect(materialReviewCommandSchema.parse(link)).toEqual(link);
    expect(
      materialReviewCommandSchema.parse({
        ...link,
        resolution: { action: 'mark_no_project' },
      }),
    ).toBeDefined();
    expect(
      materialReviewCommandSchema.safeParse({
        ...link,
        resolution: { action: 'create_project', name: 'new' },
      }).success,
    ).toBe(false);
  });

  it('gives unknown interview candidates an HR-owned route back to the same import row', () => {
    const item = {
      ...materialReviewItemsFixture[3],
      kind: 'unknown_interview_candidate',
      itemId: 'candidate-review',
      observedName: null,
    };
    expect(materialReviewItemSchema.parse(item)).toEqual(item);
    expect(MATERIAL_REVIEW_POLICIES).toHaveProperty(
      'unknown_interview_candidate',
      { resolver: 'scoped_hr', resumeAt: 'interview_import', owner: 'BOW-906' },
    );
    const value = {
      ...command,
      kind: 'unknown_interview_candidate',
      resolution: {
        action: 'link_existing_candidate',
        personId: 'demo-person',
      },
    };
    expect(materialReviewCommandSchema.parse(value)).toEqual(value);
    expect(
      materialReviewItemSchema.safeParse({
        ...item,
        source: materialReferencesFixture.document,
        originalVersionId: materialReferencesFixture.document.originalVersionId,
      }).success,
    ).toBe(false);
    expect(
      materialReviewItemSchema.safeParse({ ...item, importRowId: undefined })
        .success,
    ).toBe(false);
    expect(
      materialReviewCommandSchema.safeParse({
        ...value,
        resolution: { action: 'relink_imported', personId: 'other' },
      }).success,
    ).toBe(false);
    const originalOnly = {
      ...value,
      resolution: { action: 'keep_original_only' },
    };
    expect(materialReviewCommandSchema.parse(originalOnly)).toEqual(
      originalOnly,
    );
    const locked = {
      status: 'conflict',
      message: '关联已随导入保存，更正须先撤销导入',
      input: value,
    };
    expect(materialReviewCommandResultSchema.parse(locked)).toEqual(locked);
  });

  it('resumes only the unblocked target even when a different file still needs review', () => {
    const value = {
      ...resolution,
      materialId: 'document',
      kind: 'unknown_person',
      resolution: { action: 'bind_people', personIds: ['demo-person'] },
      remainingReviewItemIds: ['other-file-review'],
      resume: { stage: 'organizing', jobId: 'scoped-job' },
    };
    expect(materialReviewResolutionReceiptSchema.parse(value)).toEqual(value);
    expect(
      materialReviewResolutionReceiptSchema.safeParse({
        ...value,
        blockingReviewItemIds: ['other-file-review'],
      }).success,
    ).toBe(false);
    expect(
      materialReviewResolutionReceiptSchema.safeParse({
        ...value,
        blockingReviewItemIds: ['not-in-remaining'],
      }).success,
    ).toBe(false);
  });
});
