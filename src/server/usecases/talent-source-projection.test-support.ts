import type { Transaction } from '../db/client';
import type { StoredArrangeInput } from '../modules/records';
import { readIntakeTable, type IntakeTable } from './talent-source-projection';

/** Tests only: issue a whole-table credential through the real readIntakeTable
 * entry, over in-memory rows instead of a database. */
export function intakeTableOf(
  rows: StoredArrangeInput[],
): Promise<IntakeTable> {
  const tx = {
    select: () => ({ from: async () => rows }),
  } as unknown as Transaction;
  return readIntakeTable(tx, 'snapshot');
}
