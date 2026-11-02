import { afterEach, expect, it, vi } from 'vitest';
import { batch } from '@/features/record/record.fixtures';
import { readAnchors, readBatch, readSource, READ_TIMEOUT_MS } from './reads';

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), init);
function stub(respond: (url: string, init: RequestInit) => Promise<Response>) {
  const fetch = vi.fn(respond);
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('批次读取走 GET 路由，按合同解析，不用缓存', async () => {
  const result = { status: 'success', replayed: false, result: batch() };
  const fetch = stub(async () => json(result));
  expect(await readBatch({ batchId: 'b/1' })).toEqual(result);
  const [url, init] = fetch.mock.calls[0]!;
  expect(url).toBe('/api/record/batches/b%2F1');
  expect(init).toMatchObject({ cache: 'no-store', credentials: 'same-origin' });
  expect(init.method).toBeUndefined();
});

it('不合合同的应答、错误状态和被跳去登录都按读取失败', async () => {
  stub(async () => json({ status: 'success', result: {} }));
  await expect(readBatch({ batchId: 'b' })).rejects.toThrow();
  stub(async () => json({ status: 'unavailable' }, { status: 503 }));
  await expect(readBatch({ batchId: 'b' })).rejects.toThrow('503');
  stub(async () => {
    const response = json([]);
    Object.defineProperty(response, 'redirected', { value: true });
    return response;
  });
  await expect(readAnchors(['v1'])).rejects.toThrow();
});

it('挂住的读取到点中止请求', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  stub(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        signal = init.signal ?? undefined;
        signal?.addEventListener('abort', () => reject(signal?.reason));
      }),
  );
  const pending = readBatch({ batchId: 'b' });
  const settled = expect(pending).rejects.toThrow('timeout');
  await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
  await settled;
  expect(signal?.aborted).toBe(true);
});

it('调用方可以提前取消', async () => {
  let signal: AbortSignal | undefined;
  stub(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        signal = init.signal ?? undefined;
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  );
  const controller = new AbortController();
  const pending = readBatch({ batchId: 'b' }, { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toThrow('aborted');
  expect(signal?.aborted).toBe(true);
});

it('锚点按版本重复参数读；原文只带两个标识', async () => {
  const rows = [{ dimensionId: 'd', ruleVersion: 'v1', value: 1, text: 't' }];
  const fetch = stub(async (url) =>
    url.startsWith('/api/record/anchors')
      ? json(rows)
      : json({ status: 'not_found', message: '原文已不可用' }),
  );
  expect(await readAnchors(['v1', 'v2'])).toEqual(rows);
  expect(fetch.mock.calls[0]![0]).toBe(
    '/api/record/anchors?ruleVersion=v1&ruleVersion=v2',
  );
  await readSource({ fragmentId: 'f 1', originalVersionId: 'o' });
  expect(fetch.mock.calls[1]![0]).toBe(
    '/api/record/sources?fragmentId=f+1&originalVersionId=o',
  );
});
