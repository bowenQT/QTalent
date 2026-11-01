import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client';
import { confirmations } from './schema';
/** Suggestions never enter this read path. */
export async function readActiveConfirmations(db: DbExecutor) {
  return db.select().from(confirmations).where(eq(confirmations.active, true));
}
