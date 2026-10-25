import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  subscribeToJob,
  JobReadError,
  readJobSnapshot,
} from './job-subscription';
import { createJobSnapshotSchema, type JobSnapshot } from '../contracts/jobs';
import { z } from 'zod';
const snapshot = (
  revision = 1,
  status: JobSnapshot['status'] = 'running',
): JobSnapshot => ({
  schemaVersion: 1,
  jobId: 'j',
  kind: 'test-job',
  status,
  attempt: 1,
  revision,
  updatedAt: '2026-10-25T00:00:00.000Z',
  progress: null,
  result: null,
  error: null,
  canRetry: false,
  canCancel: true,
  cancelRequestedAt: null,
});
const flush = async () => {
  await vi.advanceTimersByTimeAsync(0);
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe('job subscriptions', () => {
  it('reads immediately, polls once per second and never overlaps requests', async () => {
    let resolve!: (value: JobSnapshot) => void;
    const read = vi.fn(
      () =>
        new Promise<JobSnapshot>((done) => {
          resolve = done;
        }),
    );
    const onChange = vi.fn();
    const sub = subscribeToJob({ jobId: 'j', read, onChange });
    await flush();
    await vi.advanceTimersByTimeAsync(3000);
    expect(read).toHaveBeenCalledTimes(1);
    resolve(snapshot());
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(2);
    sub.unsubscribe();
  });
  it.each([new Error('offline'), new JobReadError(503)])(
    'backs off 2/4/8 seconds for $name, retains stale results and refreshes immediately on recovery',
    async (error) => {
      const read = vi
        .fn()
        .mockResolvedValueOnce(snapshot())
        .mockRejectedValue(error);
      const onChange = vi.fn();
      const sub = subscribeToJob({ jobId: 'j', read, onChange });
      await flush();
      await vi.advanceTimersByTimeAsync(1000);
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          snapshot: snapshot(),
          stale: true,
          connection: 'error',
        }),
      );
      await vi.advanceTimersByTimeAsync(1999);
      expect(read).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(read).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(4000);
      expect(read).toHaveBeenCalledTimes(4);
      await vi.advanceTimersByTimeAsync(8000);
      expect(read).toHaveBeenCalledTimes(5);
      read.mockResolvedValue(snapshot(2));
      sub.refresh();
      await flush();
      expect(read).toHaveBeenCalledTimes(6);
      sub.unsubscribe();
    },
  );
  it.each(['completed', 'cancelled', 'failed', 'awaiting_manual'] as const)(
    'stops automatic reads for %s, manual refresh resumes',
    async (status) => {
      const read = vi.fn().mockResolvedValue(snapshot(1, status));
      const sub = subscribeToJob({ jobId: 'j', read, onChange: vi.fn() });
      await flush();
      await vi.advanceTimersByTimeAsync(10000);
      expect(read).toHaveBeenCalledTimes(1);
      read.mockResolvedValue(snapshot(2));
      sub.refresh();
      await flush();
      await vi.advanceTimersByTimeAsync(1000);
      expect(read).toHaveBeenCalledTimes(3);
      sub.unsubscribe();
    },
  );
  it('keeps polling while cancellation awaits safe worker acknowledgement', async () => {
    const read = vi.fn().mockResolvedValue({
      ...snapshot(2, 'failed'),
      cancelRequestedAt: '2026-10-25T00:00:00.000Z',
    });
    const sub = subscribeToJob({ jobId: 'j', read, onChange: vi.fn() });
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(2);
    sub.unsubscribe();
  });
  it.each([401, 403])(
    'clears cached data and stops on authorization failure %i',
    async (status) => {
      const read = vi
        .fn()
        .mockResolvedValueOnce(snapshot())
        .mockRejectedValue(new JobReadError(status));
      const onChange = vi.fn();
      const sub = subscribeToJob({ jobId: 'j', read, onChange });
      await flush();
      await vi.advanceTimersByTimeAsync(1000);
      expect(onChange).toHaveBeenLastCalledWith({
        snapshot: null,
        stale: false,
        connection: 'forbidden',
      });
      sub.refresh();
      await vi.advanceTimersByTimeAsync(10000);
      expect(read).toHaveBeenCalledTimes(2);
      sub.unsubscribe();
    },
  );
  it('ignores older revisions/attempts and unsubscribed or wrong-job responses', async () => {
    let resolve!: (value: JobSnapshot) => void;
    const read = vi
      .fn()
      .mockResolvedValueOnce(snapshot(3))
      .mockResolvedValueOnce(snapshot(2))
      .mockImplementation(
        () =>
          new Promise<JobSnapshot>((done) => {
            resolve = done;
          }),
      );
    const onChange = vi.fn();
    const sub = subscribeToJob({ jobId: 'j', read, onChange });
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ snapshot: snapshot(3) }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    const signal = read.mock.calls[2][1] as AbortSignal;
    sub.unsubscribe();
    const count = onChange.mock.calls.length;
    resolve(snapshot(4));
    await flush();
    expect(onChange).toHaveBeenCalledTimes(count);
    expect(signal.aborted).toBe(true);
  });
  it('fetches no-store and validates the consumer snapshot contract', async () => {
    const schema = createJobSnapshotSchema(
      'test-job',
      z.object({ units: z.array(z.string()) }).strict(),
    );
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(snapshot()), { status: 200 }),
      );
    expect(
      await readJobSnapshot('j', new AbortController().signal, schema, fetcher),
    ).toEqual(snapshot());
    expect(fetcher).toHaveBeenCalledWith(
      '/api/jobs/j',
      expect.objectContaining({
        cache: 'no-store',
        credentials: 'same-origin',
      }),
    );
    fetcher.mockResolvedValue(new Response('', { status: 403 }));
    await expect(
      readJobSnapshot('j', new AbortController().signal, schema, fetcher),
    ).rejects.toMatchObject({ status: 403 });
  });
});

