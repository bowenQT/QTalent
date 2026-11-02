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

export async function POST(request: Request) {
  // 只接受本站页面发来的撤销
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return respond({ status: 'forbidden', message: '请求来源不对' });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  try {
    // 没有会话、或撤销途中会话失效时答 401，不跳转登录页：页面据此写明失效
    return respond(await undoRecordForRequest(request.headers, body));
  } catch {
    return respond({ status: 'unavailable' });
  }
}
