import {
  undoRecordForRequest,
  type RecordUndoRequestResult,
} from '../../../../server/actions/record-undo-request';

/*
 * 撤销一次保存（BOW-847）。撤销只有 5 秒窗口，走 POST 而不是 Server Action：Next 把同一页的
 * Server Action 排成一条串行队列，另一件事的慢保存会挡住它。权限和重放仍由同一个撤销动作在服务端判断。
 */
const statusCodes = {
  success: 200,
  validation_error: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unavailable: 503,
} as const;
const respond = (body: RecordUndoRequestResult | { status: 'unavailable' }) =>
  Response.json(body, {
    status: statusCodes[body.status],
    headers: {
      'Cache-Control': 'no-store, private',
      Vary: 'Cookie, Authorization',
    },
  });

/**
 * 只接受本站页面发来的撤销。和 Next 对 Server Action 的来源检查一样，比较 Origin 的主机和
 * 请求的主机（经代理时取 x-forwarded-host），不比协议：TLS 在代理处终止时，请求 URL 是 http。
 */
function sameSite(headers: Headers) {
  const origin = headers.get('origin');
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host.split(',')[0]!.trim();
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!sameSite(request.headers))
    return respond({ status: 'forbidden', message: '请求来源不对' });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  try {
    // 没有会话、或撤销途中会话失效时答 401，不跳转登录页：页面据此写明失效
    return respond(await undoRecordForRequest(body));
  } catch {
    return respond({ status: 'unavailable' });
  }
}
