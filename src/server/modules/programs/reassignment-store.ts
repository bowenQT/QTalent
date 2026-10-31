import { and, eq } from 'drizzle-orm';
import type { DbExecutor, Transaction } from '../../db/client';
import type { EvaluationAuthzContext } from '../../authz/evaluation-node';
import {
  canWorkOnEvaluationItem,
  EvaluationReassignmentError,
} from './reassignment-policy';
import {
  evaluationNodes,
  evaluationNodeSubjects,
  evaluationRelations,
  evaluationWorkItems,
  evaluationReassignmentOperations,
} from './schema';
import {
  evaluationReassignmentReceiptSchema,
  type EvaluationReassignmentReceipt,
  type ReassignEvaluationWorkInput,
  type EvaluationWorkItem,
} from './reassignment-contract';

export async function readEvaluationAuthorizationFacts(db: DbExecutor) {
  return {
    evaluationNodes: await db.select().from(evaluationNodes),
    evaluationNodeSubjects: await db.select().from(evaluationNodeSubjects),
    evaluationRelations: await db.select().from(evaluationRelations),
  };
}
export async function readEvaluationWorkItems(db: DbExecutor) {
  return db.select().from(evaluationWorkItems);
}
export async function readEvaluationWorkItemForUpdate(
  tx: Transaction,
  id: string,
) {
  const [item] = await tx
    .select()
    .from(evaluationWorkItems)
    .where(eq(evaluationWorkItems.id, id))
    .for('update');
  return item ?? null;
}
export async function readEvaluationReassignmentOperation(
  db: DbExecutor,
  accountId: string,
  operationId: string,
) {
  const [operation] = await db
    .select()
    .from(evaluationReassignmentOperations)
    .where(
      and(
        eq(evaluationReassignmentOperations.accountId, accountId),
        eq(evaluationReassignmentOperations.operationId, operationId),
      ),
    );
  return operation
    ? {
        fingerprint: operation.fingerprint,
        receipt: evaluationReassignmentReceiptSchema.parse(operation.receipt),
      }
    : null;
}
/** Caller owns the transaction: update, stored result and audit commit together. */
export async function persistEvaluationReassignment(
  tx: Transaction,
  accountId: string,
  input: ReassignEvaluationWorkInput,
  fingerprint: string,
  receipt: EvaluationReassignmentReceipt,
) {
  const rows = await tx
    .update(evaluationWorkItems)
    .set({
      assignedRelationId: receipt.assignedRelationId,
      assignedEvaluatorId: receipt.assignedEvaluatorId,
      revision: receipt.revision,
      updatedAt: receipt.reassignedAt,
    })
    .where(
      and(
        eq(evaluationWorkItems.id, input.workItemId),
        eq(evaluationWorkItems.revision, input.expectedRevision),
      ),
    )
    .returning({ id: evaluationWorkItems.id });
  if (rows.length !== 1)
    throw new Error('Locked evaluation work item changed unexpectedly');
  await tx.insert(evaluationReassignmentOperations).values({
    accountId,
    operationId: input.operationId,
    workItemId: input.workItemId,
    fingerprint,
    receipt,
  });
}

/**
 * Trusted source usecases authorize creation before calling this port inside
 * their business transaction. resourceId identifies their confirmation/review
 * TASK (not a person/event). Replay returns current ownership and never resets
 * a reassignment, completed state or revision.
 */
export async function insertEvaluationWorkItem(
  tx: Transaction,
  input: Omit<EvaluationWorkItem, 'revision' | 'updatedAt' | 'state'>,
  now: string,
) {
  const [created] = await tx
    .insert(evaluationWorkItems)
    .values({
      ...input,
      state: 'pending',
      revision: 1,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [
        evaluationWorkItems.evaluationNodeId,
        evaluationWorkItems.personId,
        evaluationWorkItems.kind,
        evaluationWorkItems.resourceId,
      ],
    })
    .returning();
  if (created) return created;
  const [existing] = await tx
    .select()
    .from(evaluationWorkItems)
    .where(
      and(
        eq(evaluationWorkItems.evaluationNodeId, input.evaluationNodeId),
        eq(evaluationWorkItems.personId, input.personId),
        eq(evaluationWorkItems.kind, input.kind),
        eq(evaluationWorkItems.resourceId, input.resourceId),
      ),
    );
  if (!existing) throw new Error('Evaluation work identity disappeared');
  return existing;
}
/**
 * Source payload and completion commit in the SAME transaction. The callback
 * reloads current scope/time only after the work lock; never pass a page/cache.
 * Source transactions use Read Committed plus this row/version fence, so a
 * snapshot from before the wait cannot resurrect a committed revocation.
 */
export async function completeEvaluationWorkItem(
  tx: Transaction,
  workItemId: string,
  expectedRevision: number,
  loadCurrentContext: (tx: Transaction) => Promise<EvaluationAuthzContext>,
) {
  const item = await readEvaluationWorkItemForUpdate(tx, workItemId);
  if (!item)
    throw new EvaluationReassignmentError('not_found', '事项不存在或不可见');
  const context = await loadCurrentContext(tx);
  if (!canWorkOnEvaluationItem(context, item))
    throw new EvaluationReassignmentError(
      'forbidden',
      '此事项已不在你的当前处理范围',
    );
  if (item.revision !== expectedRevision)
    throw new EvaluationReassignmentError(
      'conflict',
      '事项已重新分派，请刷新后处理',
    );
  const [completed] = await tx
    .update(evaluationWorkItems)
    .set({
      state: 'completed',
      revision: item.revision + 1,
      updatedAt: context.now,
    })
    .where(eq(evaluationWorkItems.id, item.id))
    .returning();
  return completed;
}
