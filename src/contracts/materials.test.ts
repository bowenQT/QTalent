import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  materialImageRegionSchema,
  materialSourceLocationSchema,
  materialSourceReferenceSchema,
  materialSourceSchema,
  materialSourceReadResultSchema,
  type MaterialSource,
  type MaterialSourceReadResult,
} from './sources';
import {
  materialExtractionResultSchema,
  materialUploadRequestSchema,
  materialRequestUploadResultSchema,
  MAX_ATTACHMENTS,
} from './media';
import {
  recordBatchDraftSchema,
  recordBatchDraftSetSchema,
  recordBatchDuplicateDecisionInputSchema,
  recordBatchDuplicateDecisionResultSchema,
} from './record';
import {
  MATERIAL_REVIEW_POLICIES,
  materialReviewItemSchema,
  materialReviewCommandSchema,
  materialReviewResolutionReceiptSchema,
  materialReviewCommandResultSchema,
} from './material-review';
import {
  materialBatchInputSchema,
  materialFileReceiptSchema,
  materialBatchReceiptSchema,
  materialBatchReadInputSchema,
  materialBatchSubmitResultSchema,
  materialBatchReadResultSchema,
} from './materials';
import {
  materialReferencesFixture as references,
  materialSourcesFixture as sources,
  materialBatchInputFixture as input,
  recordBatchDraftFixture as draft,
  recordBatchDraftSetFixture as draftSet,
  materialReviewItemsFixture as reviews,
} from './materials.fixtures';

const parsedFile = {
  materialId: 'demo-material-a',
  clientFileId: 'demo-file-a',
  filename: '演示材料.txt',
  originalVersionId: 'demo-document-v1',
  status: 'parsed',
  parseVersionId: 'demo-parse-v1',
};
const unsupportedFile = {
  materialId: 'demo-material-b',
  clientFileId: 'demo-file-b',
  filename: '演示未知格式.bin',
  originalVersionId: null,
  status: 'unsupported',
  reason: 'format',
  message: '暂不支持这种格式',
};
const batch = {
  batchId: 'demo-batch',
  revision: 1,
  evaluationNodeId: 'demo-node',
  personIds: ['demo-person'],
  files: [parsedFile],
};
const ready = { ...batch, status: 'awaiting_confirmation', draftSet };
const duplicate = {
  candidateId: 'demo-duplicate',
  draftIds: draftSet.drafts.map((entry) => entry.draftId),
  reason: '演示：可能描述同一次行为，请核对',
};
const duplicateInput = {
  batchId: 'demo-batch',
  operationId: 'demo-duplicate-decision',
  expectedRevision: 1,
  candidateId: duplicate.candidateId,
  drafts: draftSet.drafts.map((entry) => ({
    draftId: entry.draftId,
    expectedRevision: entry.revision,
  })),
  decision: { action: 'merge', canonicalDraftId: draft.draftId },
};
const reviewCommand = {
  operationId: 'demo-resolve',
  batchId: 'demo-batch',
  itemId: 'demo-speaker-review',
  expectedRevision: 1,
  kind: 'speaker',
  resolution: { action: 'bind', personId: 'demo-person' },
};
const resolutionReceipt = {
  batchId: 'demo-batch',
  itemId: 'demo-speaker-review',
  revision: 2,
  remainingReviewItemIds: [],
  invalidatedDraftIds: [draft.draftId],
  kind: 'speaker',
  resume: { stage: 'organizing', jobId: 'demo-resumed-job' },
};

