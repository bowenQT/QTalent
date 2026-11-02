import { eq } from 'drizzle-orm';
import type { Database } from '../../client';
import {
  cohorts,
  evaluationNodes,
  evaluationNodeSubjects,
} from '../../../modules/programs';
import { readStoredSelectionCohortBinding } from '../../../modules/evaluation-system/selection/postgres';
import { selectionCategoryHeads } from '../../../modules/evaluation-system/selection/schema';
import { authorizeSelectionAction } from '../../../modules/evaluation-system/selection-standard';
import {
  bindExistingSelectionCohort,
  initializeReviewedSelectionBaseline,
  loadSelectionAuthority,
} from '../../../usecases/selection-standard-native';
import {
  CURRENT_FACT_GENERATION,
  FACT_DIRECTORY,
  FACT_GENERATIONS,
  prepareStandardIterationDemo,
  readStandardIterationFactFiles,
} from './input';
import {
  importStandardIterationDemo,
  StandardIterationImportError,
} from './import';

/** Reviewed demo background (#248 rulings): the sixth cohort's baseline takes
 * effect at 2026-06-15 Asia/Shanghai, and its two comparison nodes are reviews. */
export const DEMO_BASELINE = {
  versionId: 'xe-select-v1',
  periodId: 'xe-select-v1-demo-baseline',
  effectiveFrom: '2026-06-14T16:00:00.000Z',
  nextVersionOrdinal: 2,
} as const;
export const DEMO_NODES = [
  { id: 'xe6-select', name: '入营选拔（演示）', side: 'front' },
  { id: 'xe6-end', name: '结营评审（演示）', side: 'back' },
] as const;
/** The seventh cohort is created live, after v2 is published, by the native
 * cohort entry. Init never creates it; this descriptor is the reviewed
 * next-cohort fact a lifecycle composition can be given. Cohorts carry no
 * dates, so "opens the Monday after creation" is presenter wording only. */
export const DEMO_NEXT_COHORT = {
  id: 'b-xe7-demo',
  name: 'XEngineer 第七期（演示）',
  sourceReference: `${FACT_DIRECTORY}/cohort-scenarios.json`,
} as const;

type Step = 'created' | 'unchanged';

/** Operator-only, idempotent demo initialization. Each step is its own native
 * transaction and is safe to re-run: existing facts are compared and kept, a
 * different existing fact fails instead of being overwritten. Older generation
 * nodes (bow-923-xe6-*) are left untouched. */
export async function initializeStandardIterationDemo(
  db: Database,
  repositoryDirectory: string,
  accountId: string,
  clock: () => Date = () => new Date(),
) {
  const generation = CURRENT_FACT_GENERATION;
  const plan = await prepareStandardIterationDemo(
    await readStandardIterationFactFiles(repositoryDirectory, generation),
    generation,
  );
  const nodeIds = new Set(
    plan.canonical.cases.flatMap((c) => [c.frontNodeId, c.backNodeId]),
  );
  if (
    nodeIds.size !== DEMO_NODES.length ||
    DEMO_NODES.some((node) => !nodeIds.has(node.id))
  )
    throw new StandardIterationImportError('node_mismatch');

  // The named account must be a current manager before anything is written;
  // the 918 entries below re-check this inside their own transactions.
  await db.transaction(async (tx) =>
    authorizeSelectionAction(
      await loadSelectionAuthority(tx, accountId, clock),
      'manager',
    ),
  );

  const nodes = await db.transaction(
    async (tx): Promise<Step> => {
      const [cohort] = await tx
        .select()
        .from(cohorts)
        .where(eq(cohorts.id, plan.cohort.id))
        .for('share');
      if (!cohort) throw new StandardIterationImportError('cohort_mismatch');
      let step: Step = 'unchanged';
      for (const node of DEMO_NODES) {
        const [existing] = await tx
          .select()
          .from(evaluationNodes)
          .where(eq(evaluationNodes.id, node.id))
          .for('update');
        if (!existing) {
          await tx.insert(evaluationNodes).values({
            id: node.id,
            name: node.name,
            kind: 'review',
            cohortId: plan.cohort.id,
          });
          step = 'created';
        } else if (
          existing.kind !== 'review' ||
          existing.cohortId !== plan.cohort.id ||
          existing.name !== node.name
        )
          throw new StandardIterationImportError('node_mismatch');
      }
      const subjects = DEMO_NODES.flatMap((node) =>
        plan.canonical.cases.map((c) => ({
          evaluationNodeId: node.id,
          personId: c.personId,
        })),
      );
      const inserted = await tx
        .insert(evaluationNodeSubjects)
        .values(subjects)
        .onConflictDoNothing()
        .returning();
      return inserted.length ? 'created' : step;
    },
    { isolationLevel: 'read committed' },
  );

  // A head means the baseline was established before (and may since have
  // moved to a published v2); re-initializing would conflict, so keep it.
  const [head] = await db
    .select({ category: selectionCategoryHeads.category })
    .from(selectionCategoryHeads)
    .where(eq(selectionCategoryHeads.category, 'xe_selection'));
  let baseline: Step = 'unchanged';
  if (!head) {
    if (plan.selectionStandard.versionId !== DEMO_BASELINE.versionId)
      throw new StandardIterationImportError('selection_binding_mismatch');
    await initializeReviewedSelectionBaseline(
      db,
      accountId,
      {
        ...DEMO_BASELINE,
        sourceCommit: FACT_GENERATIONS[generation].sourceCommit,
        sourceReference: `${FACT_DIRECTORY}/selection-standard.json`,
        content: plan.selectionStandard.content,
      },
      clock,
    );
    baseline = 'created';
  }

  const bound = await db.transaction((tx) =>
    readStoredSelectionCohortBinding(tx, plan.cohort.id),
  );
  await bindExistingSelectionCohort(db, accountId, plan.cohort.id, clock);
  const binding: Step = bound ? 'unchanged' : 'created';

  const imported = await importStandardIterationDemo(
    db,
    repositoryDirectory,
    generation,
  );
  const next = await db
    .select({ id: cohorts.id })
    .from(cohorts)
    .where(eq(cohorts.id, DEMO_NEXT_COHORT.id));
  return {
    generation,
    nodes,
    baseline,
    binding,
    import: imported,
    nextCohortExists: next.length > 0,
  };
}
