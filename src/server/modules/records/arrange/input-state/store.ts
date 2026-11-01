import { and, eq, sql } from 'drizzle-orm';
import type { DbExecutor, Transaction } from '../../../../db/client';
import { arrangeInputs, arrangeOperations } from './schema';
export async function lockArrangeOperation(
  tx: Transaction,
  accountId: string,
  action: 'create' | 'select',
  operationId: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['record-arrange-operation', accountId, action, operationId])},0))`,
  );
}
export async function readArrangeInput(db: DbExecutor, id: string) {
  const [row] = await db
    .select()
    .from(arrangeInputs)
    .where(eq(arrangeInputs.id, id));
  return row ?? null;
}
export async function lockArrangeInput(tx: Transaction, id: string) {
  const [row] = await tx
    .select()
    .from(arrangeInputs)
    .where(eq(arrangeInputs.id, id))
    .for('update');
  return row ?? null;
}
export async function readArrangeOperation(
  db: DbExecutor,
  accountId: string,
  action: 'create' | 'select',
  operationId: string,
) {
  const [row] = await db
    .select()
    .from(arrangeOperations)
    .where(
      and(
        eq(arrangeOperations.actorAccountId, accountId),
        eq(arrangeOperations.action, action),
        eq(arrangeOperations.operationId, operationId),
      ),
    );
  return row ?? null;
}
export async function insertArrangeInput(
  tx: Transaction,
  input: typeof arrangeInputs.$inferInsert,
) {
  await tx.insert(arrangeInputs).values(input);
}
export async function supersedeArrangeInput(
  tx: Transaction,
  id: string,
  nextId: string,
) {
  await tx
    .update(arrangeInputs)
    .set({ supersededByInputId: nextId })
    .where(eq(arrangeInputs.id, id));
}
export async function insertArrangeOperation(
  tx: Transaction,
  operation: typeof arrangeOperations.$inferInsert,
) {
  await tx.insert(arrangeOperations).values(operation);
}
