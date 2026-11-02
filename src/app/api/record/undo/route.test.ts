import { beforeEach, expect, it, vi } from 'vitest';
import { POST } from './route';

const mocks = vi.hoisted(() => ({ undo: vi.fn() }));
vi.mock('../../../../server/actions/record-undo-request', () => ({
  undoRecordForRequest: mocks.undo,
}));

const post = (body: string, origin: string | null = 'https://app.test') =>
  POST(
    new Request('https://app.test/api/record/undo', {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        ...(origin ? { origin } : {}),
      },
    }),
  );
const input = { operation_id: 'op-1', saveId: 'save-1' };

beforeEach(() => {
  vi.resetAllMocks();
});

it('按请求体撤销，结果原样返回且不缓存', async () => {
  mocks.undo.mockResolvedValue({ status: 'success', replayed: false });
  const result = await post(JSON.stringify(input));
  expect(mocks.undo).toHaveBeenCalledWith(input);
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ status: 'success', replayed: false });
  expect(result.headers.get('cache-control')).toContain('no-store');
  expect(result.headers.get('vary')).toContain('Cookie');
});

it.each([
  [{ status: 'unauthenticated' }, 401],
  [{ status: 'forbidden', message: '无权' }, 403],
  [{ status: 'not_found', message: '不存在' }, 404],
  [{ status: 'conflict', message: '已过时间', input }, 409],
  [{ status: 'validation_error', fieldErrors: {}, input: null }, 400],
] as const)('%o 答 %i', async (body, code) => {
  mocks.undo.mockResolvedValue(body);
  const result = await post(JSON.stringify(input));
  expect(result.status).toBe(code);
  expect(await result.json()).toEqual(body);
});

it('撤销抛错答 503；请求体不是 JSON 时照常交给撤销动作校验', async () => {
  mocks.undo.mockRejectedValue(new Error('db down'));
  const result = await post(JSON.stringify(input));
  expect(result.status).toBe(503);
  expect(await result.json()).toEqual({ status: 'unavailable' });
  mocks.undo.mockResolvedValue({ status: 'validation_error' });
  await post('not json');
  expect(mocks.undo).toHaveBeenLastCalledWith(null);
});

it('不是本站页面发来的撤销：拒绝，不调用撤销', async () => {
  for (const origin of ['https://evil.test', null]) {
    const result = await post(JSON.stringify(input), origin);
    expect(result.status).toBe(403);
  }
  expect(mocks.undo).not.toHaveBeenCalled();
});
