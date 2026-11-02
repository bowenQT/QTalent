import 'server-only';
import { getDatabase } from '../db/client';
import { getEnv } from '../env';
import { createClock } from '../../lib/clock';
import { createRecordBatchArrangeRequests } from '../usecases/record-batch-arrange-requests';
import type { EntryLinkResult } from '../usecases/entry/deep-links';
import { openEntryLinkRequest } from '../usecases/entry/open-link';

const noStore = { 'Cache-Control': 'no-store, private', Vary: 'Cookie' };
const redirect = (location: string) =>
  new Response(null, {
    status: 302,
    headers: { ...noStore, Location: location },
  });
const plain = (status: number, text: string) =>
  new Response(text, {
    status,
    headers: { ...noStore, 'Content-Type': 'text/plain; charset=utf-8' },
  });

/** Every location is a same-site path built on the server: the login page with
 * a canonical deep link, a canonical refresh link, or the reader's landing.
 * Missing and not permitted objects answer the same 404. */
export function entryLinkResponse(result: EntryLinkResult): Response {
  switch (result.status) {
    case 'authentication_required':
    case 'unauthenticated':
      return redirect(
        'returnTo' in result
          ? `/login?${new URLSearchParams({ returnTo: result.returnTo })}`
          : '/login',
      );
    case 'ready':
      return redirect(result.href);
    case 'stale':
      return redirect(result.refreshHref);
    case 'forbidden':
    case 'not_found':
      return plain(404, '链接对应的内容不存在，或你当前没有查看权限。');
    case 'validation_error':
      return plain(400, '链接格式不正确。');
    case 'conflict':
      return plain(409, '内容正在更新，请稍后重新打开链接。');
    default:
      return plain(503, '暂时无法打开这个链接，请稍后重试。');
  }
}

export async function handleEntryLinkOpen(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const clock = createClock(getEnv().APP_ENV);
  const businessNow = () => clock.now().toISOString();
  const db = getDatabase();
  return entryLinkResponse(
    await openEntryLinkRequest({
      db,
      headers: request.headers,
      href: url.pathname + url.search,
      // Opening a link never creates a batch or enqueues work.
      records: createRecordBatchArrangeRequests({
        db,
        businessNow,
        now: () => new Date(),
        enqueue: async () => {
          throw new Error('deep links never enqueue');
        },
      }),
      businessNow,
    }),
  );
}
