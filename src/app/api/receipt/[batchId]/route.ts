import {
  readReceiptForRequest,
  type ReceiptRouteResult,
} from '../../../../server/queries/receipt-page';

/*
 * 回执页的轮询和重读（BOW-847）。走 GET 而不是 Server Action：Next 把同一页的 Server Action
 * 排成一条串行队列，读取慢时会挡住限时的撤销。能看什么仍由同一个读取用例在服务端判断。
 */
const statusCodes = {
  success: 200,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  unavailable: 503,
} as const;
type Body =
  | Exclude<ReceiptRouteResult, { status: 'success' }>
  | {
      status: 'success';
      view: Extract<ReceiptRouteResult, { status: 'success' }>['view'];
    };
const respond = (body: Body) =>
  Response.json(body, {
    status: statusCodes[body.status],
    headers: {
      'Cache-Control': 'no-store, private',
      Vary: 'Cookie, Authorization',
    },
  });

type Context = { params: Promise<{ batchId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    // 没有会话时答 401，不跳转登录页：页面据此写明失效，而不是当成读取中断
    const { batchId } = await context.params;
    const result = await readReceiptForRequest(request.headers, { batchId });
    return respond(
      result.status === 'success'
        ? { status: 'success', view: result.view }
        : result,
    );
  } catch {
    return respond({ status: 'unavailable' });
  }
}
