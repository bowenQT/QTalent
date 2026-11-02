import { describe, expect, it } from 'vitest';
import { receiptHref, routeBatch } from './batch-route';
import { batch, draft, twoPeopleDraft } from './record.fixtures';

describe('routeBatch', () => {
  it('处理中、失败', () => {
    expect(routeBatch(batch())).toEqual({ kind: 'processing' });
    expect(routeBatch(batch({ status: 'failed', retryable: false }))).toEqual({
      kind: 'failed',
      failure: 'processing_failed',
      retryable: false,
    });
  });

  it('只有一件事、没有核对项：在本页确认', () => {
    expect(routeBatch(batch({ drafts: [draft] }))).toEqual({
      kind: 'draft',
      draft: { ...draft, batchId: 'batch-1' },
    });
  });

  it('多件事、待合并的相似事件、有核对项、部分已确认：交给回执页', () => {
    const two = batch({
      drafts: [draft, { ...twoPeopleDraft, draftId: 'draft-2' }],
    });
    expect(routeBatch(two)).toEqual({ kind: 'receipt', reason: 'many' });
    const similar = {
      ...two,
      draftSet: {
        ...two.draftSet!,
        drafts: [two.draftSet!.drafts[0]!],
        duplicateCandidates: [
          { candidateId: 'c', draftIds: ['draft-1', 'x'], reason: '相似' },
        ],
      },
    };
    expect(routeBatch(similar)).toEqual({ kind: 'receipt', reason: 'many' });
    expect(routeBatch(batch({ drafts: [draft], review: true }))).toEqual({
      kind: 'receipt',
      reason: 'review',
    });
    expect(routeBatch(batch({ drafts: [draft], confirmed: 1 }))).toEqual({
      kind: 'receipt',
      reason: 'many',
    });
  });

  it('整理不出事、这件事已确认', () => {
    expect(routeBatch(batch({ drafts: [] }))).toEqual({
      kind: 'receipt',
      reason: 'none',
    });
    expect(routeBatch(batch({ drafts: [], confirmed: 1 }))).toEqual({
      kind: 'receipt',
      reason: 'confirmed',
    });
  });
});

describe('receiptHref', () => {
  it('沿用原型的 ?id=，并编码批次 id', () => {
    expect(receiptHref('b 1')).toBe('/receipt?id=b%201');
  });
});
