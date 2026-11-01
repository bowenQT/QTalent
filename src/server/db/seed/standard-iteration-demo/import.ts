import { eq, inArray } from 'drizzle-orm';
import type { Database, Transaction } from '../../client';
import { insertChecked } from '../../import';
import { people } from '../../../modules/directory';
import { cohorts } from '../../../modules/programs';
import {
  originals,
  originalVersions,
  fragments,
} from '../../../modules/records';
import {
  canonicalComparisonJson,
  lockCanonicalComparisonBatch,
  readSelectionCohortFacts,
} from '../../../modules/evaluation-system';
import { writeCanonicalComparisonBatch } from '../../../usecases/judgment-comparison-canonical';
import {
  prepareStandardIterationDemo,
  readStandardIterationFactFiles,
  type PreparedStandardIterationDemo,
} from './input';

export class StandardIterationImportError extends Error {
  constructor(
    readonly code:
      | 'directory_mismatch'
      | 'cohort_mismatch'
      | 'selection_binding_unavailable'
      | 'selection_binding_mismatch',
  ) {
    super(code);
    this.name = 'StandardIterationImportError';
  }
}

// The fixture labels display names with this exact suffix; IDs remain the
// identity. Do not fuzzy-match, strip arbitrary names or create missing people.
function sameDemoLabel(stored: string, fixture: string) {
  return fixture === stored || fixture === `${stored}（演示）`;
}
async function verifyDirectory(
  tx: Transaction,
  plan: PreparedStandardIterationDemo,
) {
  const expected = new Map(plan.requiredPeople.map((p) => [p.id, p.name]));
  const found = await tx
    .select({ id: people.id, name: people.name, demo: people.demo })
    .from(people)
    .where(inArray(people.id, [...expected.keys()].sort()))
    .orderBy(people.id)
    .for('share');
  if (
    found.length !== expected.size ||
    found.some((p) => !p.demo || !sameDemoLabel(p.name, expected.get(p.id)!))
  )
    throw new StandardIterationImportError('directory_mismatch');
  const cohort = (
    await tx
      .select()
      .from(cohorts)
      .where(eq(cohorts.id, plan.cohort.id))
      .for('share')
  )[0];
  if (!cohort || !sameDemoLabel(cohort.name, plan.cohort.name))
    throw new StandardIterationImportError('cohort_mismatch');
}

/** Operator-only fixed-source import; not an HTTP or authorization entry point.
 * No caller-supplied prepared plan can claim the pinned Git provenance. The
 * existing 918 baseline/binding and 899 node graph must have been established by
 * their native entry points. Missing facts are errors, never created here.
 */
export async function importStandardIterationDemo(
  db: Database,
  repositoryDirectory: string,
) {
  const plan = await prepareStandardIterationDemo(
    await readStandardIterationFactFiles(repositoryDirectory),
  );
  return db.transaction(
    async (tx) => {
      // Same lock as 919, acquired before any records registration. Both repeat
      // importers and canonical writers serialize on the actual batch identity.
      await lockCanonicalComparisonBatch(tx, plan.canonical.batch.id);
      await verifyDirectory(tx, plan);
      await insertChecked(tx, originals, plan.records.originals);
      await insertChecked(tx, originalVersions, plan.records.originalVersions);
      await insertChecked(tx, fragments, plan.records.fragments);
      const selection = await readSelectionCohortFacts(tx, plan.cohort.id);
      if (!selection)
        throw new StandardIterationImportError('selection_binding_unavailable');
      if (
        selection.binding.standardVersionId !==
          plan.selectionStandard.versionId ||
        canonicalComparisonJson(selection.content) !==
          canonicalComparisonJson(plan.selectionStandard.content)
      )
        throw new StandardIterationImportError('selection_binding_mismatch');
      // 919 rechecks the real sources, node subjects and binding, then inserts
      // and reads back its five tables. Any failure rolls back records too.
      const written = await writeCanonicalComparisonBatch(tx, plan.canonical);
      return {
        ...written,
        sourceCommit: plan.canonical.batch.sourceCommit,
        inputCases: plan.canonical.cases.length,
        sourceRows: plan.records.fragments.length,
      };
    },
    { isolationLevel: 'read committed' },
  );
}