describe('BOW-897 unassigned material intake', () => {
  it('accepts multiple uploads without selecting a person, and text-only intake', () => {
    expect(materialBatchInputSchema.parse(input)).toEqual(input);
    const textOnly = { ...input, text: ' 演示：保留输入。 ', files: [] };
    expect(materialBatchInputSchema.parse(textOnly)).toEqual(textOnly);
    expect(
      materialBatchInputSchema.parse({ ...input, personIds: ['demo-person'] })
        .personIds,
    ).toEqual(['demo-person']);
  });
  it('declares private unassigned uploads without widening the legacy format endpoint', () => {
    const upload = {
      purpose: 'image',
      recordCollectionId: 'demo-staging-collection',
      filename: '演示图片.png',
      declaredBytes: 200,
      declaredMediaType: 'image/png',
      target: { kind: 'unassigned', evaluationNodeId: 'demo-node' },
      operationId: 'demo-upload-request',
    };
    expect(materialUploadRequestSchema.parse(upload)).toEqual(upload);
    expect(
      materialUploadRequestSchema.safeParse({
        ...upload,
        target: { kind: 'people', personIds: [] },
      }).success,
    ).toBe(false);
    expect(
      materialUploadRequestSchema.safeParse({ ...upload, authorized: true })
        .success,
    ).toBe(false);
    expect(
      materialUploadRequestSchema.safeParse({ ...upload, declaredBytes: 0 })
        .success,
    ).toBe(false);
    const unsupported = {
      status: 'unsupported',
      reason: 'format',
      message: '暂不支持这种格式',
    };
    expect(materialRequestUploadResultSchema.parse(unsupported)).toEqual(
      unsupported,
    );
    expect(
      materialRequestUploadResultSchema.parse({
        status: 'unavailable',
        message: '上传服务暂不可用',
      }).status,
    ).toBe('unavailable');
  });
  it('rejects empty submissions, duplicate file identities and client authority', () => {
    for (const patch of [
      { text: '   ', files: [] },
      { personIds: ['demo-person', 'demo-person'] },
      { files: [input.files[0], input.files[0]] },
      {
        files: [
          input.files[0],
          { ...input.files[1], uploadId: input.files[0].uploadId },
        ],
      },
      {
        files: [
          input.files[0],
          { ...input.files[1], clientFileId: input.files[0].clientFileId },
        ],
      },
      {
        files: Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, n) => ({
          clientFileId: `demo-file-${n}`,
          uploadId: `demo-upload-${n}`,
        })),
      },
      { evaluationNodeId: ' ' },
      { actorId: 'client-selected-actor' },
      { role: 'hr' },
      { files: [{ ...input.files[0], storageKey: 'client-selected-object' }] },
    ])
      expect(
        materialBatchInputSchema.safeParse({ ...input, ...patch }).success,
      ).toBe(false);
  });
  it('preserves the submitted input on request-key or version conflicts', () => {
    const conflict = {
      status: 'conflict',
      message: '同一请求标识的内容已变化',
      input,
    };
    expect(materialBatchSubmitResultSchema.parse(conflict)).toEqual(conflict);
    expect(
      materialBatchSubmitResultSchema.safeParse({ ...conflict, result: ready })
        .success,
    ).toBe(false);
    const replay = { status: 'success', replayed: true, result: ready };
    expect(materialBatchSubmitResultSchema.parse(replay)).toEqual(replay);
    const read = { batchId: batch.batchId };
    expect(materialBatchReadInputSchema.parse(read)).toEqual(read);
    expect(materialBatchReadResultSchema.parse(replay)).toEqual(replay);
    expect(
      materialBatchReadInputSchema.safeParse({ ...read, role: 'hr' }).success,
    ).toBe(false);
  });
});

