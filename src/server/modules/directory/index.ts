import { eq } from 'drizzle-orm';
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
export {
  people,
  organizations,
  accountBindings,
  grants,
  employments,
} from './schema';
export { projectDirectoryProfile } from './profile';
