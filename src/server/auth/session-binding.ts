import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../db/client';
import { accountBindings } from '../modules/directory';

/** Better Auth persists this on auth_session; it is never client input. */
export const sessionBindingFields = {
  bindingGeneration: { type: 'number', required: false, input: false },
} as const;

/** Stamp a new Web session with the account's directory binding generation at
 * issue time. A rebind (including A→B→A) advances the generation, so the entry
 * adapter rejects sessions issued under an earlier binding. A rebind racing
 * this read leaves the older generation, which fails closed. An unbound
 * account gets null, which the entry adapter also rejects. */
export async function stampSessionBindingGeneration<
  T extends { userId: string },
>(db: DbExecutor, session: T) {
  const [row] = await db
    .select({ generation: accountBindings.generation })
    .from(accountBindings)
    .where(eq(accountBindings.accountId, session.userId))
    .limit(1);
  return { data: { ...session, bindingGeneration: row?.generation ?? null } };
}
