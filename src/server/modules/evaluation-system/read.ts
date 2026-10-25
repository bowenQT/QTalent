import type { DbExecutor } from '../../db/client';
import { anchors, dimensions } from './schema';
export async function readTalentEvaluationRules(db: DbExecutor) {
  return {
    anchors: await db.select().from(anchors),
    dimensions: await db.select().from(dimensions),
  };
}
