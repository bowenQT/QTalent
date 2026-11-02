import { beforeEach, expect, it, vi } from 'vitest';
import { redirect } from 'next/navigation';
import { undoRecordForRequest } from './record-undo-request';

const runtime = vi.hoisted(() => ({
  account: vi.fn(),
  lost: vi.fn(),
  undo: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../jobs/request', () => ({
  jobAccount: runtime.account,
  sessionLost: runtime.lost,
}));
vi.mock('./record', () => ({ undoRecordAction: runtime.undo }));

const input = { operation_id: 'op-1', saveId: 'save-1' };
beforeEach(() => {
  vi.resetAllMocks();
});

it('没有有效会话：答 unauthenticated，不调用撤销', async () => {
  runtime.account.mockResolvedValue(null);
  expect(await undoRecordForRequest(new Headers(), input)).toEqual({
    status: 'unauthenticated',
  });
  expect(runtime.undo).not.toHaveBeenCalled();
});

it('会话有效：就是同一个撤销动作，结果原样返回', async () => {
  runtime.account.mockResolvedValue('acc-1');
  runtime.undo.mockResolvedValue({ status: 'forbidden', message: '无权' });
  expect(await undoRecordForRequest(new Headers(), input)).toEqual({
    status: 'forbidden',
    message: '无权',
  });
  expect(runtime.undo).toHaveBeenCalledWith(input);
});

it('撤销途中会话失效（requireSession 跳登录页）：答 unauthenticated', async () => {
  runtime.account.mockResolvedValue('acc-1');
  runtime.undo.mockImplementation(async () => redirect('/login'));
  runtime.lost.mockResolvedValue(true);
  const headers = new Headers({ cookie: 'x' });
  expect(await undoRecordForRequest(headers, input)).toEqual({
    status: 'unauthenticated',
  });
  expect(runtime.lost).toHaveBeenCalledWith(headers, expect.anything());
});

it('会话还在时的抛错照常抛出，路由答 503', async () => {
  runtime.account.mockResolvedValue('acc-1');
  const error = new Error('db down');
  runtime.undo.mockRejectedValue(error);
  runtime.lost.mockResolvedValue(false);
  await expect(undoRecordForRequest(new Headers(), input)).rejects.toBe(error);
});
