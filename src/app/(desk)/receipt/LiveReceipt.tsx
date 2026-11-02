'use client';
import { ReceiptPage } from '@/features/receipt/ReceiptPage';
import type { ReceiptActions, ReceiptView } from '@/features/receipt/types';
import { saveRecordBatchAction } from '@/server/actions/record-batch';
import { readReceipt } from './receipt-read';
import { undoReceipt } from './receipt-undo';

const actions: ReceiptActions = {
  // 读取和撤销走路由，不和保存排进同一条 Server Action 队列：有时间窗口的撤销不等别的保存
  read: readReceipt,
  save: saveRecordBatchAction,
  undo: undoReceipt,
};

/** 回执页绑上真实动作：读回执（GET 路由）、按 846 逐件保存（Server Action，和记一件事同一个）与撤销（POST 路由）。 */
export function LiveReceipt(props: {
  batchId: string;
  initial: ReceiptView;
  viewerName: string;
}) {
  return <ReceiptPage {...props} actions={actions} />;
}
