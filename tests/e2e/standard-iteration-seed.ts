import type { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createClock } from '../../src/lib/clock';
import {
  DEMO_NEXT_COHORT,
  initializeStandardIterationDemo,
} from '../../src/server/db/seed/standard-iteration-demo/init';
import { comparisonBatches } from '../../src/server/modules/evaluation-system';
import { readComparisonDataset } from '../../src/server/usecases/judgment-comparison-dataset';
import { createNativeSelectionLifecycle } from '../../src/server/usecases/selection-standard-native';
import { nativeAttributionReadServices } from '../../src/server/usecases/standard-attribution/batch-state';
import { createStandardAttributionUsecases } from '../../src/server/usecases/standard-attribution/hypotheses';
import { createAttributionPostgresStore } from '../../src/server/usecases/standard-attribution/postgres';

/**
 * The state /judge leaves for /rules, written through the real use cases in the
 * isolated test database: the operator's `--init` as the demo manager, HR's signed
 * attribution with 「评价标准」, and the empty revision drafted from it.
 */
export async function seedSelectionDraft(pool: Pool) {
  const db = drizzle(pool);
  const clock = createClock('test');
  const now = () => clock.now();
  await initializeStandardIterationDemo(db, process.cwd(), 'demo-ceo', now);
  const [batch] = await db
    .select({ id: comparisonBatches.id })
    .from(comparisonBatches)
    .where(eq(comparisonBatches.cohortId, 'b-xe6'));
  if (!batch) throw new Error('--init stored no comparison batch');
  const data = await db.transaction((tx) =>
    readComparisonDataset(tx, batch.id),
  );
  const unit = data?.cases.find((c) => c.front.state === 'present');
  if (!unit) throw new Error('The batch has no front judgment to cite');
  const attribution = createStandardAttributionUsecases(
    createAttributionPostgresStore(db, nativeAttributionReadServices(now)),
    {
      expectedModel: 'unused',
      client: {
        generateStructured: () => {
          throw new Error('A signed attribution needs no model');
        },
      },
    },
    { now },
  );
  const signed = await attribution.confirmAttribution('demo-hrbp', {
    operationId: 'e2e-attribute',
    batchId: batch.id,
    hypothesisId: null,
    categories: ['evaluation_standard'],
    rationale: '演示：作品评审只看结果，没要求说明本人负责的部分',
    caseIds: [unit.id],
  });
  if (signed.status !== 'success')
    throw new Error(`Seeding the attribution failed: ${signed.status}`);
  const created = await createNativeSelectionLifecycle(db, {
    nextCohort: DEMO_NEXT_COHORT,
    clock: now,
  }).execute('demo-hrbp', {
    action: 'create',
    input: {
      operationId: 'e2e-draft',
      baseVersionId: 'xe-select-v1',
      attributionId: signed.result.id,
      expectedAttributionRevision: signed.result.revision,
      reason: '演示：补一条个人贡献核验',
    },
  });
  if (created.status !== 'success')
    throw new Error(`Seeding the draft failed: ${created.status}`);
}
