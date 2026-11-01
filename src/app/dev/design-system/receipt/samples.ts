import {
  materialBatchReceiptSchema,
  type MaterialBatchReceipt,
  type MaterialFileReceipt,
} from '@/contracts/materials';
import type {
  MaterialReviewItem,
  MaterialReviewResolvedItem,
} from '@/contracts/material-review';
import { recordBatchDraftFixture } from '@/contracts/materials.fixtures';
import type { RecordBatchDraft } from '@/contracts/record';
import type { ReceiptLookup } from '@/features/receipt/receipt-view';

/** Synthetic people for the sample; every name is a pseudonym marked 演示. */
const PEOPLE: Record<string, { name: string; meta: string }> = {
  'demo-p1': { name: '演示学员甲', meta: '演示 · 一组' },
  'demo-p2': { name: '演示学员乙', meta: '演示 · 二组' },
  'demo-p3': { name: '演示学员丙', meta: '演示 · 二组' },
};
const DIMENSIONS: Record<string, string> = {
  'demo-professionalism': '专业度',
  'demo-ownership': '主动担当',
  'demo-potential': '潜力',
};
export const sampleLookup: ReceiptLookup = {
  person: (id) => PEOPLE[id] ?? null,
  dimension: (id) => DIMENSIONS[id] ?? null,
  project: (id) => (id === 'demo-project' ? '演示课题甲' : null),
};

const BATCH = 'demo-batch';
const NODE = 'demo-node';
const ref = (
  name: string,
  location: RecordBatchDraft['sourceReferences'][number]['location'],
) => ({
  fragmentId: `frag-${name}`,
  originalVersionId: `ver-${name}`,
  location,
});
const DOC = ref('doc', { kind: 'document', paragraph: '3' });
const SHEET = ref('sheet', {
  kind: 'spreadsheet',
  sheet: '评审表',
  cell: 'C4',
});
const AUDIO = ref('audio', {
  kind: 'recording',
  startMs: 192_000,
  endMs: 208_000,
});

const files = {
  docParsed: {
    materialId: 'm-doc',
    clientFileId: 'c-doc',
    filename: 'W8 对人复盘纪要.docx',
    status: 'parsed',
    originalVersionId: DOC.originalVersionId,
    parseVersionId: 'p-doc',
  },
  docReading: {
    materialId: 'm-doc',
    clientFileId: 'c-doc',
    filename: 'W8 对人复盘纪要.docx',
    status: 'processing',
    originalVersionId: DOC.originalVersionId,
    jobId: 'job-doc',
  },
  sheetReview: {
    materialId: 'm-sheet',
    clientFileId: 'c-sheet',
    filename: '评审表.xlsx',
    status: 'needs_review',
    originalVersionId: SHEET.originalVersionId,
    reviewItemIds: ['r-person'],
  },
  sheetParsed: {
    materialId: 'm-sheet',
    clientFileId: 'c-sheet',
    filename: '评审表.xlsx',
    status: 'parsed',
    originalVersionId: SHEET.originalVersionId,
    parseVersionId: 'p-sheet',
  },
  sheetReading: {
    materialId: 'm-sheet',
    clientFileId: 'c-sheet',
    filename: '评审表.xlsx',
    status: 'processing',
    originalVersionId: SHEET.originalVersionId,
    jobId: 'job-sheet',
  },
  audioParsed: {
    materialId: 'm-audio',
    clientFileId: 'c-audio',
    filename: '导师团复盘.m4a',
    status: 'parsed',
    originalVersionId: AUDIO.originalVersionId,
    parseVersionId: 'p-audio',
  },
  photoUnsupported: {
    materialId: 'm-photo',
    clientFileId: 'c-photo',
    filename: '路演现场.heic',
    status: 'unsupported',
    originalVersionId: null,
    reason: 'format',
    message: '换成 JPG 或 PNG 再交',
  },
  pdfFailed: {
    materialId: 'm-pdf',
    clientFileId: 'c-pdf',
    filename: '答辩材料.pdf',
    status: 'failed',
    originalVersionId: 'ver-pdf',
    code: 'processing_failed',
    message: '整理中断，原件已保存',
    retryable: true,
  },
} satisfies Record<string, MaterialFileReceipt>;

const reviewBase = {
  batchId: BATCH,
  evaluationNodeId: NODE,
  revision: 1,
};
const pendingPerson: MaterialReviewItem = {
  ...reviewBase,
  kind: 'unknown_person',
  itemId: 'r-person',
  materialId: 'm-sheet',
  originalVersionId: SHEET.originalVersionId,
  state: 'pending',
  source: SHEET,
  observedName: '小周',
  candidates: [
    { personId: 'demo-p2', displayName: '演示学员乙' },
    { personId: 'demo-p3', displayName: '演示学员丙' },
  ],
};
const resolvedSpeaker: MaterialReviewResolvedItem = {
  ...reviewBase,
  kind: 'speaker',
  itemId: 'r-speaker',
  materialId: 'm-audio',
  originalVersionId: AUDIO.originalVersionId,
  state: 'resolved',
  source: AUDIO,
  quote: '第二天就拿了两个方案过来',
  resolution: { action: 'bind', personId: 'demo-p1' },
  resolvedAt: '2026-10-30T08:00:00.000Z',
  auditId: 'audit-speaker',
  undo: { status: 'blocked', reason: 'dependent_draft_confirmed' },
};
const resolvedOutsider: MaterialReviewResolvedItem = {
  ...reviewBase,
  kind: 'unknown_person',
  itemId: 'r-outsider',
  materialId: 'm-doc',
  originalVersionId: DOC.originalVersionId,
  state: 'resolved',
  source: DOC,
  observedName: '阿泽',
  resolution: { action: 'keep_original_only' },
  resolvedAt: '2026-10-30T08:10:00.000Z',
  auditId: 'audit-outsider',
  undo: { status: 'available' },
};

