import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  batch: vi.fn(),
  anchors: vi.fn(),
  source: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../../../server/actions/record-batch', () => ({
  readRecordBatchAction: mocks.batch,
  readRecordAnchorsAction: mocks.anchors,
  readRecordSourceAction: mocks.source,
}));
import { GET as getAnchors } from './anchors/route';
import { GET as getBatch } from './batches/[batchId]/route';
import { GET as getSource } from './sources/route';

beforeEach(() => vi.resetAllMocks());

it('批次读取按路径里的批次 id 读，结果原样返回且不缓存', async () => {
  mocks.batch.mockResolvedValue({ status: 'forbidden', message: 'x' });
  const response = await getBatch(
    new Request('https://app.test/api/record/batches/b-1'),
    { params: Promise.resolve({ batchId: 'b-1' }) },
  );
  expect(mocks.batch).toHaveBeenCalledWith({ batchId: 'b-1' });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'forbidden', message: 'x' });
  expect(response.headers.get('cache-control')).toContain('no-store');
});

it('锚点按重复的 ruleVersion 参数读', async () => {
  mocks.anchors.mockResolvedValue([{ dimensionId: 'd' }]);
  const response = await getAnchors(
    new Request(
      'https://app.test/api/record/anchors?ruleVersion=v1&ruleVersion=v2',
    ),
  );
  expect(mocks.anchors).toHaveBeenCalledWith({ ruleVersions: ['v1', 'v2'] });
  expect(await response.json()).toEqual([{ dimensionId: 'd' }]);
});

it('原文只带片段和原件版本两个标识', async () => {
  mocks.source.mockResolvedValue({ status: 'not_found', message: 'x' });
  await getSource(
    new Request(
      'https://app.test/api/record/sources?fragmentId=f&originalVersionId=o&extra=1',
    ),
  );
  expect(mocks.source).toHaveBeenCalledWith({
    fragmentId: 'f',
    originalVersionId: 'o',
  });
});

it('读取抛错时回 503，不带内部信息', async () => {
  mocks.batch.mockRejectedValue(new Error('db down'));
  const response = await getBatch(
    new Request('https://app.test/api/record/batches/b-1'),
    { params: Promise.resolve({ batchId: 'b-1' }) },
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ status: 'unavailable' });
});

it('未登录的跳转交回 Next 处理', async () => {
  const redirect = Object.assign(new Error('NEXT_REDIRECT'), {
    digest: 'NEXT_REDIRECT;replace;/login;307;',
  });
  mocks.anchors.mockRejectedValue(redirect);
  await expect(
    getAnchors(new Request('https://app.test/api/record/anchors')),
  ).rejects.toBe(redirect);
});
