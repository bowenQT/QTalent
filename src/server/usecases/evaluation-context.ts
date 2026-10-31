import type { DbExecutor } from '../db/client';
import type { EvaluationAuthzContext } from '../authz/evaluation-node';
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
  const context: EvaluationAuthzContext = { ...base.context, ...facts };
  return { ...base, facts, context };
}
