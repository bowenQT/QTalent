import { beforeEach, expect, it, vi } from 'vitest';
import { GET } from './route';

const mocks = vi.hoisted(() => ({ account: vi.fn(), read: vi.fn() }));
vi.mock('../../../../server/jobs/request', () => ({
  jobAccount: mocks.account,
}));
vi.mock('../../../../server/queries/receipt-page', () => ({
  readReceiptForCurrentUser: mocks.read,
}));

const context = { params: Promise.resolve({ batchId: 'demo-batch' }) };
const get = () =>
  GET(new Request('https://app.test/api/receipt/demo-batch'), context);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.account.mockResolvedValue('acct');
});

it('读同一个回执用例，按编号读；不放进共享缓存，viewerName 不随轮询下发', async () => {
  mocks.read.mockResolvedValue({
    status: 'success',
    view: { title: '演示' },
    viewerName: '叶青',
  });
  const result = await get();
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({
    status: 'success',
    view: { title: '演示' },
  });
  expect(mocks.read).toHaveBeenCalledWith({ batchId: 'demo-batch' });
  expect(result.headers.get('cache-control')).toContain('no-store');
  expect(result.headers.get('vary')).toContain('Cookie');
});

it('没有会话：401，不读回执，也不跳转登录页', async () => {
  mocks.account.mockResolvedValue(null);
  const result = await get();
  expect(result.status).toBe(401);
  expect(await result.json()).toEqual({ status: 'unauthenticated' });
  expect(mocks.read).not.toHaveBeenCalled();
});

it.each([
  [{ status: 'forbidden', message: '无权' }, 403],
  [{ status: 'not_found', message: '回执不存在' }, 404],
  [{ status: 'unavailable' }, 503],
])('读取结果 %o 映射为 %i，原样带回说明', async (body, code) => {
  mocks.read.mockResolvedValue(body);
  const result = await get();
  expect(result.status).toBe(code);
  expect(await result.json()).toEqual(body);
});

it('读取抛错（含会话校验的依赖故障）：503', async () => {
  mocks.read.mockRejectedValue(new Error('db'));
  expect((await get()).status).toBe(503);
  mocks.account.mockRejectedValue(new Error('jwks'));
  expect((await get()).status).toBe(503);
});
