import { describe, expect, it } from 'vitest';
import {
  recordCitationSchema,
  recordDraftSchema,
  recordInputSchema,
  recordJobSchema,
  recordSaveInputSchema,
  recordSaveReceiptSchema,
  recordSaveResultSchema,
} from './record';
import { reviewQueueActionSchema, reviewQueueItemSchema } from './review-queue';
import {
  recordDraftFixture,
  reviewGapFixture,
} from './record-review.fixtures';

describe('record evidence and actions', () => {
  it('validates demo fixtures and pending entity selection', () => {
    expect(recordDraftSchema.safeParse(recordDraftFixture).success).toBe(true);
    const draft = {
      ...recordDraftFixture,
      people: [
        {
          state: 'needs_selection',
          candidates: [{ id: 'demo-person', label: '演示人员' }],
          reason: '请记录人选定',
        },
      ],
    };
    expect(recordDraftSchema.safeParse(draft).success).toBe(true);
  });

  it('rejects client actor claims and blank original input', () => {
    const input = recordDraftFixture.originalInput;
    const forged = recordInputSchema.safeParse({ ...input, actorId: 'other' });
    expect(forged.success).toBe(false);
    const blank = recordInputSchema.safeParse({ ...input, text: ' ' });
    expect(blank.success).toBe(false);
  });

  it('preserves resolvable audio and document references', () => {
    const citation = {
      kind: 'source',
      quote: '合成引文',
      reference: {
        fragmentId: 'demo-fragment',
        originalVersionId: 'demo-version',
        location: { kind: 'recording', startMs: 0, endMs: 1000 },
      },
    };
    expect(recordCitationSchema.safeParse(citation).success).toBe(true);
    const document = {
      ...citation,
      reference: {
        ...citation.reference,
        location: { kind: 'document', page: 1, paragraph: 'p-1' },
      },
    };
    expect(recordCitationSchema.safeParse(document).success).toBe(true);
    expect(
      recordCitationSchema.safeParse({ kind: 'source', quote: '只有引文' })
        .success,
    ).toBe(false);
    expect(
      recordCitationSchema.safeParse({
        kind: 'input',
        quote: '合成引文',
        start: 4,
        end: 4,
      }).success,
    ).toBe(false);
  });

  const save = {
    operation_id: 'demo-save',
    expected_revision: 1,
    draftId: 'demo-draft',
    personIds: ['demo-person'],
    projectId: null,
    sbi: recordDraftFixture.sbi,
    decisions: [
      {
        personId: 'demo-person',
        dimensionId: 'prof',
        action: 'edit',
        value: 5,
        reason: '',
      },
    ],
  };

  it('allows reasonless edits but rejects duplicate or unrelated decisions', () => {
    expect(recordSaveInputSchema.safeParse(save).success).toBe(true);
    const duplicate = {
      ...save,
      decisions: [...save.decisions, ...save.decisions],
    };
    expect(recordSaveInputSchema.safeParse(duplicate).success).toBe(false);
    const unrelated = { ...save, personIds: ['other-person'] };
    expect(recordSaveInputSchema.safeParse(unrelated).success).toBe(false);
    const stale = { ...save, expected_revision: 0 };
    expect(recordSaveInputSchema.safeParse(stale).success).toBe(false);
  });

  const receipt = {
    saveId: 'demo-save',
    eventId: 'demo-event',
    revision: 1,
    confirmationIds: ['demo-confirmation'],
    reviewItemIds: ['demo-queue'],
    savedBy: 'demo-rater',
    savedAt: '2026-10-25T10:00:00Z',
    undoUntil: '2026-10-25T10:00:05Z',
  };

  it('defines exactly five server seconds and typed replay/conflict outcomes', () => {
    expect(recordSaveReceiptSchema.safeParse(receipt).success).toBe(true);
    const invalid = { ...receipt, undoUntil: '2026-10-25T10:00:06Z' };
    expect(recordSaveReceiptSchema.safeParse(invalid).success).toBe(false);
    const replay = { status: 'success', replayed: true, result: receipt };
    expect(recordSaveResultSchema.safeParse(replay).success).toBe(true);
    const conflict = { status: 'conflict', message: '版本已更新', input: save };
    expect(recordSaveResultSchema.safeParse(conflict).success).toBe(true);
  });

  it('uses the existing jobs envelope without promoting a failed job to a draft', () => {
    const job = {
      schemaVersion: 1,
      jobId: 'demo-job',
      kind: 'record_organize',
      status: 'failed',
      attempt: 1,
      revision: 1,
      updatedAt: '2026-10-25T10:00:00Z',
      progress: null,
      result: null,
      error: { code: 'processing_failed', message: '整理失败' },
      canRetry: true,
      canCancel: false,
      cancelRequestedAt: null,
    };
    expect(recordJobSchema.safeParse(job).success).toBe(true);
    expect(recordJobSchema.safeParse({ ...job, result: {} }).success).toBe(false);
  });
});

describe('review thresholds and calibration', () => {
  it('accepts exactly two points but not one or an explained AI edit', () => {
    expect(reviewQueueItemSchema.safeParse(reviewGapFixture).success).toBe(true);
    if (reviewGapFixture.kind !== 'ai_gap') throw new Error('fixture kind');
    const one = {
      ...reviewGapFixture,
      human: { ...reviewGapFixture.human, value: 4 },
    };
    expect(reviewQueueItemSchema.safeParse(one).success).toBe(false);
    const explained = {
      ...reviewGapFixture,
      human: { ...reviewGapFixture.human, reason: '已有理由' },
    };
    expect(reviewQueueItemSchema.safeParse(explained).success).toBe(false);
  });

  it('requires different confirmed raters with a two-point difference', () => {
    if (reviewGapFixture.kind !== 'ai_gap') throw new Error('fixture kind');
    const first = reviewGapFixture.human;
    const base = {
      id: 'demo-rater-queue',
      revision: 1,
      eventId: 'demo-event',
      personId: 'demo-person',
      dimensionId: 'prof',
      kind: 'rater_gap',
    };
    const second = { ...first, value: 3, raterId: 'demo-second' };
    const item = { ...base, sides: [first, second] };
    expect(reviewQueueItemSchema.safeParse(item).success).toBe(true);
    const repeated = { ...base, sides: [first, { ...first, value: 3 }] };
    expect(reviewQueueItemSchema.safeParse(repeated).success).toBe(false);
  });

  it('requires reasons and limits keep-score to AI gaps', () => {
    const action = {
      operation_id: 'demo-calibrate',
      expected_revision: 1,
      itemId: 'demo-queue',
      kind: 'ai_gap',
      action: 'keep_score',
      reason: '复核后保留',
    };
    expect(reviewQueueActionSchema.safeParse(action).success).toBe(true);
    const blank = { ...action, reason: ' ' };
    expect(reviewQueueActionSchema.safeParse(blank).success).toBe(false);
    const invalid = { ...action, kind: 'rater_gap' };
    expect(reviewQueueActionSchema.safeParse(invalid).success).toBe(false);
  });
});
