'use server';
import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import {
  interviewImportConfirmInputSchema,
  interviewImportSendInputSchema,
  type InterviewImportRowResult,
} from '../../contracts/interview-import';
import { createClock } from '../../lib/clock';
import { requireSession } from '../auth/next';
import { getDatabase } from '../db/client';
import { getEnv } from '../env';
import {
  confirmInterviewImportRow,
  sendInterviewImportRowToReview,
} from '../usecases/interview-import/store';

/** HR confirms who a row is, or takes it back, at the revision the page last read. */
export async function confirmInterviewImportRowAction(
  input: unknown,
): Promise<InterviewImportRowResult> {
  const parsed = interviewImportConfirmInputSchema.safeParse(input);
  if (!parsed.success)
    return { status: 'conflict', message: '这一行已变化，请刷新后再看' };
  const session = await requireSession();
  try {
    return await confirmInterviewImportRow(
      getDatabase(),
      session.user.id,
      parsed.data,
      {
        now: createClock(getEnv().APP_ENV).now().toISOString(),
        // Never stamp a stored change with the frozen demo business date.
        at: new Date().toISOString(),
      },
    );
  } catch (error) {
    unstable_rethrow(error);
    return {
      status: 'unavailable',
      message: '保存失败，已保留当前内容，请稍后再试',
    };
  }
}

/** HR sends a row nobody in the directory matches to 待核对. */
export async function sendInterviewImportRowToReviewAction(
  input: unknown,
): Promise<InterviewImportRowResult> {
  const parsed = interviewImportSendInputSchema.safeParse(input);
  if (!parsed.success)
    return { status: 'conflict', message: '这一行已变化，请刷新后再看' };
  const session = await requireSession();
  try {
    return await sendInterviewImportRowToReview(
      getDatabase(),
      session.user.id,
      parsed.data,
      {
        now: createClock(getEnv().APP_ENV).now().toISOString(),
        at: new Date().toISOString(),
      },
    );
  } catch (error) {
    unstable_rethrow(error);
    return {
      status: 'unavailable',
      message: '保存失败，已保留当前内容，请稍后再试',
    };
  }
}
