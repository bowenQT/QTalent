import { z } from 'zod';
import { materialBatchInputSchema } from '../../contracts/materials';
import { getDatabase, type Database } from '../db/client';
import { canWriteArrange, loadArrangeActor } from './record-arrange-context';
import { ForbiddenError } from './project-context';

export type RecordEvaluationNodeResolution =
  | { status: 'unique'; evaluationNodeId: string }
  | { status: 'multiple' }
  | { status: 'none' };

const selectionSchema = z.strictObject({
  personIds: materialBatchInputSchema.shape.personIds,
  projectId: materialBatchInputSchema.shape.projectId,
});
export class RecordNodeResolutionUnavailable extends Error {
  constructor() {
    super('unavailable');
    this.name = 'RecordNodeResolutionUnavailable';
  }
}

/** Read-only discovery, never a save authorization or a durable permission.
 * All selected people must share the same currently writable node. Empty
 * selection has no owner-approved "self" meaning and fails closed.
 */
export function createRecordEvaluationNodeResolver(options: {
  db: Database;
  businessNow?: () => string;
}) {
  return async function resolve(
    accountId: string,
    input: unknown,
  ): Promise<RecordEvaluationNodeResolution> {
    try {
      const parsed = selectionSchema.safeParse(input);
      if (!accountId.trim() || !parsed.success || !parsed.data.personIds.length)
        return { status: 'none' };
      const at = (options.businessNow ?? (() => new Date().toISOString()))();
      if (!Number.isFinite(Date.parse(at)))
        throw new RecordNodeResolutionUnavailable();
      return await options.db.transaction(
        async (tx): Promise<RecordEvaluationNodeResolution> => {
          const actor = await loadArrangeActor(tx, accountId, at);
          const matches = new Set<string>();
          for (const node of actor.context.evaluationNodes) {
            if (
              canWriteArrange(
                actor,
                parsed.data.personIds,
                parsed.data.projectId,
                node.id,
              )
            )
              matches.add(node.id);
            if (matches.size > 1) return { status: 'multiple' };
          }
          const [evaluationNodeId] = matches;
          return evaluationNodeId === undefined
            ? { status: 'none' }
            : { status: 'unique', evaluationNodeId };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    } catch (error) {
      if (error instanceof ForbiddenError) return { status: 'none' };
      throw new RecordNodeResolutionUnavailable();
    }
  };
}

/** Production entry: identity comes from the authenticated server action.
 * The subsequent producer must still recheck current authority on submission.
 */
export async function resolveRecordEvaluationNode(
  accountId: string,
  input: unknown,
): Promise<RecordEvaluationNodeResolution> {
  try {
    return await createRecordEvaluationNodeResolver({ db: getDatabase() })(
      accountId,
      input,
    );
  } catch {
    throw new RecordNodeResolutionUnavailable();
  }
}
