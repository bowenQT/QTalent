import type { EvaluationAuthzContext } from '../../authz/evaluation-node';
import type {
  EvaluationWorkItem,
  ReassignEvaluationWorkInput,
} from './reassignment-contract';

export const reassignmentNow = '2026-10-31T16:00:00.000Z';
const validity = {
  validFrom: '2026-01-01T00:00:00.000Z',
  validTo: null,
  revokedAt: null,
};
export function evaluationContextFixture(): EvaluationAuthzContext {
  return {
    account: {
      id: 'demo-hr-account',
      personId: 'demo-hr',
      isSystemAdmin: false,
    },
    now: reassignmentNow,
    grants: [
      {
        accountId: 'demo-hr-account',
        role: 'hr',
        scope: 'cohort',
        cohortId: 'demo-cohort',
        ...validity,
      },
    ],
    enrollments: [
      {
        personId: 'demo-person',
        cohortId: 'demo-cohort',
        confirmed: true,
        ...validity,
      },
    ],
    assignments: [],
    projects: [],
    members: [],
    people: [
      { id: 'demo-person', noReview: false },
      { id: 'demo-hr', noReview: false },
      { id: 'demo-old-evaluator', noReview: false },
      { id: 'demo-new-evaluator', noReview: false },
    ],
    evaluationNodes: [
      { id: 'demo-node', kind: 'interview', cohortId: null },
      { id: 'demo-other-node', kind: 'defense', cohortId: null },
    ],
    evaluationNodeSubjects: [
      { evaluationNodeId: 'demo-node', personId: 'demo-person' },
      { evaluationNodeId: 'demo-other-node', personId: 'demo-person' },
    ],
    evaluationRelations: [
      {
        id: 'demo-old-relation',
        evaluationNodeId: 'demo-node',
        personId: 'demo-person',
        evaluatorId: 'demo-old-evaluator',
        kind: 'interviewer',
        ...validity,
        validTo: reassignmentNow,
      },
      {
        id: 'demo-new-relation',
        evaluationNodeId: 'demo-node',
        personId: 'demo-person',
        evaluatorId: 'demo-new-evaluator',
        kind: 'evaluator',
        ...validity,
      },
    ],
  };
}
export function evaluationWorkFixture(): EvaluationWorkItem {
  return {
    id: 'demo-work-item',
    evaluationNodeId: 'demo-node',
    personId: 'demo-person',
    assignedRelationId: 'demo-old-relation',
    assignedEvaluatorId: 'demo-old-evaluator',
    kind: 'confirmation',
    resourceId: 'demo-draft',
    state: 'pending',
    revision: 1,
    updatedAt: '2026-10-30T00:00:00.000Z',
  };
}
export const reassignmentInputFixture: ReassignEvaluationWorkInput = {
  operationId: 'demo-operation',
  workItemId: 'demo-work-item',
  expectedRevision: 1,
  targetRelationId: 'demo-new-relation',
};
