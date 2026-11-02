'use server';
import 'server-only';
import { headers } from 'next/headers';
import type { RecordUndoResult } from '../../contracts/record';
import { jobAccount, sessionLost } from '../jobs/request';
import { undoRecordAction } from './record';

export type RecordUndoRequestResult =
  RecordUndoResult | { status: 'unauthenticated' };

/**
 * The record undo behind the POST route (`/api/record/undo`, BOW-847). Undo has a
 * five-second window, so it does not go through the page's serial Server Action
 * queue. It first checks the request's access identity and session the way
 * `/api/jobs` does and answers `unauthenticated` instead of redirecting; then it is
 * the same undo action, with the same permission checks and replay. A session that
 * ends while the undo runs is also `unauthenticated`. Other failures throw; the
 * route answers 503.
 */
export async function undoRecordForRequest(
  input: unknown,
): Promise<RecordUndoRequestResult> {
  const requestHeaders = await headers();
  if (!(await jobAccount(requestHeaders))) return { status: 'unauthenticated' };
  try {
    return await undoRecordAction(input);
  } catch (error) {
    if (await sessionLost(requestHeaders, error))
      return { status: 'unauthenticated' };
    throw error;
  }
}
