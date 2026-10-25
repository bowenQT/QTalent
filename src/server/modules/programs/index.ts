import type { DbExecutor } from '../../db/client';
import { assignments, enrollments } from './schema';
export async function readProgramScopes(db: DbExecutor) {
  return {
    enrollments: await db.select().from(enrollments),
    assignments: await db.select().from(assignments),
  };
}
export { cohorts, enrollments, assignments } from './schema';
