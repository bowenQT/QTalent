'use client';
import { useEffect, useState } from 'react';
import type { JobSnapshot } from '@/contracts/jobs';
import {
  JobReadError,
  subscribeToJob,
  type JobSubscriptionOptions,
  type JobSubscriptionState,
} from '@/lib/job-subscription';

/**
 * The subscription state with the job's own snapshot type. The shared subscription
 * reports a 401 and a 403 alike as `forbidden`; `signedOut` tells the 401 apart, since
 * only then does signing in again help.
 */
export type JobState<S> = Omit<JobSubscriptionState<unknown>, 'snapshot'> & {
  snapshot: S | null;
  signedOut: boolean;
  /** The last read failed with {@link notConnectedStatus}. */
  notConnected: boolean;
  /** Reads again now, starting a new bounded series after `gaveUp`. */
  retry: () => void;
};
type ReadPolicy = Pick<
  JobSubscriptionOptions<unknown>,
  'stopOnConflict' | 'retryLimit'
>;
/** A reader's "not connected yet": transient, so the subscription retries it. */
export const notConnectedStatus = 503;

/**
 * Follows one job until it settles. A null id means nothing to follow. The result lives
 * only in this subscription and is dropped on unmount; leaving never cancels the job.
 */
export function useJob<S extends JobSnapshot<unknown>>(
  jobId: string | null,
  read: (jobId: string, signal: AbortSignal) => Promise<S>,
  policy: ReadPolicy = {},
): JobState<S> | null {
  const [state, setState] = useState<{
    jobId: string;
    value: JobState<S>;
  } | null>(null);
  useEffect(() => {
    if (!jobId) return;
    let lastStatus: number | null = null;
    const subscription = subscribeToJob<unknown>({
      ...policy,
      jobId,
      read: async (id, signal) => {
        try {
          const snapshot = await read(id, signal);
          lastStatus = null;
          return snapshot;
        } catch (error) {
          lastStatus = error instanceof JobReadError ? error.status : null;
          throw error;
        }
      },
      // The snapshot is the object `read` returned.
      onChange: (value) =>
        setState({
          jobId,
          value: {
            ...(value as Omit<
              JobState<S>,
              'signedOut' | 'notConnected' | 'retry'
            >),
            signedOut: value.connection === 'forbidden' && lastStatus === 401,
            notConnected:
              value.connection === 'error' && lastStatus === notConnectedStatus,
            // Called only after subscribing returned.
            retry: () => subscription.refresh(),
          },
        }),
      lifecycle: { online: window, visibility: document },
    });
    return () => subscription.unsubscribe();
    // `read` and `policy` come from the page and are stable for one job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);
  return jobId && state?.jobId === jobId ? state.value : null;
}
