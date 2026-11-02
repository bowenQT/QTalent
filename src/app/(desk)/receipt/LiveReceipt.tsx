'use client';
import { ReceiptPage } from '@/features/receipt/ReceiptPage';
import type { ReceiptActions, ReceiptView } from '@/features/receipt/types';
import { readReceiptAction } from '@/server/actions/receipt';
import { undoRecordAction } from '@/server/actions/record';
import { saveRecordBatchAction } from '@/server/actions/record-batch';

const actions: ReceiptActions = {
  read: readReceiptAction,
  save: saveRecordBatchAction,
  undo: undoRecordAction,
};

/** 回执页绑上真实动作：读回执、按 846 逐件保存与撤销，和记一件事用同一组保存动作。 */
export function LiveReceipt(props: {
  batchId: string;
  initial: ReceiptView;
  viewerName: string;
}) {
  return <ReceiptPage {...props} actions={actions} />;
}
