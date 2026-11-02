import 'server-only';
import type { Database, Transaction } from '../db/client';
import { loadEvaluationContext } from '../usecases/evaluation-context';
import { readEvidenceForTalent } from '../modules/records';
import { readIntakeTable } from '../usecases/talent-source-projection';
import { readTalentEvaluationRules } from '../modules/evaluation-system';
import { readActiveConfirmations } from '../modules/talent';
import { employments } from '../modules/directory';
import { cohorts } from '../modules/programs';
import type { TalentAuthorizationContext } from '../authz/talent';

/** Complete provenance is loaded before person filtering, including shared
 * fragments. This bounded P0 read does not use the prototype import archive.
 */
export async function loadPersonData(
  db: Database,
  accountId: string,
  now: string,
) {
  return db.transaction(
    (tx) => loadPersonDataInTransaction(tx, accountId, now),
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

/** The caller owns the transaction and its snapshot. Authorization facts are
 * read here, not accepted from an earlier actor or permission snapshot.
 */
export async function loadPersonDataInTransaction(
  tx: Transaction,
  accountId: string,
  now: string,
) {
  const base = await loadEvaluationContext(tx, accountId, now);
  const context: TalentAuthorizationContext = base.context;
  return {
    context,
    directory: base.directory,
    staffing: base.staffing,
    ...(await readEvidenceForTalent(tx)),
    ...(await readTalentEvaluationRules(tx)),
    confirmations: await readActiveConfirmations(tx),
    // Same caller-owned snapshot, before any person/source filtering.
    // Superseded inputs and other creators remain provenance restrictions.
    intake: await readIntakeTable(tx, 'snapshot'),
    // Batch names and hire dates for the identity header.
    cohorts: await tx.select().from(cohorts),
    employments: await tx.select().from(employments),
  };
}
export type PersonData = Awaited<ReturnType<typeof loadPersonData>>;
export {
  eventSubject,
  historicalSubject,
  sourceKey,
  completeTalentSources,
} from '../usecases/talent-source-projection';
/** Public date fields use the business day; authorization keeps the complete instant. */
export const personBusinessDay = (data: PersonData) =>
  data.context.now.slice(0, 10);