describe('BOW-897 versioned locators and provenance', () => {
  it('keeps the inferred source-read success type equal to the runtime contract', () => {
    expectTypeOf<
      Extract<MaterialSourceReadResult, { status: 'success' }>['source']
    >().toEqualTypeOf<MaterialSource>();
  });
  it.each(Object.entries(references))(
    'resolves the %s locator without a live URL',
    (_, source) => {
      expect(materialSourceLocationSchema.parse(source.location)).toEqual(
        source.location,
      );
      expect(materialSourceReferenceSchema.parse(source)).toEqual(source);
    },
  );
  it('rejects absent, inverted, out-of-bounds or moving locators', () => {
    for (const location of [
      { kind: 'document', paragraph: ' ' },
      { kind: 'pdf', page: 0, textRange: { start: 0, end: 1 } },
      { kind: 'pdf', page: 1 },
      { kind: 'pdf', page: 1, textRange: { start: 4, end: 4 } },
      { kind: 'spreadsheet', sheet: '', cell: 'B3' },
      { kind: 'presentation', slide: 0 },
      { kind: 'recording', startMs: 10, endMs: 2 },
      { kind: 'video', startMs: 10, endMs: 2 },
      { kind: 'video', startMs: -1, endMs: 2 },
      { kind: 'image', region: { left: 0, top: 0, right: 2, bottom: 1 } },
      { kind: 'image', region: { left: 0.5, top: 0, right: 0.5, bottom: 1 } },
      { ...references.code.location, commit: 'main' },
      { ...references.code.location, path: '../other.ts' },
      { ...references.code.location, path: '/src/demo.ts' },
      { ...references.code.location, path: 'src//demo.ts' },
      { ...references.code.location, path: 'src/./demo.ts' },
      { ...references.code.location, path: 'src\\demo.ts' },
      { ...references.code.location, path: 'src/\0demo.ts' },
      { ...references.code.location, startLine: 7, endLine: 6 },
      { kind: 'snapshot_field', fieldPath: 'prototype-only' },
    ])
      expect(materialSourceLocationSchema.safeParse(location).success).toBe(
        false,
      );
    expect(
      materialSourceReferenceSchema.safeParse({ quote: '演示摘录' }).success,
    ).toBe(false);
    expect(
      materialSourceReferenceSchema.safeParse({
        ...references.document,
        originalVersionId: '',
      }).success,
    ).toBe(false);
  });
  it('keeps imported interviews and submitted code separate from prototype baselines', () => {
    for (const source of sources) {
      expect(materialSourceSchema.parse(source)).toEqual(source);
      expect(
        materialSourceReadResultSchema.parse({ status: 'success', source }),
      ).toEqual({
        status: 'success',
        source,
      });
    }
    const interview = sources[1];
    for (const patch of [
      { sourceCategory: 'prototype_baseline' },
      { location: references.document.location },
      { evaluationKind: 'dimension_score' },
    ])
      expect(
        materialSourceSchema.safeParse({ ...interview, ...patch }).success,
      ).toBe(false);
    const code = sources[7];
    for (const patch of [
      { sourceCategory: 'original' },
      { displayNotice: undefined },
      { displayNotice: '服务器已核验仓库原文' },
      { excerpt: ' ' },
      { repositoryVerified: true },
      { location: references.document.location },
    ])
      expect(
        materialSourceSchema.safeParse({ ...code, ...patch }).success,
      ).toBe(false);
    expect(
      materialSourceSchema.safeParse({
        ...sources[0],
        location: references.code.location,
      }).success,
    ).toBe(false);
    expect(
      materialSourceReadResultSchema.parse({
        status: 'not_found',
        message: '原文不可用',
      }).status,
    ).toBe('not_found');
    expect(
      materialSourceReadResultSchema.safeParse({
        status: 'forbidden',
        message: '无权访问',
        source: sources[0],
      }).success,
    ).toBe(false);
  });
  it('never treats an empty extraction as success or hides an unsupported file', () => {
    for (const source of sources) {
      const parsed = {
        status: 'parsed',
        parseVersionId: 'demo-parse',
        originalVersionId: source.originalVersionId,
        fragments: [source],
      };
      expect(materialExtractionResultSchema.parse(parsed)).toEqual(parsed);
      expect(
        materialExtractionResultSchema.safeParse({ ...parsed, fragments: [] })
          .success,
      ).toBe(false);
      expect(
        materialExtractionResultSchema.safeParse({
          ...parsed,
          fragments: [source, source],
        }).success,
      ).toBe(false);
      expect(
        materialExtractionResultSchema.safeParse({
          ...parsed,
          originalVersionId: 'other-version',
        }).success,
      ).toBe(false);
    }
    for (const failure of [
      { status: 'unsupported', reason: 'scanned', message: '暂不支持扫描件' },
      {
        status: 'failed',
        code: 'invalid_content',
        message: '材料无法读取',
        retryable: false,
      },
    ]) {
      expect(materialExtractionResultSchema.parse(failure)).toEqual(failure);
      expect(
        materialExtractionResultSchema.safeParse({ ...failure, fragments: [] })
          .success,
      ).toBe(false);
    }
  });
});

