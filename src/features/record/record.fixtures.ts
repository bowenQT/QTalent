import {
  materialBatchReceiptSchema,
  type MaterialBatchReceipt,
} from '@/contracts/materials';
import type { RecordBatchDraft } from '@/contracts/record';
import type { MaterialSourceReference } from '@/contracts/sources';
import type { DimensionOption, PersonOption, RecordSaveReceipt } from './types';

// 全部为合成的演示数据，不取自任何真实材料。
export const people: PersonOption[] = [
  {
    id: 'p1',
    name: '演示甲',
    hue: 20,
    photo: null,
    orgShort: '演示一组',
    demo: true,
  },
  {
    id: 'p2',
    name: '演示乙',
    hue: 200,
    photo: null,
    orgShort: '演示二组',
    demo: false,
  },
];
export const dimensions: DimensionOption[] = [
  { id: 'prof', name: '专业度' },
  { id: 'mot', name: '驱动力' },
];

export const TEXT = '演示甲今天独立完成了合成任务，大家很满意。';

export const BATCH = 'batch-1';
export const NODE = 'node-1';
/** 本页写下的原话就是批次的文字材料；引用它的是行内引文。 */
export const textRef: MaterialSourceReference = {
  fragmentId: 'frag-text',
  originalVersionId: 'ver-text',
  location: { kind: 'document', paragraph: '原话' },
};

export const draft: RecordBatchDraft = {
  batchId: BATCH,
  evaluationNodeId: NODE,
  draftId: 'draft-1',
  revision: 1,
  origin: 'ai_suggestion',
  personIds: ['p1'],
  projectId: null,
  sourceReferences: [textRef],
  dimensionVersionId: 'v-test',
  anchorVersionId: 'v-test',
  sbi: {
    title: '独立完成合成任务',
    situation: '',
    behavior: '演示甲独立完成了合成任务',
    impact: '大家很满意',
  },
  scores: [
    {
      personId: 'p1',
      dimensionId: 'prof',
      state: 'suggested',
      value: 3,
      anchor: { id: 'a-prof-3', text: '独立完成', ruleVersion: 'v-test' },
      citations: [{ kind: 'source', quote: '独立完成', reference: textRef }],
    },
    {
      personId: 'p1',
      dimensionId: 'mot',
      state: 'unknown',
      reason: '原话没有写动机相关的行为',
    },
  ],
};

export const twoPeopleDraft: RecordBatchDraft = {
  ...draft,
  draftId: 'draft-2',
  personIds: ['p1', 'p2'],
  scores: [
    ...draft.scores,
    {
      personId: 'p2',
      dimensionId: 'prof',
      state: 'suggested',
      value: 4,
      anchor: { id: 'a-prof-4', text: '带着大家做', ruleVersion: 'v-test' },
      citations: [{ kind: 'source', quote: '大家很满意', reference: textRef }],
    },
  ],
};

type Shape = {
  status?: 'processing' | 'failed';
  drafts?: RecordBatchDraft[];
  review?: boolean;
  confirmed?: number;
  revision?: number;
  retryable?: boolean;
  batchId?: string;
};

/**
 * 一份合契约的 897 回执（经 materialBatchReceiptSchema 校验）。
 * 默认处理中；给 drafts 即整理完成，review 加一处待认人。
 */
export function batch(shape: Shape = {}): MaterialBatchReceipt {
  const batchId = shape.batchId ?? BATCH;
  const drafts = (shape.status ? [] : (shape.drafts ?? [])).map((item) => ({
    ...item,
    batchId,
  }));
  const done = shape.status === undefined && shape.drafts !== undefined;
  const processing = shape.status === 'processing' || (!done && !shape.status);
  const revision = shape.revision ?? 1;
  const personIds = [
    ...new Set(drafts.flatMap((item) => item.personIds)),
    ...(drafts.length ? [] : ['p1']),
  ];
  const items =
    shape.review && done
      ? [
          {
            itemId: 'item-1',
            batchId,
            evaluationNodeId: NODE,
            materialId: textRef.fragmentId,
            originalVersionId: textRef.originalVersionId,
            revision: 1,
            state: 'pending' as const,
            source: null,
            kind: 'unknown_person' as const,
            observedName: null,
            candidates: [],
          },
        ]
      : [];
  const confirmed = Array.from({ length: shape.confirmed ?? 0 }, (_, i) => ({
    draftId: `done-${i + 1}`,
    revision: 2,
    events: [{ personId: personIds[0]!, eventId: `ev-done-${i + 1}` }],
  }));
  return materialBatchReceiptSchema.parse({
    batchId,
    revision,
    evaluationNodeId: NODE,
    personIds,
    projectId: null,
    hasHiddenContent: false,
    status:
      shape.status === 'failed'
        ? 'failed'
        : processing
          ? 'processing'
          : items.length
            ? 'needs_review'
            : drafts.length
              ? 'awaiting_confirmation'
              : 'completed',
    jobId: processing ? 'job-1' : null,
    files: [],
    textMaterial: {
      materialId: textRef.fragmentId,
      originalVersionId: textRef.originalVersionId,
    },
    items,
    resolvedItems: [],
    draftSet: drafts.length
      ? { batchId, revision, drafts, duplicateCandidates: [] }
      : null,
    confirmedDrafts: confirmed,
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
      events: {
        total: drafts.length + confirmed.length,
        awaiting_confirmation: drafts.length,
        confirmed: confirmed.length,
      },
      reviewItems: items.length,
    },
    error:
      shape.status === 'failed'
        ? {
            code: 'processing_failed',
            message: '整理中断',
            retryable: shape.retryable ?? true,
          }
        : null,
  });
}

export const doneBatch = batch({ drafts: [draft], revision: 3 });

export const receipt: RecordSaveReceipt = {
  saveId: 'save-1',
  events: [{ personId: 'p1', eventId: 'ev-1' }],
  revision: 2,
  confirmationIds: ['c-1'],
  reviewItemIds: [],
  savedBy: 'acc-1',
  savedAt: '2026-10-26T08:00:00.000Z',
  undoUntil: '2026-10-26T08:00:05.000Z',
};
