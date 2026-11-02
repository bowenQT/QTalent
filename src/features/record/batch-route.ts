import type { RecordBatchDraft } from '@/contracts/record';
import type { FailureKind } from './errors';
import type { BatchReceipt } from './types';

/** 整理结果不在本页确认时，为什么转去回执页。 */
export type HandoffReason = 'many' | 'review' | 'none' | 'confirmed';

export type BatchView =
  | { kind: 'processing' }
  | { kind: 'failed'; failure: FailureKind; retryable: boolean }
  | { kind: 'draft'; draft: RecordBatchDraft }
  | { kind: 'receipt'; reason: HandoffReason };

/**
 * 897 回执 → 本页显示什么（所有者裁决 #248 6564917769）。
 * 只有一件事、没有核对项和待合并的相似事件时，在本页确认、保存、撤销，和原型一样；
 * 其余都交给回执页逐件处理，本页不重做多件确认。
 */
export function routeBatch(receipt: BatchReceipt): BatchView {
  if (receipt.status === 'processing') return { kind: 'processing' };
  if (receipt.status === 'failed')
    return {
      kind: 'failed',
      failure: receipt.error?.code ?? 'processing_failed',
      retryable: receipt.error?.retryable ?? false,
    };
  if (receipt.items.length > 0) return { kind: 'receipt', reason: 'review' };
  const drafts = receipt.draftSet?.drafts ?? [];
  if (drafts.length > 1 || (receipt.draftSet?.duplicateCandidates.length ?? 0))
    return { kind: 'receipt', reason: 'many' };
  if (receipt.confirmedDrafts.length > 0)
    return { kind: 'receipt', reason: drafts.length ? 'many' : 'confirmed' };
  const [draft] = drafts;
  return draft ? { kind: 'draft', draft } : { kind: 'receipt', reason: 'none' };
}

/** 回执页地址，沿用原型 `receipt.html?id=`（#306）。 */
export function receiptHref(batchId: string): string {
  return `/receipt?id=${encodeURIComponent(batchId)}`;
}
