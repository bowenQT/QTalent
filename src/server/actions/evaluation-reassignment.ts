'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { createClock } from '../../lib/clock';
import { requireSession } from '../auth/next';
import { getDatabase } from '../db/client';
import { getEnv } from '../env';
import {
  reassignEvaluationWorkInputSchema,
  EvaluationReassignmentError,
  type ReassignEvaluationWorkResult,
} from '../modules/programs';
import { reassignEvaluationWork } from '../usecases/reassign-evaluation-work';

export async function reassignEvaluationWorkAction(
  input: unknown,
): Promise<ReassignEvaluationWorkResult> {
  const parsed = reassignEvaluationWorkInputSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? 'form');
      (fieldErrors[field] ??= []).push(issue.message);
    }
    return { status: 'validation_error', fieldErrors, input };
  }
  const session = await requireSession();
  try {
    const result = await reassignEvaluationWork(
      getDatabase(),
      session.user.id,
      parsed.data,
      createClock(getEnv().APP_ENV).now().toISOString(),
    );
    revalidatePath('/work');
    return { status: 'success', ...result };
  } catch (error) {
    if (error instanceof EvaluationReassignmentError) {
      if (error.status === 'conflict')
        return {
          status: 'conflict',
          message: error.message,
          input: parsed.data,
        };
      return { status: error.status, message: error.message };
    }
    throw error;
  }
}
