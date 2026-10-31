import type { DbExecutor } from '../../db/client';
import { assignments, enrollments } from './schema';
export async function readProgramScopes(db: DbExecutor) {
  return {
    enrollments: await db.select().from(enrollments),
    assignments: await db.select().from(assignments),
  };
}
export { cohorts, enrollments, assignments } from './schema';

export {
  evaluationNodes,
  evaluationNodeSubjects,
  evaluationRelations,
  evaluationWorkItems,
  evaluationReassignmentOperations,
} from './schema';
export {
  readEvaluationAuthorizationFacts,
  readEvaluationWorkItems,
  readEvaluationWorkItemForUpdate,
  readEvaluationReassignmentOperation,
  persistEvaluationReassignment,
  insertEvaluationWorkItem,
  completeEvaluationWorkItem,
} from './reassignment-store';
export {
  EvaluationReassignmentError,
  evaluationReassignmentFingerprint,
  assignedEvaluationRelationIsCurrent,
  canWorkOnEvaluationItem,
  planEvaluationReassignment,
} from './reassignment-policy';
export {
  reassignEvaluationWorkInputSchema,
  evaluationReassignmentReceiptSchema,
  reassignEvaluationWorkResultSchema,
} from './reassignment-contract';
export type {
  ReassignEvaluationWorkInput,
  EvaluationReassignmentReceipt,
  ReassignEvaluationWorkResult,
  EvaluationWorkItem,
} from './reassignment-contract';
export { planLegacyEvaluationNodes } from './legacy-node-mapping';
