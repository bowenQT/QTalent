import 'server-only';
import { headers } from 'next/headers';
import type { JobResponse } from '../../contracts/jobs';
import { jobAccount } from '../jobs/request';
import { jobService } from '../jobs/runtime';
export async function readJobForCurrentUser(
  jobId: string,
): Promise<JobResponse> {
  if (!jobId || jobId.length > 200) return { status: 'validation_error' };
  const accountId = await jobAccount(await headers());
  if (!accountId) return { status: 'unauthenticated' };
  return jobService().read(accountId, jobId);
}
