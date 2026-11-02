'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import {
  recordSaveInputSchema,
  recordUndoInputSchema,
  type RecordSaveResult,
  type RecordUndoResult,
} from '../../contracts/record';
import { createClock } from '../../lib/clock';
import { requireSession } from '../auth/next';
import { getDatabase } from '../db/client';
import { getEnv } from '../env';
import {
  saveRecordDraft,
  undoRecordSave,
  RecordSaveError,
  RecordSaveUnavailableError,
} from '../usecases/record-save';

function fields(issues: { path: PropertyKey[]; message: string }[]) {
  const result: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.') || 'form';
    (result[key] ??= []).push(issue.message);
  }
  return result;
}
function clocks() {
  const business = createClock(getEnv().APP_ENV);
  return {
    businessNow: () => business.now().toISOString(),
    // Never use the frozen demo/test business date for the undo deadline.
    wallNow: () => new Date().toISOString(),
  };
}
function knownFailure(error: unknown) {
  if (!(error instanceof RecordSaveError)) throw error;
  if (error.status === 'unavailable')
    throw new RecordSaveUnavailableError(error.reason);
  const { status, reason } = error;
  return { status, reason };
}
export async function saveRecordAction(
  input: unknown,
): Promise<RecordSaveResult> {
  const parsed = recordSaveInputSchema.safeParse(input);
  if (!parsed.success)
    return {
      status: 'validation_error',
      fieldErrors: fields(parsed.error.issues),
      input,
    };
  const session = await requireSession();
  try {
    const saved = await saveRecordDraft(
      getDatabase(),
      session.user.id,
      parsed.data,
      clocks(),
    );
    revalidatePath('/work');
    revalidatePath('/people');
    return { status: 'success', ...saved };
  } catch (error) {
    const failure = knownFailure(error);
    if (failure.status === 'conflict')
      return {
        status: 'conflict',
        message: '草稿或确认状态已变化，请刷新后重试',
        input: parsed.data,
      };
    return {
      status: failure.status,
      message:
        failure.status === 'forbidden'
          ? '你没有确认这份材料的权限'
          : '草稿或保存记录不存在',
    };
  }
}
export async function undoRecordAction(
  input: unknown,
): Promise<RecordUndoResult> {
  const parsed = recordUndoInputSchema.safeParse(input);
  if (!parsed.success)
    return {
      status: 'validation_error',
      fieldErrors: fields(parsed.error.issues),
      input,
    };
  const session = await requireSession();
  try {
    const undone = await undoRecordSave(
      getDatabase(),
      session.user.id,
      parsed.data,
      clocks(),
    );
    revalidatePath('/work');
    revalidatePath('/people');
    return { status: 'success', ...undone };
  } catch (error) {
    const failure = knownFailure(error);
    if (failure.status === 'conflict')
      return {
        status: 'conflict',
        message: '保存状态已变化或已超过撤销时间',
        input: parsed.data,
      };
    return {
      status: failure.status,
      message:
        failure.status === 'forbidden'
          ? '你没有撤销这次保存的权限'
          : '保存记录不存在',
    };
  }
}
