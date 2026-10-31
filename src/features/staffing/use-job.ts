'use client';
import { useEffect, useState } from 'react';
import type { JobSnapshot } from '@/contracts/jobs';
import {
  subscribeToJob,
  type JobSubscriptionState,
} from '@/lib/job-subscription';

/** The subscription state with the job's own snapshot type. */
export type JobState<S> = Omit<JobSubscriptionState<unknown>, 'snapshot'> & {
  snapshot: S | null;
};

/**
 * Follows one job until it settles. A null id means nothing to follow. The result lives
 * only in this subscription and is dropped on unmount; leaving never cancels the job.
 */
export function useJob<S extends JobSnapshot<unknown>>(
  jobId: string | null,
  read: (jobId: string, signal: AbortSignal) => Promise<S>,
): JobState<S> | null {
  const [state, setState] = useState<{
    jobId: string;
    value: JobState<S>;
  } | null>(null);
  useEffect(() => {
    if (!jobId) return;
    const subscription = subscribeToJob<unknown>({
      jobId,
      read,
      // The snapshot is the object `read` returned.
      onChange: (value) => setState({ jobId, value: value as JobState<S> }),
      lifecycle: { online: window, visibility: document },
    });
    return () => subscription.unsubscribe();
    // `read` comes from the page and is stable for one job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);
  return jobId && state?.jobId === jobId ? state.value : null;
}