function draft(
  id: string,
  personId: string,
  source: typeof DOC,
  title: string,
  quote: string,
  value: 1 | 2 | 3 | 4 | 5,
  anchorText: string,
): RecordBatchDraft {
  const anchor = recordBatchDraftFixture.scores[0];
  if (anchor.state !== 'suggested') throw new Error('fixture changed');
  return {
    ...recordBatchDraftFixture,
    batchId: BATCH,
    evaluationNodeId: NODE,
    draftId: id,
    personIds: [personId],
    sourceReferences: [source],
    sbi: { title, situation: '演示', behavior: quote, impact: '' },
    scores: [
      {
        ...anchor,
        anchor: { ...anchor.anchor, text: anchorText },
        personId,
        dimensionId: 'demo-ownership',
        value,
        citations: [{ kind: 'source', quote, reference: source }],
      },
      {
        state: 'unknown',
        personId,
        dimensionId: 'demo-potential',
        reason: '资料不足',
      },
    ],
  };
}

const drafts = {
  ownership: draft(
    'd-ownership',
    'demo-p1',
    AUDIO,
    '需求变更后当天给出两个备选方案',
    '第二天就拿了两个方案过来，每个方案的验收标准都写清楚了',
    4,
    '变化中主动给出备选',
  ),
  docs: draft(
    'd-docs',
    'demo-p1',
    DOC,
    '主动补齐接口文档，联调时间缩短一半',
    '剩余任务按方案 B 重新拆分为 5 个 Issue',
    3,
    '按分工补齐',
  ),
  docsAgain: draft(
    'd-docs-again',
    'demo-p1',
    SHEET,
    '补齐接口文档后联调提速',
    '主动补齐接口文档，联调时间缩短一半',
    3,
    '按分工补齐',
  ),
};

function receipt(
  parts: Pick<
    MaterialBatchReceipt,
    | 'files'
    | 'items'
    | 'resolvedItems'
    | 'personIds'
    | 'hasHiddenContent'
    | 'error'
  > & {
    drafts: RecordBatchDraft[];
    duplicate?: string[];
    confirmed: number;
  },
): MaterialBatchReceipt {
  const count = (status: MaterialFileReceipt['status']) =>
    parts.files.filter((entry) => entry.status === status).length;
  const processing = count('processing') > 0;
  const status = parts.error
    ? 'failed'
    : processing
      ? 'processing'
      : parts.items.length
        ? 'needs_review'
        : parts.drafts.length
          ? 'awaiting_confirmation'
          : 'completed';
  const confirmedDrafts = Array.from({ length: parts.confirmed }, (_, i) => ({
    draftId: `d-confirmed-${i}`,
    revision: 1,
    events: [{ personId: parts.personIds[0], eventId: `e-confirmed-${i}` }],
  }));
  return materialBatchReceiptSchema.parse({
    batchId: BATCH,
    revision: 3,
    evaluationNodeId: NODE,
    personIds: parts.personIds,
    projectId: null,
    hasHiddenContent: parts.hasHiddenContent,
    status,
    jobId: null,
    files: parts.files,
    textMaterial: null,
    items: parts.items,
    resolvedItems: parts.resolvedItems,
    draftSet: parts.drafts.length
      ? {
          batchId: BATCH,
          revision: 3,
          drafts: parts.drafts,
          duplicateCandidates: parts.duplicate
            ? [
                {
                  candidateId: 'dup-1',
                  draftIds: parts.duplicate,
                  reason: '同一人同一件事的两份材料',
                },
              ]
            : [],
        }
      : null,
    confirmedDrafts,
    counts: {
      files: {
        total: parts.files.length,
        processing: count('processing'),
        parsed: count('parsed'),
        needs_review: count('needs_review'),
        unsupported: count('unsupported'),
        failed: count('failed'),
        original_only: count('original_only'),
        attachment_only: count('attachment_only'),
      },
      events: {
        total: parts.drafts.length + parts.confirmed,
        awaiting_confirmation: parts.drafts.length,
        confirmed: parts.confirmed,
      },
      reviewItems: parts.items.length,
    },
    error: parts.error,
  });
}

/** The three receipts the sample page switches between with `?state=`. */
export const sampleReceipts = {
  // Still reading: nothing counted yet, part of it hidden by permission.
  processing: receipt({
    files: [files.docReading, files.sheetReading, files.audioParsed],
    items: [],
    resolvedItems: [],
    personIds: [],
    hasHiddenContent: true,
    error: null,
    drafts: [],
    confirmed: 0,
  }),
  // One person to check, events waiting, one possible duplicate, one confirmed.
  review: receipt({
    files: [files.docParsed, files.sheetReview, files.audioParsed],
    items: [pendingPerson],
    resolvedItems: [resolvedSpeaker, resolvedOutsider],
    personIds: ['demo-p1'],
    hasHiddenContent: false,
    error: null,
    drafts: [drafts.ownership, drafts.docs, drafts.docsAgain],
    duplicate: ['d-docs', 'd-docs-again'],
    confirmed: 1,
  }),
  // Done: every event confirmed, one file stopped and one waiting for a new format.
  done: receipt({
    files: [
      files.docParsed,
      files.sheetParsed,
      files.photoUnsupported,
      files.pdfFailed,
    ],
    items: [],
    resolvedItems: [resolvedOutsider],
    personIds: ['demo-p1', 'demo-p2'],
    hasHiddenContent: false,
    error: null,
    drafts: [],
    confirmed: 2,
  }),
} as const;
export type SampleState = keyof typeof sampleReceipts;
