'use server';
import 'server-only';
import { headers } from 'next/headers';
import { jobCommandSchema, type JobResponse } from '../../contracts/jobs';
import { jobAccount } from '../jobs/request';
import { jobService } from '../jobs/runtime';
export async function commandJobAction(input: unknown): Promise<JobResponse> {
  const parsed = jobCommandSchema.safeParse(input);
  if (!parsed.success) return { status: 'validation_error' };
  const accountId = await jobAccount(await headers());
  if (!accountId) return { status: 'unauthenticated' };
  return jobService().command(accountId, parsed.data);
}
