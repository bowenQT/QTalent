import { beforeEach, expect, it, vi } from 'vitest';
import { redirect } from 'next/navigation';
import { readReceiptForCurrentUser } from './receipt-page';

const runtime = vi.hoisted(() => ({
  readBatch: vi.fn(),
  session: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('./record-arrange', () => ({
  readRecordMaterialBatchForCurrentUser: runtime.readBatch,
}));
vi.mock('../auth/next', () => ({ requireSession: runtime.session }));
vi.mock('../db/client', () => ({
  getDatabase: () => ({ transaction: runtime.transaction }),
}));
vi.mock('../env', () => ({ getEnv: () => ({ APP_ENV: 'test' }) }));
vi.mock('../../lib/clock', () => ({
  createClock: () => ({ now: () => new Date('2026-10-15T00:00:00.000Z') }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  runtime.session.mockResolvedValue({ user: { id: 'acc-1' } });
});

it('passes the batch read refusal through and asks for no display facts', async () => {
  runtime.readBatch.mockResolvedValue({ status: 'forbidden', message: '无权' });
  expect(await readReceiptForCurrentUser({ batchId: 'b' })).toEqual({
    status: 'forbidden',
    message: '无权',
  });
  expect(runtime.transaction).not.toHaveBeenCalled();
});

it.each([
  { status: 'not_found', message: '批次不存在或当前不可见' },
  { status: 'validation_error', fieldErrors: {}, input: {} },
])(
  'states a missing or malformed batch as a dead link ($status)',
  async (read) => {
    runtime.readBatch.mockResolvedValue(read);
    expect(await readReceiptForCurrentUser({ batchId: 'b' })).toEqual({
      status: 'not_found',
      message: '回执不存在，或者已不在你的查看范围里',
    });
  },
);

it('states any other answer or a failed read as unavailable', async () => {
  runtime.readBatch.mockResolvedValue({
    status: 'conflict',
    message: '版本变了',
    input: {},
  });
  expect(await readReceiptForCurrentUser({ batchId: 'b' })).toEqual({
    status: 'unavailable',
  });
  runtime.readBatch.mockResolvedValue({
    status: 'success',
    replayed: false,
    result: { batchId: 'b' },
  });
  runtime.transaction.mockRejectedValue(new Error('connection lost'));
  expect(await readReceiptForCurrentUser({ batchId: 'b' })).toEqual({
    status: 'unavailable',
  });
  expect(runtime.transaction).toHaveBeenCalledTimes(1);
});

it('lets the sign-in redirect through', async () => {
  runtime.readBatch.mockImplementation(async () => redirect('/login'));
  await expect(
    readReceiptForCurrentUser({ batchId: 'b' }),
  ).rejects.toMatchObject({
    digest: expect.stringContaining('NEXT_REDIRECT'),
  });
});
