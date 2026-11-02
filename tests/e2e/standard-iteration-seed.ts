import type { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createClock } from '../../src/lib/clock';
import { initializeStandardIterationDemo } from '../../src/server/db/seed/standard-iteration-demo/init';
import {
  listComparisonBatches,
  readComparisonDataset,
} from '../../src/server/usecases/judgment-comparison-dataset';
import { createStandardAttributionUsecases } from '../../src/server/usecases/standard-attribution/hypotheses';
import { nativeAttributionReadServices } from '../../src/server/usecases/standard-attribution/batch-state';
import { createAttributionPostgresStore } from '../../src/server/usecases/standard-attribution/postgres';

export const seededHypothesis = '演示：入营评审要点没有要求核对个人贡献';

/**
 * The third act's starting state in the isolated test database: the operator's
 * `--init` as the demo manager (comparison batch and xe-select-v1), then one AI
 * hypothesis written through BOW-921 as if the model had answered. Browser checks
 * run without Modelink, so only that answer is synthetic; HR attributes, drafts
 * and the manager publishes through the real routes.
 */
export async function seedStandardIteration(pool: Pool) {
  const db = drizzle(pool);
  const clock = createClock('test');
  await initializeStandardIterationDemo(db, process.cwd(), 'demo-ceo', () =>
    clock.now(),
  );
  const { batchId, caseId } = await db.transaction(async (tx) => {
    const [batch] = await listComparisonBatches(tx, ['b-xe6']);
    if (!batch) throw new Error('--init stored no comparison batch');
    const data = await readComparisonDataset(tx, batch.id);
    const unit = data?.cases.find((c) => c.front.state === 'present');
    if (!unit) throw new Error('The batch has no front judgment to cite');
    return { batchId: batch.id, caseId: unit.id };
  });
  const store = createAttributionPostgresStore(
    db,
    nativeAttributionReadServices(() => clock.now()),
  );
  const expectedModel = 'google/gemini-3.8-flash';
  const app = createStandardAttributionUsecases(
    store,
    {
      expectedModel,
      client: {
        async generateStructured(input) {
          return {
            ok: true as const,
            value: input.schema.parse({
              hypotheses: [
                {
                  text: seededHypothesis,
                  categories: ['evaluation_standard'],
                  citations: [{ caseId, side: 'front' }],
                },
              ],
            }),
            metadata: {
              model: expectedModel,
              promptVersion: input.promptVersion,
              requestId: 'e2e-synthetic',
            },
          };
        },
      },
    },
    { now: () => clock.now() },
  );
  const result = await app.generateHypotheses('demo-hrbp', {
    operationId: 'e2e-seed-hypotheses',
    batchId,
  });
  if (result.status !== 'success')
    throw new Error(`Seeding hypotheses failed: ${result.status}`);
}
