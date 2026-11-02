import { afterEach, expect, it, vi } from 'vitest';
import { recordBatchDraftSetFixture } from '@/contracts/materials.fixtures';
import { readReceipt } from './receipt-read';

const receipt = {
  batchId: 'demo-batch',
  revision: 1,
  evaluationNodeId: 'demo-node',
  personIds: ['demo-person'],
  projectId: null,
  hasHiddenContent: false,
  status: 'awaiting_confirmation',
  jobId: null,
  files: [],
  textMaterial: { materialId: 'm1', originalVersionId: 'v1' },
  items: [],
  resolvedItems: [],
  draftSet: recordBatchDraftSetFixture,
  confirmedDrafts: [],
  counts: {
    files: {
      total: 0,
      processing: 0,
      parsed: 0,
      needs_review: 0,
      unsupported: 0,
      failed: 0,
      original_only: 0,
      attachment_only: 0,
    },
    events: { total: 2, awaiting_confirmation: 2, confirmed: 0 },
    reviewItems: 0,
  },
  error: null,
};
const reply = (body: unknown, init: { redirected?: boolean } = {}) => {
  const response = new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
  );
  if (init.redirected)
    Object.defineProperty(response, 'redirected', { value: true });
  return response;
};
const stub = (response: Response) => {
  const fetch = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetch);
  return fetch;
};
afterEach(() => vi.unstubAllGlobals());

it('GET 回执路由：不走缓存，带上中止信号，校验过的快照原样交给页面', async () => {
  const view = { receipt, title: '演示' };
  const fetch = stub(reply({ status: 'success', view }));
  const signal = new AbortController().signal;
  expect(await readReceipt('demo batch', signal)).toEqual({
    status: 'success',
    view,
  });
  expect(fetch).toHaveBeenCalledWith(
    '/api/receipt/demo%20batch',
    expect.objectContaining({ cache: 'no-store', signal }),
  );
});

it.each([
  [
    { status: 'forbidden', message: '无权' },
    { status: 'forbidden', message: '无权' },
  ],
  [{ status: 'not_found' }, { status: 'not_found', message: '' }],
  [{ status: 'unauthenticated' }, { status: 'unauthenticated' }],
  [{ status: 'unavailable' }, { status: 'unavailable' }],
])('结果 %o 交给页面是 %o', async (body, expected) => {
  stub(reply(body));
  expect(await readReceipt('b')).toEqual(expected);
});

it('被接入层跳到登录页：当作登录失效，不当成中断', async () => {
  stub(reply('<html>', { redirected: true }));
  expect(await readReceipt('b')).toEqual({ status: 'unauthenticated' });
});

it('代理校验访问身份失败，答 401 纯文本：当作登录失效', async () => {
  stub(new Response('需要验证访问身份', { status: 401 }));
  expect(await readReceipt('b')).toEqual({ status: 'unauthenticated' });
});

it.each([
  ['不是 JSON', '<html>'],
  ['没有 status', { view: {} }],
  ['快照不合契约', { status: 'success', view: { receipt: { batchId: 1 } } }],
  ['不认识的 status', { status: 'teapot' }],
])('%s：当作这次读取中断', async (_name, body) => {
  stub(reply(body));
  expect(await readReceipt('b')).toEqual({ status: 'unavailable' });
});

it('网络错误和中止照常抛给页面，由页面按中断处理', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new DOMException('', 'AbortError')),
  );
  await expect(readReceipt('b')).rejects.toThrow();
});