describe('BOW-897 multi-event drafts and in-batch deduplication', () => {
  it('keeps two events for one person and one event with a union of sources', () => {
    const two = recordBatchDraftSetSchema.parse(draftSet);
    expect(two.drafts.map((entry) => entry.draftId)).toEqual([
      'demo-event-draft-a',
      'demo-event-draft-b',
    ]);
    expect(two.drafts.map((entry) => entry.personIds)).toEqual([
      ['demo-person'],
      ['demo-person'],
    ]);
    const sameEvent = {
      ...draft,
      sourceReferences: [references.document, references.recording],
    };
    expect(recordBatchDraftSchema.parse(sameEvent).sourceReferences).toEqual([
      references.document,
      references.recording,
    ]);
    const pending = { ...draftSet, duplicateCandidates: [duplicate] };
    expect(recordBatchDraftSetSchema.parse(pending)).toEqual(pending);
    expect(
      materialBatchReceiptSchema.parse({ ...ready, draftSet: pending }),
    ).toEqual({
      ...ready,
      draftSet: pending,
    });
  });
  it('requires stable identities, unique source sets, and source-backed suggestions', () => {
    const scored = draft.scores[0];
    for (const patch of [
      { draftId: '' },
      { revision: 0 },
      { origin: 'human_conclusion' },
      { personIds: [] },
      { personIds: ['demo-person', 'demo-person'] },
      { sourceReferences: [] },
      { sourceReferences: [references.document, references.document] },
      { sourceReferences: [references.recording] },
      { dimensionVersionId: '' },
      { anchorVersionId: '' },
      { anchorVersionId: 'another-anchor-version' },
      { scores: [{ ...scored, personId: 'other-person' }] },
      { scores: [scored, scored] },
      { totalScore: 95 },
      { confidence: 0.99 },
    ])
      expect(
        recordBatchDraftSchema.safeParse({ ...draft, ...patch }).success,
      ).toBe(false);
    const changedLocator = {
      ...references.document,
      location: { kind: 'document', paragraph: '99' },
    };
    expect(
      recordBatchDraftSchema.safeParse({
        ...draft,
        scores: [
          {
            ...scored,
            citations: [
              { kind: 'source', quote: '演示', reference: changedLocator },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      recordBatchDraftSchema.safeParse({
        ...draft,
        scores: [{ ...draft.scores[1], value: 1 }],
      }).success,
    ).toBe(false);
  });
  it('rejects duplicate, foreign or overlapping event references', () => {
    for (const patch of [
      { drafts: [] },
      { drafts: [draft, draft] },
      { drafts: [{ ...draft, batchId: 'other-batch' }] },
      {
        duplicateCandidates: [
          { ...duplicate, draftIds: [draft.draftId, 'missing-draft'] },
        ],
      },
      {
        duplicateCandidates: [
          { ...duplicate, draftIds: [draft.draftId, draft.draftId] },
        ],
      },
      { duplicateCandidates: [duplicate, duplicate] },
      {
        duplicateCandidates: [
          duplicate,
          { ...duplicate, candidateId: 'overlap' },
        ],
      },
    ])
      expect(
        recordBatchDraftSetSchema.safeParse({ ...draftSet, ...patch }).success,
      ).toBe(false);
  });
  it('makes similarity a versioned human choice and preserves conflict input', () => {
    for (const decision of [
      duplicateInput.decision,
      { action: 'keep_separate' },
    ])
      expect(
        recordBatchDuplicateDecisionInputSchema.parse({
          ...duplicateInput,
          decision,
        }).decision,
      ).toEqual(decision);
    for (const patch of [
      { expectedRevision: undefined },
      { drafts: [{ draftId: draft.draftId }] },
      { drafts: [duplicateInput.drafts[0], duplicateInput.drafts[0]] },
      { decision: { action: 'merge', canonicalDraftId: 'unrelated-draft' } },
      { autoMerge: true },
    ])
      expect(
        recordBatchDuplicateDecisionInputSchema.safeParse({
          ...duplicateInput,
          ...patch,
        }).success,
      ).toBe(false);
    const conflict = {
      status: 'conflict',
      message: '草稿版本已变化，请保留修改并刷新',
      input: duplicateInput,
    };
    expect(recordBatchDuplicateDecisionResultSchema.parse(conflict)).toEqual(
      conflict,
    );
    const merged = {
      ...draftSet,
      revision: 2,
      drafts: [
        {
          ...draft,
          revision: 2,
          sourceReferences: [references.document, references.recording],
        },
      ],
    };
    const replay = { status: 'success', replayed: true, result: merged };
    expect(recordBatchDuplicateDecisionResultSchema.parse(replay)).toEqual(
      replay,
    );
  });
});

describe('BOW-897 review types, permissions and recovery', () => {
  it('exposes four pending review kinds, existing-directory candidates and explicit policy', () => {
    for (const item of reviews) {
      expect(materialReviewItemSchema.parse(item)).toEqual(item);
      expect(
        materialReviewItemSchema.parse({ ...item, state: 'deferred' }).state,
      ).toBe('deferred');
    }
    expect(MATERIAL_REVIEW_POLICIES).toEqual({
      speaker: {
        resolver: 'current_node_evaluator_or_scoped_manager_or_hr',
        resumeAt: 'organizing',
        owner: 'BOW-860',
      },
      unknown_person: {
        resolver: 'current_node_evaluator_or_scoped_manager_or_hr',
        resumeAt: 'organizing',
        owner: 'BOW-905',
      },
      image_scope: {
        resolver: 'current_node_evaluator_or_scoped_manager_or_hr',
        resumeAt: 'image_scope_check',
        owner: 'BOW-905',
      },
      unknown_interviewer: {
        resolver: 'scoped_hr',
        resumeAt: 'interview_import',
        owner: 'BOW-906',
      },
    });
    const speaker = reviews[0];
    for (const patch of [
      { originalVersionId: 'other-version' },
      { source: null },
      {
        candidates: [
          { personId: 'p', displayName: '演示甲' },
          { personId: 'p', displayName: '演示乙' },
        ],
      },
      {
        source: references.document,
        originalVersionId: references.document.originalVersionId,
      },
      { state: 'resolved' },
      { role: 'hr' },
    ])
      expect(
        materialReviewItemSchema.safeParse({ ...speaker, ...patch }).success,
      ).toBe(false);
    expect(
      materialReviewItemSchema.safeParse({
        ...speaker,
        source: references.video,
        originalVersionId: references.video.originalVersionId,
      }).success,
    ).toBe(true);
    expect(
      materialReviewItemSchema.safeParse({
        ...reviews[2],
        source: references.document,
        originalVersionId: references.document.originalVersionId,
      }).success,
    ).toBe(false);
  });
  it('accepts only each type’s recovery action and versioned request identity', () => {
    const actions = [
      {
        kind: 'speaker',
        resolution: { action: 'bind', personId: 'demo-person' },
      },
      { kind: 'speaker', resolution: { action: 'mark_irrelevant' } },
      { kind: 'speaker', resolution: { action: 'unbind' } },
      {
        kind: 'unknown_person',
        resolution: { action: 'bind_people', personIds: ['demo-person'] },
      },
      {
        kind: 'image_scope',
        resolution: {
          action: 'confirm_scope',
          region: references.image.location.region,
          personIds: ['demo-person'],
        },
      },
      {
        kind: 'unknown_interviewer',
        resolution: {
          action: 'link_existing_interviewer',
          personId: 'demo-interviewer',
        },
      },
    ];
    for (const action of actions) {
      const command = { ...reviewCommand, ...action };
      expect(materialReviewCommandSchema.parse(command)).toEqual(command);
    }
    for (const kind of Object.keys(MATERIAL_REVIEW_POLICIES)) {
      const command = {
        ...reviewCommand,
        kind,
        resolution: { action: 'defer' },
      };
      expect(materialReviewCommandSchema.parse(command)).toEqual(command);
    }
    for (const patch of [
      { expectedRevision: 0 },
      { operationId: '' },
      { actorId: 'client-actor' },
      { resolution: { action: 'bind' } },
      {
        kind: 'unknown_interviewer',
        resolution: { action: 'create_person', name: '演示面试官' },
      },
      {
        kind: 'unknown_person',
        resolution: { action: 'bind_people', personIds: [] },
      },
      {
        kind: 'image_scope',
        resolution: {
          action: 'confirm_scope',
          personIds: ['p', 'p'],
          region: references.image.location.region,
        },
      },
      {
        kind: 'image_scope',
        resolution: {
          action: 'confirm_scope',
          personIds: ['p'],
          region: references.image.location.region,
          authorized: true,
        },
      },
    ])
      expect(
        materialReviewCommandSchema.safeParse({ ...reviewCommand, ...patch })
          .success,
      ).toBe(false);
    expect(
      materialImageRegionSchema.safeParse({
        left: 0,
        top: 1,
        right: 1,
        bottom: 0,
      }).success,
    ).toBe(false);
  });
  it('resumes at the owning step only after all blocking reviews are resolved', () => {
    for (const [kind, policy] of Object.entries(MATERIAL_REVIEW_POLICIES)) {
      const receipt = {
        ...resolutionReceipt,
        kind,
        resume: { stage: policy.resumeAt, jobId: 'demo-resumed-job' },
      };
      expect(materialReviewResolutionReceiptSchema.parse(receipt)).toEqual(
        receipt,
      );
      expect(
        materialReviewResolutionReceiptSchema.safeParse({
          ...receipt,
          remainingReviewItemIds: ['pending-review'],
        }).success,
      ).toBe(false);
      expect(
        materialReviewResolutionReceiptSchema.parse({
          ...receipt,
          resume: null,
          remainingReviewItemIds: ['pending-review'],
        }).resume,
      ).toBeNull();
    }
    expect(
      materialReviewResolutionReceiptSchema.safeParse({
        ...resolutionReceipt,
        resume: { stage: 'interview_import', jobId: 'wrong-job' },
      }).success,
    ).toBe(false);
    expect(
      materialReviewResolutionReceiptSchema.safeParse({
        ...resolutionReceipt,
        invalidatedDraftIds: ['d', 'd'],
      }).success,
    ).toBe(false);
    const replay = {
      status: 'success',
      replayed: true,
      result: resolutionReceipt,
    };
    expect(materialReviewCommandResultSchema.parse(replay)).toEqual(replay);
    const conflict = {
      status: 'conflict',
      input: reviewCommand,
      message: '条目版本已变化',
    };
    expect(materialReviewCommandResultSchema.parse(conflict)).toEqual(conflict);
    expect(
      materialReviewCommandResultSchema.safeParse({
        status: 'forbidden',
        message: '无权处理',
        result: resolutionReceipt,
      }).success,
    ).toBe(false);
  });
});

describe('BOW-897 truthful aggregate receipts', () => {
  it('represents processing, review, confirmation and failure without invented content', () => {
    const processing = {
      ...batch,
      personIds: [],
      status: 'processing',
      jobId: 'demo-job',
    };
    const pending = {
      ...batch,
      personIds: [],
      status: 'needs_review',
      items: reviews,
    };
    const failed = {
      ...batch,
      files: [unsupportedFile],
      status: 'failed',
      code: 'all_materials_unusable',
      message: '本批材料暂无法处理',
      retryable: false,
    };
    for (const receipt of [processing, pending, ready, failed])
      expect(materialBatchReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(
      materialBatchReceiptSchema.parse({
        ...ready,
        files: [parsedFile, unsupportedFile],
      }).files,
    ).toEqual([parsedFile, unsupportedFile]);
    expect(
      materialBatchReceiptSchema.safeParse({
        ...pending,
        sbi: draft.sbi,
        scores: [],
      }).success,
    ).toBe(false);
    expect(
      materialBatchReceiptSchema.safeParse({ ...ready, personIds: [] }).success,
    ).toBe(false);
    expect(
      materialBatchReceiptSchema.safeParse({
        ...ready,
        draftSet: { ...draftSet, revision: 2 },
      }).success,
    ).toBe(false);
    expect(
      materialBatchReceiptSchema.safeParse({
        ...ready,
        evaluationNodeId: 'other-node',
      }).success,
    ).toBe(false);
    expect(
      materialBatchReceiptSchema.safeParse({
        ...ready,
        personIds: ['other-person'],
      }).success,
    ).toBe(false);
  });
  it('keeps file-specific failures and review references explicit', () => {
    for (const file of [
      parsedFile,
      unsupportedFile,
      {
        ...parsedFile,
        status: 'processing',
        jobId: 'demo-file-job',
        parseVersionId: undefined,
      },
      {
        ...unsupportedFile,
        status: 'failed',
        reason: undefined,
        code: 'invalid_content',
        retryable: false,
      },
      {
        ...parsedFile,
        status: 'needs_review',
        parseVersionId: undefined,
        reviewItemIds: [reviews[0].itemId],
      },
    ]) {
      const wire = Object.fromEntries(
        Object.entries(file).filter(([, value]) => value !== undefined),
      );
      expect(materialFileReceiptSchema.parse(wire)).toEqual(wire);
    }
    expect(
      materialFileReceiptSchema.safeParse({
        ...parsedFile,
        originalVersionId: null,
      }).success,
    ).toBe(false);
    expect(
      materialBatchReceiptSchema.safeParse({
        ...ready,
        files: [parsedFile, parsedFile],
      }).success,
    ).toBe(false);
    const waitingFile = {
      materialId: 'demo-material-a',
      clientFileId: 'demo-file-a',
      filename: '演示材料',
      originalVersionId: 'demo-audio-v1',
      status: 'needs_review',
      reviewItemIds: [reviews[0].itemId],
    };
    const pending = {
      ...batch,
      status: 'needs_review',
      items: reviews,
      files: [waitingFile],
    };
    expect(materialBatchReceiptSchema.parse(pending)).toEqual(pending);
    for (const patch of [
      { items: [] },
      { items: [reviews[0], reviews[0]] },
      { items: [{ ...reviews[0], batchId: 'other-batch' }] },
      { items: [{ ...reviews[0], evaluationNodeId: 'other-node' }] },
      { files: [{ ...waitingFile, reviewItemIds: ['missing-review'] }] },
    ])
      expect(
        materialBatchReceiptSchema.safeParse({ ...pending, ...patch }).success,
      ).toBe(false);
    expect(
      materialBatchReceiptSchema.safeParse({ ...ready, files: [waitingFile] })
        .success,
    ).toBe(false);
    expect(
      materialBatchReceiptSchema.safeParse({
        ...ready,
        files: [
          {
            materialId: 'demo-material',
            clientFileId: 'demo-file',
            filename: '演示材料',
            originalVersionId: null,
            status: 'processing',
            jobId: 'demo-job',
          },
        ],
      }).success,
    ).toBe(false);
  });
});
