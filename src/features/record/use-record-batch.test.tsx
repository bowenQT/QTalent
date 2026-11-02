// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { batch, doneBatch } from './record.fixtures';
import { POLL_MS, useRecordBatch } from './use-record-batch';

const ok = <T,>(result: T) =>
  Promise.resolve({ status: 'success' as const, replayed: false, result });
const flush = () => act(async () => undefined);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useRecordBatch', () => {
  it('没有批次时不读', () => {
    const read = vi.fn();
    const { result } = renderHook(() => useRecordBatch(null, read));
    expect(read).not.toHaveBeenCalled();
    expect(result.current).toEqual({ receipt: null, connection: 'loading' });
  });

  it('处理中每秒读一次，读到结束就停', async () => {
    const read = vi
      .fn()
      .mockImplementationOnce(() => ok(batch()))
      .mockImplementation(() => ok(doneBatch));
    const { result } = renderHook(() => useRecordBatch('batch-1', read));
    await flush();
    expect(result.current.receipt?.status).toBe('processing');
    expect(result.current.connection).toBe('connected');
    await act(async () => vi.advanceTimersByTime(POLL_MS));
    expect(result.current.receipt?.status).toBe('awaiting_confirmation');
    await act(async () => vi.advanceTimersByTime(POLL_MS * 5));
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledWith({ batchId: 'batch-1' });
  });

  it('读取失败退避重试并保留上一份回执；恢复联网立即重读', async () => {
    const read = vi
      .fn()
      .mockImplementationOnce(() => ok(batch()))
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(() => ok(doneBatch));
    const { result } = renderHook(() => useRecordBatch('batch-1', read));
    await flush();
    await act(async () => vi.advanceTimersByTime(POLL_MS));
    expect(result.current.connection).toBe('error');
    expect(result.current.receipt?.status).toBe('processing');
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current.connection).toBe('connected');
    expect(result.current.receipt?.status).toBe('awaiting_confirmation');
  });

  it('退避按次数加长，到时自动重读', async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(() => ok(doneBatch));
    const { result } = renderHook(() => useRecordBatch('batch-1', read));
    await flush();
    expect(result.current).toEqual({ receipt: null, connection: 'error' });
    await act(async () => vi.advanceTimersByTime(POLL_MS * 2));
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTime(POLL_MS * 4));
    expect(result.current.connection).toBe('connected');
  });

  it('批次不存在或不可见：停在 gone，不再读', async () => {
    const read = vi.fn(async () => ({
      status: 'not_found' as const,
      message: '批次不存在或当前不可见',
    }));
    const { result } = renderHook(() => useRecordBatch('batch-1', read));
    await flush();
    expect(result.current.connection).toBe('gone');
    await act(async () => vi.advanceTimersByTime(POLL_MS * 5));
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('卸载后不再读，换批次只认新批次', async () => {
    const read = vi.fn(() => ok(batch()));
    const { result, rerender, unmount } = renderHook(
      ({ id }) => useRecordBatch(id, read),
      { initialProps: { id: 'batch-1' } },
    );
    await flush();
    rerender({ id: 'batch-2' });
    expect(result.current.receipt).toBeNull();
    await flush();
    unmount();
    const calls = read.mock.calls.length;
    await act(async () => vi.advanceTimersByTime(POLL_MS * 5));
    expect(read).toHaveBeenCalledTimes(calls);
  });
});
