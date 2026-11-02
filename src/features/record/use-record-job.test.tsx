// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { JobReadError } from '@/lib/job-subscription';
import { doneJob, job } from './record.fixtures';
import { useRecordJob } from './use-record-job';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useRecordJob', () => {
  it('没有任务 id 时不订阅', () => {
    const read = vi.fn();
    const { result } = renderHook(() => useRecordJob(null, read));
    expect(read).not.toHaveBeenCalled();
    expect(result.current.snapshot).toBeNull();
    expect(result.current.connection).toBe('loading');
  });

  it('读取到快照；终态停止读取，唤醒后才再读', async () => {
    const read = vi.fn().mockResolvedValue(doneJob);
    const { result } = renderHook(() => useRecordJob('job-1', read));
    await waitFor(() =>
      expect(result.current.snapshot?.status).toBe('awaiting_manual'),
    );
    expect(result.current.connection).toBe('connected');
    expect(read).toHaveBeenCalledTimes(1);
    result.current.refresh();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });

  it('读取失败时保留已有快照并标记中断', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(job({ status: 'running' }))
      .mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useRecordJob('job-1', read));
    await waitFor(() =>
      expect(result.current.snapshot?.status).toBe('running'),
    );
    result.current.refresh();
    await waitFor(() => expect(result.current.connection).toBe('error'));
    expect(result.current.snapshot?.status).toBe('running');
    expect(result.current.stale).toBe(true);
  });

  it('无权限或已不存在时清空快照', async () => {
    const read = vi.fn().mockRejectedValue(new JobReadError(404));
    const { result } = renderHook(() => useRecordJob('job-1', read));
    await waitFor(() => expect(result.current.connection).toBe('not_found'));
    expect(result.current.snapshot).toBeNull();
  });

  it('换任务时不带过上一个任务的快照；卸载后不再读取', async () => {
    const read = vi
      .fn()
      .mockImplementation(async (id: string) =>
        job({ jobId: id, status: 'running' }),
      );
    const { result, rerender, unmount } = renderHook(
      ({ id }: { id: string | null }) => useRecordJob(id, read),
      { initialProps: { id: 'job-1' as string | null } },
    );
    await waitFor(() => expect(result.current.snapshot?.jobId).toBe('job-1'));
    rerender({ id: 'job-2' });
    expect(result.current.snapshot).toBeNull();
    await waitFor(() => expect(result.current.snapshot?.jobId).toBe('job-2'));
    rerender({ id: null });
    expect(result.current.snapshot).toBeNull();
    const calls = read.mock.calls.length;
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(read.mock.calls.length).toBe(calls);
  });

  it('默认从 /api/jobs/{id} 读取并按任务模式校验', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(doneJob), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => useRecordJob('job-1'));
    await waitFor(() =>
      expect(result.current.snapshot?.kind).toBe('record_organize'),
    );
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/jobs/job-1');
  });
});
