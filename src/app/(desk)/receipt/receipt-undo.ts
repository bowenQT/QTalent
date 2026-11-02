import { recordUndoResultSchema } from '@/contracts/record';
import type { ReceiptActions } from '@/features/receipt/types';

/**
 * 回执页的撤销：POST `/api/record/undo`，不进 Server Action 的串行队列，另一件事的慢保存
 * 挡不住它；可以中止。响应先按契约校验再交给页面，看不懂的响应当作结果待核实。
 */
export const undoReceipt: ReceiptActions['undo'] = async (input, signal) => {
  const response = await fetch('/api/record/undo', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  // 会话或访问身份失效（接入层跳到登录页，或代理直接答 401 纯文本）：这不是中断，是失效
  if (response.redirected || response.status === 401)
    return { status: 'unauthenticated' };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: 'unavailable' };
  }
  const parsed = recordUndoResultSchema.safeParse(body);
  return parsed.success ? parsed.data : { status: 'unavailable' };
};
