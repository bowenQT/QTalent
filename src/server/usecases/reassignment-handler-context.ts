import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../db/client';
import { accountBindings, grants } from '../modules/directory';
import type { ReassignmentHrCandidateGrant } from '../authz/reassignment-handlers';

/** Server-only candidate authority facts; never part of a client/model DTO. */
export async function readReassignmentHrCandidates(
  db: DbExecutor,
): Promise<ReassignmentHrCandidateGrant[]> {
  const rows = await db
    .select({
      personId: accountBindings.personId,
      accountId: accountBindings.accountId,
      isSystemAdmin: accountBindings.isSystemAdmin,
      grant: {
        accountId: grants.accountId,
        role: grants.role,
        scope: grants.scope,
        cohortId: grants.cohortId,
        validFrom: grants.validFrom,
        validTo: grants.validTo,
        revokedAt: grants.revokedAt,
      },
    })
    .from(grants)
    .innerJoin(accountBindings, eq(accountBindings.accountId, grants.accountId))
    .where(eq(grants.role, 'hr'));
  return rows;
}
