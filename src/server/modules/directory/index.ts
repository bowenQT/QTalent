import { eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client';
import { accountBindings, grants, people, organizations } from './schema';
export async function readDirectory(db: DbExecutor, accountId: string) {
  const [account] = await db
    .select()
    .from(accountBindings)
    .where(eq(accountBindings.accountId, accountId));
  if (!account) return null;
  return {
    account: {
      id: account.accountId,
      personId: account.personId,
      isSystemAdmin: account.isSystemAdmin,
    },
    grants: await db
      .select()
      .from(grants)
      .where(eq(grants.accountId, accountId)),
    people: await db.select().from(people),
    organizations: await db.select().from(organizations),
  };
}
/** The only writer that changes an account's person. Binding, rebinding and
 * unbinding to a placeholder all advance `generation` in one statement, so
 * earlier entry credentials stay invalid. Returns null for an unknown account. */
export async function rebindDirectoryAccount(
  db: DbExecutor,
  input: { accountId: string; personId: string },
): Promise<{ generation: number } | null> {
  const [row] = await db
    .update(accountBindings)
    .set({
      personId: input.personId,
      generation: sql`${accountBindings.generation} + 1`,
    })
    .where(eq(accountBindings.accountId, input.accountId))
    .returning({ generation: accountBindings.generation });
  return row ?? null;
}
export {
  people,
  organizations,
  accountBindings,
  grants,
  employments,
} from './schema';
