import 'server-only';
import type { Database } from '../db/client';
import { loadEvaluationContext } from '../usecases/evaluation-context';
import { readEvidenceForTalent, arrangeInputs } from '../modules/records';
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
    async (tx) => {
      const base = await loadEvaluationContext(tx, accountId, now);
      const context: TalentAuthorizationContext = base.context;
      return {
        context,
        directory: base.directory,
        staffing: base.staffing,
        ...(await readEvidenceForTalent(tx)),
        ...(await readTalentEvaluationRules(tx)),
        confirmations: await readActiveConfirmations(tx),
        // Same repeatable-read snapshot, before any person/source filtering.
        // Superseded inputs and other creators remain provenance restrictions.
        intakeInputs: await tx.select().from(arrangeInputs),
        // Batch names and hire dates for the identity header.
        cohorts: await tx.select().from(cohorts),
        employments: await tx.select().from(employments),
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
export type PersonData = Awaited<ReturnType<typeof loadPersonData>>;
export {
  eventSubject,
  historicalSubject,
  sourceKey,
  talentSources,
} from '../usecases/talent-source-projection';
/** Public date fields use the business day; authorization keeps the complete instant. */
export const personBusinessDay = (data: PersonData) =>
  data.context.now.slice(0, 10);
