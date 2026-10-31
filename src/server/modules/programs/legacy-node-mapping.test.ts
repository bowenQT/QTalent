import { expect, it } from 'vitest';
import { planLegacyEvaluationNodes } from './legacy-node-mapping';

const validity = { validFrom: '2026-01-01', validTo: null, revokedAt: null };
const input = {
  cohorts: [{ id: 'demo-cohort', name: '演示期次' }],
  people: [{ id: 'demo-person' }, { id: 'demo-evaluator' }],
  enrollments: [
    {
      cohortId: 'demo-cohort',
      personId: 'demo-person',
      confirmed: true,
      ...validity,
    },
  ],
  assignments: [
    {
      id: 'demo-assignment',
      cohortId: 'demo-cohort',
      personId: 'demo-evaluator',
      studentId: 'demo-person',
      kind: 'mentor' as const,
      ...validity,
    },
  ],
  projects: [{ id: 'demo-project', cohortId: 'demo-cohort' }],
  events: [
    {
      id: 'demo-event',
      personId: 'demo-person',
      projectId: null,
      occurredOn: '2026-09-01',
    },
  ],
};
it('maps cohort/assignment identities deterministically and binds an event without a project', () => {
  const result = planLegacyEvaluationNodes(input);
  expect(result.nodes).toEqual([
    {
      id: 'cohort:demo-cohort',
      name: '演示期次',
      kind: 'program_cohort',
      cohortId: 'demo-cohort',
    },
  ]);
  expect(result.subjects).toEqual([
    { evaluationNodeId: 'cohort:demo-cohort', personId: 'demo-person' },
  ]);
  expect(result.relations).toEqual([
    {
      id: 'assignment:demo-assignment',
      evaluationNodeId: 'cohort:demo-cohort',
      personId: 'demo-person',
      evaluatorId: 'demo-evaluator',
      kind: 'mentor',
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: null,
      revokedAt: null,
      legacyAssignmentId: 'demo-assignment',
    },
  ]);
  expect(result.eventBindings).toEqual([
    { eventId: 'demo-event', evaluationNodeId: 'cohort:demo-cohort' },
  ]);
  expect(result.unresolvedEvents).toEqual([]);
  expect(result.unresolvedAssignments).toEqual([]);
  expect(planLegacyEvaluationNodes(input)).toEqual(result);
});
it('uses occurrence-time membership and an explicit project cohort instead of current scope', () => {
  const snapshot = {
    ...input,
    cohorts: [...input.cohorts, { id: 'demo-second', name: '演示另一期次' }],
    enrollments: [
      ...input.enrollments,
      { ...input.enrollments[0], cohortId: 'demo-second' },
    ],
    events: [{ ...input.events[0], projectId: 'demo-project' }],
  };
  expect(planLegacyEvaluationNodes(snapshot).eventBindings).toEqual([
    { eventId: 'demo-event', evaluationNodeId: 'cohort:demo-cohort' },
  ]);
  const expired = {
    ...input,
    enrollments: [{ ...input.enrollments[0], validTo: '2026-09-01' }],
    assignments: [{ ...input.assignments[0], revokedAt: '2026-09-01' }],
  };
  const plan = planLegacyEvaluationNodes(expired);
  expect(plan.eventBindings).toEqual([]);
  expect(plan.unresolvedEvents).toEqual([
    { eventId: 'demo-event', reason: 'no_candidate_node' },
  ]);
  expect(plan.relations[0].revokedAt).toBe('2026-09-01T00:00:00.000Z');
});
it('keeps ambiguous and broken references explicit rather than inventing node history', () => {
  const ambiguous = {
    ...input,
    cohorts: [...input.cohorts, { id: 'demo-second', name: '演示另一期次' }],
    enrollments: [
      ...input.enrollments,
      { ...input.enrollments[0], cohortId: 'demo-second' },
    ],
  };
  expect(planLegacyEvaluationNodes(ambiguous).unresolvedEvents).toEqual([
    { eventId: 'demo-event', reason: 'multiple_candidate_nodes' },
  ]);
  for (const patch of [
    { people: [] },
    { cohorts: [] },
    { events: [{ ...input.events[0], projectId: 'missing-project' }] },
  ])
    expect(
      planLegacyEvaluationNodes({ ...input, ...patch }).unresolvedEvents,
    ).toEqual([{ eventId: 'demo-event', reason: 'no_candidate_node' }]);
  expect(
    planLegacyEvaluationNodes({ ...input, people: [] }).unresolvedAssignments,
  ).toEqual([
    { assignmentId: 'demo-assignment', reason: 'missing_cohort_or_person' },
  ]);
});
