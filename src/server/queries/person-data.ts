import 'server-only';
import type { Database } from '../db/client';
import { loadProjectContext } from '../usecases/project-context';
import { readEvidenceForTalent, readWithdrawnRecordEventIds } from '../modules/records';
import { readTalentEvaluationRules } from '../modules/evaluation-system';
import { readActiveConfirmations } from '../modules/talent';
export {
  eventSubject,
  sourceKey,
  talentSources,
} from '../usecases/talent-source-projection';

/** Complete provenance is loaded before person filtering, including shared
 * fragments. This bounded P0 read does not use the prototype import archive.
 */
export async function loadPersonData(
  db: Database,
  accountId: string,
  today: string,
) {
  return db.transaction(
    async (tx) => {
      const base = await loadProjectContext(tx, accountId, today);
      return {
        ...base,
        ...(await readEvidenceForTalent(tx)),
        ...(await readTalentEvaluationRules(tx)),
        confirmations: await readActiveConfirmations(tx),
        withdrawnEventIds: await readWithdrawnRecordEventIds(tx),
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
export type PersonData = Awaited<ReturnType<typeof loadPersonData>>;
