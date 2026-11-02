import type { z } from 'zod';
import type { JobSnapshot } from '../contracts/jobs';
export class JobReadError extends Error {
  constructor(public readonly status: number) {
    super('Unable to read job');
  }
}
export async function readJobSnapshot<R>(
  jobId: string,
  signal: AbortSignal,
  schema: z.ZodType<JobSnapshot<R>>,
  fetcher: typeof fetch = fetch,
): Promise<JobSnapshot<R>> {
  const response = await fetcher(`/api/jobs/${encodeURIComponent(jobId)}`, {
    signal,
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (!response.ok) throw new JobReadError(response.status);
  return schema.parse(await response.json());
}
export interface JobSubscriptionState<R> {
  snapshot: JobSnapshot<R> | null;
  stale: boolean;
  /** `conflict` only with `stopOnConflict`: the server says the result is stale. */
  connection:
    'loading' | 'connected' | 'error' | 'forbidden' | 'not_found' | 'conflict';
  /** With `retryLimit` only: automatic retries reached the limit, and only
   * `refresh()` reads again. */
  gaveUp?: boolean;
}
export interface JobSubscriptionOptions<R> {
  jobId: string;
  read(jobId: string, signal: AbortSignal): Promise<JobSnapshot<R>>;
  onChange(state: JobSubscriptionState<R>): void;
  timeoutMs?: number;
  /** A 409 clears the result and stops, instead of being retried as an outage. */
  stopOnConflict?: boolean;
  /** Consecutive failed reads after which automatic retries stop. Failed reads
   * are also not retried while the page is hidden; showing it again resumes. */
  retryLimit?: number;
  /** Optional browser lifecycle targets; listeners are removed on unsubscribe. */
  lifecycle?: {
    online: EventTarget;
    visibility: EventTarget & { visibilityState: string };
  };
}
/** Holds sensitive results only in this subscription. Unsubscribe/log out clears them and never cancels the server job. */
export function subscribeToJob<R>(options: JobSubscriptionOptions<R>) {
  let snapshot: JobSnapshot<R> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: AbortController | null = null;
  let disposed = false;
  let forbidden = false;
  let pendingRefresh = false;
  let failures = 0;
  let gaveUp = false;
  function emit(
    connection: JobSubscriptionState<R>['connection'],
    stale = false,
  ) {
    options.onChange({
      snapshot,
      stale,
      connection,
      ...(options.retryLimit === undefined ? {} : { gaveUp }),
    });
  }
  function hidden() {
    return options.lifecycle?.visibility.visibilityState === 'hidden';
  }
  function schedule(delay: number) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void poll();
    }, delay);
  }
  function isPolling() {
    return (
      snapshot === null ||
      (!['completed', 'cancelled'].includes(snapshot.status) &&
        (snapshot.cancelRequestedAt !== null ||
          !['failed', 'awaiting_manual'].includes(snapshot.status)))
    );
  }
  async function poll() {
    if (disposed || forbidden) return;
    if (active) {
      pendingRefresh = true;
      return;
    }
    clearTimeout(timer);
    const controller = new AbortController();
    active = controller;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const next = await Promise.race([
        options.read(options.jobId, controller.signal),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error('Job read timed out'));
          }, options.timeoutMs ?? 15000);
        }),
      ]);
      if (disposed) return;
      if (next.jobId !== options.jobId) throw new Error('Unexpected job');
      if (
        snapshot === null ||
        (next.attempt >= snapshot.attempt && next.revision >= snapshot.revision)
      )
        snapshot = next;
      failures = 0;
      emit('connected');
    } catch (error) {
      if (disposed) return;
      if (
        error instanceof JobReadError &&
        ([401, 403, 404].includes(error.status) ||
          (options.stopOnConflict && error.status === 409))
      ) {
        snapshot = null;
        forbidden = true;
        emit(
          error.status === 404
            ? 'not_found'
            : error.status === 409
              ? 'conflict'
              : 'forbidden',
        );
      } else {
        failures++;
        gaveUp =
          options.retryLimit !== undefined && failures >= options.retryLimit;
        emit('error', snapshot !== null);
      }
    } finally {
      clearTimeout(timeout);
      active = null;
      if (!disposed && !forbidden) {
        if (pendingRefresh) {
          pendingRefresh = false;
          schedule(0);
        } else if (failures > 0) {
          // Bounded readers stop at the limit and pause while hidden.
          if (!gaveUp && !(options.retryLimit !== undefined && hidden()))
            schedule(Math.min(8000, 2000 * 2 ** Math.min(failures - 1, 2)));
        } else if (isPolling()) schedule(1000);
      }
    }
  }
  function refresh() {
    if (!disposed && !forbidden) {
      clearTimeout(timer);
      // An explicit refresh starts a new bounded series.
      if (gaveUp) {
        gaveUp = false;
        failures = 0;
      }
      void poll();
    }
  }
  /** Browser events resume paused retries but not ones that gave up. */
  function resume() {
    if (!gaveUp) refresh();
  }
  function onVisible() {
    if (options.lifecycle?.visibility.visibilityState === 'visible') resume();
  }
  options.lifecycle?.online.addEventListener('online', resume);
  options.lifecycle?.visibility.addEventListener('visibilitychange', onVisible);
  emit('loading');
  void poll();
  return {
    refresh,
    unsubscribe() {
      disposed = true;
      clearTimeout(timer);
      active?.abort();
      snapshot = null;
      options.lifecycle?.online.removeEventListener('online', resume);
      options.lifecycle?.visibility.removeEventListener(
        'visibilitychange',
        onVisible,
      );
    },
  };
}
