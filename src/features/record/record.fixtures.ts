import type { RecordDraft } from '@/contracts/record';
import type {
  DimensionOption,
  PersonOption,
  RecordJob,
  RecordSaveReceipt,
} from './types';

// 全部为合成的演示数据，不取自任何真实材料。
export const people: PersonOption[] = [
  { id: 'p1', name: '演示甲', hue: 20, photo: null, orgShort: '演示一组' },
  { id: 'p2', name: '演示乙', hue: 200, photo: null, orgShort: '演示二组' },
];
export const dimensions: DimensionOption[] = [
  { id: 'prof', name: '专业度' },
  { id: 'mot', name: '驱动力' },
];

export const TEXT = '演示甲今天独立完成了合成任务，大家很满意。';

export const draft: RecordDraft = {
  draftId: 'draft-1',
  revision: 1,
  origin: 'text',
  originalInput: {
    operation_id: 'op-start',
    text: TEXT,
    attachmentIds: [],
    personId: 'p1',
    projectId: null,
  },
  sbi: {
    title: '独立完成合成任务',
    situation: '',
    behavior: '演示甲独立完成了合成任务',
    impact: '大家很满意',
  },
  people: [{ state: 'resolved', id: 'p1' }],
  project: { state: 'none' },
  scores: [
    {
      personId: 'p1',
      dimensionId: 'prof',
      state: 'suggested',
      value: 3,
      anchor: { id: 'a-prof-3', text: '独立完成', ruleVersion: 'v-test' },
      citations: [{ kind: 'input', quote: '独立完成', start: 5, end: 9 }],
    },
    {
      personId: 'p1',
      dimensionId: 'mot',
      state: 'unknown',
      reason: '原话没有写动机相关的行为',
    },
  ],
};

export const twoPeopleDraft: RecordDraft = {
  ...draft,
  draftId: 'draft-2',
  people: [
    { state: 'resolved', id: 'p1' },
    { state: 'resolved', id: 'p2' },
  ],
  scores: [
    ...draft.scores,
    {
      personId: 'p2',
      dimensionId: 'prof',
      state: 'suggested',
      value: 4,
      anchor: { id: 'a-prof-4', text: '带着大家做', ruleVersion: 'v-test' },
      citations: [{ kind: 'input', quote: '大家很满意', start: 15, end: 20 }],
    },
  ],
};

export function job(overrides: Partial<RecordJob> = {}): RecordJob {
  return {
    schemaVersion: 1,
    jobId: 'job-1',
    kind: 'record_organize',
    status: 'queued',
    attempt: 1,
    revision: 1,
    updatedAt: '2026-10-26T08:00:00.000Z',
    progress: null,
    result: null,
    error: null,
    canRetry: false,
    canCancel: false,
    cancelRequestedAt: null,
    ...overrides,
  };
}

export const doneJob = job({
  status: 'awaiting_manual',
  revision: 3,
  result: draft,
});

export const receipt: RecordSaveReceipt = {
  saveId: 'save-1',
  events: [{ personId: 'p1', eventId: 'ev-1' }],
  revision: 2,
  confirmationIds: ['c-1'],
  reviewItemIds: [],
  savedBy: 'account-1',
  savedAt: '2026-10-26T08:00:00.000Z',
  undoUntil: '2026-10-26T08:00:05.000Z',
};
