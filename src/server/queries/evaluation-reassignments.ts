import 'server-only';
import { createClock } from '../../lib/clock';
import { requireSession } from '../auth/next';
import { getDatabase } from '../db/client';
import { getEnv } from '../env';
import { EvaluationReassignmentError } from '../modules/programs';
import { ForbiddenError } from '../usecases/project-context';
import { readEvaluationReassignments } from '../usecases/read-evaluation-reassignments';

export async function readEvaluationReassignmentsForCurrentUser() {
  const session = await requireSession();
  try {
    const result = await readEvaluationReassignments(
      getDatabase(),
      session.user.id,
      createClock(getEnv().APP_ENV).now().toISOString(),
    );
    return { status: 'success' as const, ...result };
  } catch (error) {
    if (
      error instanceof ForbiddenError ||
      (error instanceof EvaluationReassignmentError &&
        error.status === 'forbidden')
    )
      return {
        status: 'forbidden' as const,
        message: '你没有查看重新分派事项的权限',
      };
    throw error;
  }
}