it('aborts timed-out reads without presenting a failed job and ignores their late result', async () => {
  let resolve!: (snapshot: JobSnapshot) => void;
  const read = vi.fn(
    () =>
      new Promise<JobSnapshot>((done) => {
        resolve = done;
      }),
  );
  const onChange = vi.fn();
  const sub = subscribeToJob({ jobId: 'j', read, onChange, timeoutMs: 100 });
  await vi.advanceTimersByTimeAsync(100);
  expect(onChange).toHaveBeenLastCalledWith({
    snapshot: null,
    stale: false,
    connection: 'error',
  });
  resolve(snapshot(10));
  await flush();
  expect(onChange).toHaveBeenLastCalledWith({
    snapshot: null,
    stale: false,
    connection: 'error',
  });
  sub.unsubscribe();
});
it('refreshes on browser visibility and online events, removing both listeners on unsubscribe', async () => {
  const online = new EventTarget();
  const visibility = Object.assign(new EventTarget(), {
    visibilityState: 'hidden',
  });
  const read = vi.fn().mockResolvedValue(snapshot());
  const sub = subscribeToJob({
    jobId: 'j',
    read,
    onChange: vi.fn(),
    lifecycle: { online, visibility },
  });
  await flush();
  visibility.dispatchEvent(new Event('visibilitychange'));
  await flush();
  expect(read).toHaveBeenCalledTimes(1);
  visibility.visibilityState = 'visible';
  visibility.dispatchEvent(new Event('visibilitychange'));
  await flush();
  expect(read).toHaveBeenCalledTimes(2);
  online.dispatchEvent(new Event('online'));
  await flush();
  expect(read).toHaveBeenCalledTimes(3);
  sub.unsubscribe();
  online.dispatchEvent(new Event('online'));
  visibility.dispatchEvent(new Event('visibilitychange'));
  await flush();
  expect(read).toHaveBeenCalledTimes(3);
});
it('coalesces manual refresh while in flight and clears deleted jobs', async () => {
  let resolve!: (snapshot: JobSnapshot) => void;
  const read = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<JobSnapshot>((done) => {
          resolve = done;
        }),
    )
    .mockRejectedValue(new JobReadError(404));
  const onChange = vi.fn();
  const sub = subscribeToJob({ jobId: 'j', read, onChange });
  sub.refresh();
  sub.refresh();
  expect(read).toHaveBeenCalledTimes(1);
  resolve(snapshot());
  await vi.advanceTimersByTimeAsync(1);
  expect(read).toHaveBeenCalledTimes(2);
  expect(onChange).toHaveBeenLastCalledWith({
    snapshot: null,
    stale: false,
    connection: 'not_found',
  });
  sub.unsubscribe();
});
it('does not switch job or regress attempts even when old data has a newer revision', async () => {
  const latest = { ...snapshot(3), attempt: 2 };
  const read = vi
    .fn()
    .mockResolvedValueOnce(latest)
    .mockResolvedValueOnce(snapshot(10))
    .mockResolvedValueOnce({ ...snapshot(20), jobId: 'other' });
  const onChange = vi.fn();
  const sub = subscribeToJob({ jobId: 'j', read, onChange });
  await flush();
  await vi.advanceTimersByTimeAsync(1000);
  expect(onChange).toHaveBeenLastCalledWith({
    snapshot: latest,
    stale: false,
    connection: 'connected',
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect(onChange).toHaveBeenLastCalledWith({
    snapshot: latest,
    stale: true,
    connection: 'error',
  });
  sub.unsubscribe();
});
