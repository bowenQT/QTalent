import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  evaluationReassignmentFingerprint,
  planEvaluationReassignment,
  readEvaluationWorkItemForUpdate,
  readEvaluationReassignmentOperation,
  persistEvaluationReassignment,
  EvaluationReassignmentError,
  type ReassignEvaluationWorkInput,
} from '../modules/programs';
import { recordAudit } from '../platform/audit';
import { ForbiddenError } from './project-context';
import { loadEvaluationContext } from './evaluation-context';

/** Session/transport resolves accountId. A browser cannot choose the actor. */
export async function reassignEvaluationWork(
  db: Database,
  accountId: string,
  input: ReassignEvaluationWorkInput,
  now: string,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(
        async (tx) => {
          // Actor/key lock also serializes the same key with a different work item.
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([accountId, input.operationId])},0))`,
          );
          const item = await readEvaluationWorkItemForUpdate(
            tx,
            input.workItemId,
          );
          const { context } = await loadEvaluationContext(tx, accountId, now);
          const operation = await readEvaluationReassignmentOperation(
            tx,
            accountId,
            input.operationId,
          );
          const result = planEvaluationReassignment(
            context,
            item,
            input,
            operation,
          );
          if (result.replayed) return result;
          await persistEvaluationReassignment(
            tx,
            accountId,
            input,
            evaluationReassignmentFingerprint(input),
            result.receipt,
          );
          await recordAudit(tx, {
            actorId: accountId,
            action: 'evaluation_work.reassign',
            resourceId: input.workItemId,
          });
          return result;
        },
        { isolationLevel: 'serializable' },
      );
    } catch (error) {
      if (error instanceof ForbiddenError)
        throw new EvaluationReassignmentError(
          'forbidden',
          '你没有重新分派此事项的权限',
        );
      const cause = error instanceof Error && error.cause ? error.cause : error;
      if (
        typeof cause === 'object' &&
        cause !== null &&
        'code' in cause &&
        (cause.code === '40001' ||
          (cause.code === '23505' &&
            'constraint' in cause &&
            cause.constraint === 'programs_reassignment_actor_operation_pk'))
      ) {
        if (attempt < 2) continue;
        throw new EvaluationReassignmentError(
          'conflict',
          '事项正在更新，请保留输入后重试',
          { cause: error },
        );
      }
      throw error;
    }
  }
}
