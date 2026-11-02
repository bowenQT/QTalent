import { createHash } from 'node:crypto';
import type { Database, Transaction } from '../../db/client';
import { loadEvaluationContext } from '../evaluation-context';
import { arrangeInputs, readEvidenceForTalent } from '../../modules/records';
import {
  readTalentEvaluationRules,
  ruleVersions,
} from '../../modules/evaluation-system';
import {
  readActiveConfirmations,
  scoreReviews,
  aiSuggestions,
} from '../../modules/talent';
import { cohorts, evaluationNodes } from '../../modules/programs';
import { recordAudit } from '../../platform/audit';
import type { ExportStore } from './types';
/** All data comes from existing authoritative readers/tables. Native withdrawal
 * and review ownership columns are the fixed BOW-846 dependency, not defaults.
 */
export function createPostgresTalentExportStore(
  db: Database,
): ExportStore<Transaction> {
  return {
    transaction(work) {
      return db.transaction(work, { isolationLevel: 'read committed' });
    },
    async readSnapshot(tx, accountId, now) {
      const base = await loadEvaluationContext(tx, accountId, now);
      return {
        context: base.context,
        directory: base.directory,
        staffing: base.staffing,
        ...(await readEvidenceForTalent(tx)),
        // Complete intake table, unfiltered: its subjects and requiredKinds
        // restrict exported quotes exactly as on the profile read path.
        intakeInputs: await tx.select().from(arrangeInputs),
        ...(await readTalentEvaluationRules(tx)),
        confirmations: await readActiveConfirmations(tx),
        reviews: await tx.select().from(scoreReviews),
        suggestions: await tx.select().from(aiSuggestions),
        cohorts: await tx.select().from(cohorts),
        nodes: await tx.select().from(evaluationNodes),
        ruleVersions: await tx.select().from(ruleVersions),
      };
    },
    async audit(tx, value) {
      // Audit the request's meaning, never its exported cells, names or raw input.
      const resourceId =
        'talent-export:' +
        createHash('sha256')
          .update(JSON.stringify(value.request))
          .digest('hex');
      await recordAudit(tx, {
        actorId: value.accountId,
        action: `talent-export.${value.phase}.${value.outcome}`,
        resourceId,
      });
    },
  };
}
