import type { DbExecutor } from '../db/client';
import { activeGrants } from '../authz';
import type { ReassignmentAuthzContext } from '../authz/reassignment-handlers';
import { readReassignmentHrCandidates } from './reassignment-handler-context';
import { readEvaluationAuthorizationFacts } from '../modules/programs';
import { loadProjectContext } from './project-context';

/** Fresh server-owned facts; never consume node/grant lists from a request. */
export async function loadEvaluationContext(
  db: DbExecutor,
  accountId: string,
  now: string,
) {
  const base = await loadProjectContext(db, accountId, now);
  const facts = await readEvaluationAuthorizationFacts(db);
  const context: ReassignmentAuthzContext = {
    ...base.context,
    ...facts,
    hrCandidateGrants: activeGrants(base.context).some(
      (grant) => grant.role === 'hr',
    )
      ? await readReassignmentHrCandidates(db)
      : [],
  };
  return { ...base, facts, context };
}
