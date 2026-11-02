import 'server-only';

/**
 * 记录页只读请求的应答（#354 裁决续作）：读取走 GET，不进 Server Action 的串行队列，
 * 撤销等写操作不必排在一个慢读取后面。结果原样交给页面，由页面按合同解析；
 * 只有读取本身抛错时回 503。
 */
const headers = {
  'Cache-Control': 'no-store, private',
  Vary: 'Cookie, Authorization',
};

export async function readResponse(read: () => Promise<unknown>) {
  try {
    return Response.json(await read(), { headers });
  } catch (error) {
    // 未登录时 requireSession 抛出跳转，交回 Next 处理
    if (isNextControlFlow(error)) throw error;
    return Response.json({ status: 'unavailable' }, { status: 503, headers });
  }
}

function isNextControlFlow(error: unknown) {
  const digest =
    typeof error === 'object' && error !== null && 'digest' in error
      ? String(error.digest)
      : '';
  return digest.startsWith('NEXT_REDIRECT') || digest.startsWith('NEXT_HTTP');
}
