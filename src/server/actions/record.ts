'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import {
  recordSaveInputSchema,
  recordUndoInputSchema,
  type RecordSaveResult,
  type RecordUndoResult,
} from '../../contracts/record';
import { requireSession } from '../auth/next';
import { getDatabase } from '../db/client';
import { getEnv } from '../env';
import { createClock } from '../../lib/clock';
import { createRecordSaveService } from '../usecases/record-save';

export async function saveRecordAction(
  input: unknown,
): Promise<RecordSaveResult> {
  const parsed = recordSaveInputSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'form');
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { status: 'validation_error', fieldErrors, input };
  }
  const session = await requireSession();
  const service = createRecordSaveService({
    db: getDatabase(),
    businessDate: () => createClock(getEnv().APP_ENV).today(),
    now: () => new Date(),
  });
  const result = await service.save(session.user.id, parsed.data);
  if (result.status === 'success') {
    revalidatePath('/people');
    revalidatePath('/record');
    revalidatePath('/queue');
  }
  return result;
}
export async function undoRecordAction(
  input: unknown,
): Promise<RecordUndoResult> {
  const parsed = recordUndoInputSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'form');
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { status: 'validation_error', fieldErrors, input };
  }
  const session = await requireSession();
  const service = createRecordSaveService({
    db: getDatabase(),
    businessDate: () => createClock(getEnv().APP_ENV).today(),
    now: () => new Date(),
  });
  const result = await service.undo(session.user.id, parsed.data);
  if (result.status === 'success') {
    revalidatePath('/people');
    revalidatePath('/record');
    revalidatePath('/queue');
  }
  return result;
}
