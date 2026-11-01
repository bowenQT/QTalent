import type { RecordDraft } from './record';
import type { ReviewQueueItem } from './review-queue';

// Synthetic demo-only inputs, never copied from HR source material.
export const recordDraftFixture: RecordDraft = {
  draftId: 'demo-draft',
  revision: 1,
  origin: 'text',
  originalInput: {
    operation_id: 'demo-organize',
    text: '独立完成合成任务',
    attachmentIds: [],
    personId: 'demo-person',
    projectId: null,
  },
  sbi: {
    title: '演示任务',
    situation: '',
    behavior: '独立完成合成任务',
    impact: '',
  },
  people: [{ state: 'resolved', id: 'demo-person' }],
  project: { state: 'none' },
  scores: [
    {
      personId: 'demo-person',
      dimensionId: 'prof',
      state: 'suggested',
      value: 3,
      anchor: {
        id: 'demo-anchor',
        text: '独立完成合成任务',
        ruleVersion: 'rubric-v1',
      },
      citations: [{ kind: 'input', quote: '独立完成', start: 0, end: 4 }],
    },
  ],
};
export const reviewGapFixture: ReviewQueueItem = {
  id: 'demo-queue',
  revision: 1,
  eventId: 'demo-event',
  personId: 'demo-person',
  dimensionId: 'prof',
  kind: 'ai_gap',
  human: {
    value: 5,
    anchor: {
      id: 'demo-anchor-5',
      text: '形成可复用方法',
      ruleVersion: 'rubric-v1',
    },
    citations: [{ kind: 'input', quote: '独立完成', start: 0, end: 4 }],
    raterId: 'demo-rater',
    confirmedAt: '2026-10-25T10:00:00Z',
    reason: '',
  },
  ai: {
    value: 3,
    anchor: {
      id: 'demo-anchor-3',
      text: '独立完成合成任务',
      ruleVersion: 'rubric-v1',
    },
    citations: [{ kind: 'input', quote: '独立完成', start: 0, end: 4 }],
  },
};
