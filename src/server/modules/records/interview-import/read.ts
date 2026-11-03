import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../../db/client';
import { historicalEvaluations } from '../schema';
import {
  interviewImportArchives,
  interviewImportOperations,
  interviewImportRows,
} from './schema';

/** Complete archive provenance, including withdrawn imports. This is an internal
 * snapshot, not an authorized DTO; callers must filter before exposing any field. */
export async function readInterviewArchives(db: DbExecutor) {
  return db
    .select({
      archive: interviewImportArchives,
      history: historicalEvaluations,
      row: interviewImportRows,
      operation: interviewImportOperations,
    })
    .from(interviewImportArchives)
    .innerJoin(
      historicalEvaluations,
      eq(historicalEvaluations.id, interviewImportArchives.evaluationId),
    )
    .innerJoin(
      interviewImportRows,
      and(
        eq(interviewImportRows.batchId, interviewImportArchives.batchId),
        eq(interviewImportRows.rowId, interviewImportArchives.rowId),
      ),
    )
    .innerJoin(
      interviewImportOperations,
      and(
        eq(interviewImportOperations.batchId, interviewImportArchives.batchId),
        eq(interviewImportOperations.rowId, interviewImportArchives.rowId),
        eq(
          interviewImportOperations.toRevision,
          interviewImportArchives.importRevision,
        ),
      ),
    );
}
export type InterviewArchiveFacts = Awaited<
  ReturnType<typeof readInterviewArchives>
>;
