import type { EvaluationAuthzContext } from '../../../../authz/evaluation-node';
import {
  managementObservationSchema,
  type CreateObservationInput,
  type InterviewAttribution,
  type ObservationSource,
} from '../model';
export const subject = {
  evaluationNodeId: 'demo-interview',
  personId: 'demo-person',
};
export const now = '2026-10-31T12:00:00.000Z';
export const validity = {
  validFrom: '2026-01-01T00:00:00.000Z',
  validTo: null,
  revokedAt: null,
};
export function context(
  role: 'hr' | 'manager' | 'author' | 'employee' | 'admin' = 'hr',
): EvaluationAuthzContext {
  const personId =
    role === 'author'
      ? 'demo-interviewer'
      : role === 'employee'
        ? 'demo-employee'
        : 'demo-hr';
  const accountId = 'account-' + personId;
  return {
    account: { id: accountId, personId, isSystemAdmin: role === 'admin' },
    now,
    grants:
      role === 'hr'
        ? [
            {
              accountId,
              role: 'hr',
              scope: 'cohort',
              cohortId: 'demo-cohort',
              ...validity,
            },
          ]
        : role === 'manager'
          ? [
              {
                accountId,
                role: 'manager',
                scope: 'company',
                cohortId: null,
                ...validity,
              },
            ]
          : [],
    people: [
      'demo-person',
      'demo-hr',
      'demo-interviewer',
      'demo-other-author',
      'demo-employee',
    ].map((id) => ({ id, noReview: false })),
    enrollments: [
      {
        cohortId: 'demo-cohort',
        personId: 'demo-person',
        confirmed: true,
        ...validity,
      },
    ],
    assignments: [],
    projects: [],
    members: [],
    evaluationNodes: [
      { id: 'demo-interview', kind: 'interview', cohortId: null },
      { id: 'demo-other-node', kind: 'interview', cohortId: null },
      { id: 'demo-defense', kind: 'defense', cohortId: null },
    ],
    evaluationNodeSubjects: [
      { ...subject },
      { evaluationNodeId: 'demo-other-node', personId: 'demo-person' },
      { evaluationNodeId: 'demo-defense', personId: 'demo-person' },
    ],
    evaluationRelations: [
      {
        id: 'demo-relation',
        ...subject,
        evaluatorId: 'demo-interviewer',
        kind: 'interviewer',
        ...validity,
      },
    ],
  };
}
export const reference = {
  fragmentId: 'demo-fragment',
  originalVersionId: 'demo-original-v1',
};
export const impression = '演示：这是整体印象，不含情境、行为、结果。';
export function manual(): CreateObservationInput {
  return {
    origin: 'manual',
    operationId: 'demo-operation',
    ...subject,
    text: impression,
    occurredAt: '2026-10-03',
    sources: [],
  };
}
export function imported(): CreateObservationInput {
  return {
    origin: 'interview_import',
    operationId: 'demo-operation',
    ...subject,
    text: impression,
    attributionId: 'demo-attribution',
    sources: [reference],
  };
}
export function attribution(): InterviewAttribution {
  return {
    id: 'demo-attribution',
    ...subject,
    text: impression,
    interviewedAt: '2026-10-01',
    interviewer: { personId: 'demo-interviewer', name: '演示面试官甲' },
    sources: [reference],
  };
}
export function source(): ObservationSource {
  return {
    ...reference,
    location: { kind: 'document', page: 2, paragraph: '演示面评综合评价' },
    kind: 'evaluation',
    requiredKinds: [],
    subjects: [{ ...subject }],
  };
}
export function observation() {
  return managementObservationSchema.parse({
    id: 'demo-observation',
    ...subject,
    text: impression,
    origin: 'manual',
    kind: 'management-observation',
    nature: 'management_observation',
    author: { personId: 'demo-interviewer', name: '演示面试官甲' },
    authorUnconfirmed: false,
    recordedByAccountId: 'account-demo-interviewer',
    recordedAt: now,
    occurredAt: '2026-10-01',
    importedBy: null,
    attributionId: null,
    sources: [],
  });
}
