'use server';
import 'server-only';
import { z } from 'zod';
import { requireSession } from '../auth/next';
import {
  staffingJobSnapshotSchema,
  staffingJudgmentResultSchema,
  type StaffingJobSnapshot,
} from '../../contracts/staffing';
import type { SourceReadResult } from '../../contracts/sources';
import { staffingMatchService } from '../queries/staffing-match-runtime';
import { readSourceForCurrentUser } from '../queries/sources';

/**
 * Candidate matching for the find-people page (BOW-854), thin over the matching
 * usecase: the account comes from the session, and who may start, read or judge is
 * decided by the usecase's own scope check, never here. Until the runtime is composed
 * (`staffing-match-runtime.ts`) every call answers `not_connected`.
 */
type Refused = {
  status: 'forbidden' | 'not_found' | 'conflict';
  message: string;
};
type NotConnected = { status: 'not_connected' };
export type OpenStaffingMatchResult =
  | { status: 'success'; jobId: string; replayed: boolean }
  | NotConnected
  | Refused
  | { status: 'validation_error'; fieldErrors: Record<string, string[]> };
export type ReadStaffingMatchResult =
  { status: 'success'; snapshot: StaffingJobSnapshot } | NotConnected | Refused;
export type JudgeStaffingMatchResult =
  z.infer<typeof staffingJudgmentResultSchema> | NotConnected;

const openInputSchema = z.strictObject({
  demandId: z.string().trim().min(1),
  revision: z.number().int().positive(),
});
const runIdSchema = z.string().trim().min(1);
const refusedMessage = '匹配范围或需求版本已变化，请重新读取';

function refused(status: string, message?: string): Refused {
  if (status === 'forbidden' || status === 'not_found' || status === 'conflict')
    return { status, message: message ?? refusedMessage };
  throw new Error(`Unexpected matching result: ${status}`);
}

/**
 * One matching run per account, demand and revision: the operation id is derived
 * from them, so opening the page again replays the same run instead of starting
 * another (and paying for the model calls again).
 */
export async function openStaffingMatchAction(
  input: unknown,
): Promise<OpenStaffingMatchResult> {
  const parsed = openInputSchema.safeParse(input);
  if (!parsed.success)
    return {
      status: 'validation_error',
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    };
  const session = await requireSession();
  const service = await staffingMatchService();
  if (!service) return { status: 'not_connected' };
  const { demandId, revision } = parsed.data;
  const result = await service.start(session.user.id, {
    operationId: JSON.stringify(['staffing-match-open', demandId, revision]),
    demandId,
    expectedRevision: revision,
  });
  if (result.status === 'success')
    return {
      status: 'success',
      jobId: result.runId,
      replayed: result.replayed,
    };
  if (result.status === 'validation_error')
    return { status: 'validation_error', fieldErrors: result.fieldErrors };
  return refused(result.status, result.message);
}

export async function readStaffingMatchAction(
  runId: unknown,
): Promise<ReadStaffingMatchResult> {
  const parsed = runIdSchema.safeParse(runId);
  if (!parsed.success) return refused('not_found', '这次核对不存在或不可见');
  const session = await requireSession();
  const service = await staffingMatchService();
  if (!service) return { status: 'not_connected' };
  const result = await service.read(session.user.id, parsed.data);
  if (result.status === 'success')
    return {
      status: 'success',
      snapshot: staffingJobSnapshotSchema.parse(result.snapshot),
    };
  // A run whose demand revision moved on is no longer this page's to show.
  if (result.status === 'stale') return refused('conflict');
  if (result.status === 'not_found')
    return refused('not_found', '这次核对不存在或不可见');
  return refused(result.status, result.message);
}

export async function judgeStaffingMatchAction(
  runId: unknown,
  input: unknown,
): Promise<JudgeStaffingMatchResult> {
  const parsed = runIdSchema.safeParse(runId);
  if (!parsed.success)
    return staffingJudgmentResultSchema.parse({
      status: 'not_found',
      message: '这次核对不存在或不可见',
      input,
    });
  const session = await requireSession();
  const service = await staffingMatchService();
  if (!service) return { status: 'not_connected' };
  return staffingJudgmentResultSchema.parse(
    await service.judge(session.user.id, parsed.data, input),
  );
}

/** Opening a cited source: the same current-account source read the profile uses. */
export async function readStaffingSourceAction(
  input: unknown,
): Promise<SourceReadResult> {
  return readSourceForCurrentUser(input);
}
