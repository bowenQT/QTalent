import { materialBatchReceiptSchema } from '@/contracts/materials';
import type { ReceiptReadResult, ReceiptView } from '@/features/receipt/types';

/**
 * 回执页的读取：GET `/api/receipt/<批次>`，不进 Server Action 的串行队列，可以中止。
 * 这是页面的边界，响应先校验再交给页面；看不懂的响应当作这次读取中断。
 */
export async function readReceipt(
  batchId: string,
  signal?: AbortSignal,
): Promise<ReceiptReadResult> {
  const response = await fetch(`/api/receipt/${encodeURIComponent(batchId)}`, {
    cache: 'no-store',
    headers: { accept: 'application/json' },
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
  if (typeof body !== 'object' || body === null || !('status' in body))
    return { status: 'unavailable' };
  switch (body.status) {
    case 'success': {
      const view = 'view' in body ? (body.view as ReceiptView) : null;
      return view && materialBatchReceiptSchema.safeParse(view.receipt).success
        ? { status: 'success', view }
        : { status: 'unavailable' };
    }
    case 'forbidden':
    case 'not_found':
      return {
        status: body.status,
        message:
          'message' in body && typeof body.message === 'string'
            ? body.message
            : '',
      };
    case 'unauthenticated':
      return { status: 'unauthenticated' };
    default:
      return { status: 'unavailable' };
  }
}
