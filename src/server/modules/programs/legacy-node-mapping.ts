import { isCurrent, type Assignment, type Enrollment } from '../../authz';
import type {
  EvaluationNode,
  EvaluationRelation,
} from '../../authz/evaluation-node';

interface LegacyNodeInput {
  cohorts: { id: string; name: string }[];
  people: { id: string }[];
  enrollments: Enrollment[];
  assignments: (Assignment & { id: string })[];
  projects: { id: string; cohortId: string | null }[];
  events: {
    id: string;
    personId: string;
    projectId: string | null;
    occurredOn: string;
  }[];
}
/** Dry-run data plan only. X1 applies it with the generated migration. */
export function planLegacyEvaluationNodes(input: LegacyNodeInput) {
  const cohorts = new Map(input.cohorts.map((cohort) => [cohort.id, cohort]));
  const people = new Set(input.people.map((person) => person.id));
  const nodeId = (cohortId: string) => `cohort:${cohortId}`;
  const nodes = input.cohorts.map((cohort) => ({
    id: nodeId(cohort.id),
    name: cohort.name,
    kind: 'program_cohort' as const,
    cohortId: cohort.id,
  }));
  const subjects = new Map<
    string,
    { evaluationNodeId: string; personId: string }
  >();
  for (const membership of [
    ...input.enrollments.map((row) => ({
      cohortId: row.cohortId,
      personId: row.personId,
    })),
    ...input.assignments.map((row) => ({
      cohortId: row.cohortId,
      personId: row.studentId,
    })),
  ]) {
    if (cohorts.has(membership.cohortId) && people.has(membership.personId)) {
      const subject = {
        evaluationNodeId: nodeId(membership.cohortId),
        personId: membership.personId,
      };
      subjects.set(
        JSON.stringify([subject.evaluationNodeId, subject.personId]),
        subject,
      );
    }
  }
  const relations: (EvaluationRelation & { legacyAssignmentId: string })[] = [];
  const unresolvedAssignments: {
    assignmentId: string;
    reason: 'missing_cohort_or_person';
  }[] = [];
  for (const assignment of input.assignments) {
    if (
      !cohorts.has(assignment.cohortId) ||
      !people.has(assignment.personId) ||
      !people.has(assignment.studentId)
    ) {
      unresolvedAssignments.push({
        assignmentId: assignment.id,
        reason: 'missing_cohort_or_person',
      });
      continue;
    }
    relations.push({
      id: `assignment:${assignment.id}`,
      evaluationNodeId: nodeId(assignment.cohortId),
      personId: assignment.studentId,
      evaluatorId: assignment.personId,
      kind: assignment.kind,
      validFrom: new Date(assignment.validFrom).toISOString(),
      validTo:
        assignment.validTo === null
          ? null
          : new Date(assignment.validTo).toISOString(),
      revokedAt:
        assignment.revokedAt === null
          ? null
          : new Date(assignment.revokedAt).toISOString(),
      legacyAssignmentId: assignment.id,
    });
  }
  const projects = new Map(
    input.projects.map((project) => [project.id, project]),
  );
  const eventBindings: { eventId: string; evaluationNodeId: string }[] = [];
  const unresolvedEvents: {
    eventId: string;
    reason: 'no_candidate_node' | 'multiple_candidate_nodes';
  }[] = [];
  for (const event of input.events) {
    const period =
      event.projectId === null ? null : projects.get(event.projectId)?.cohortId;
    // Do not let a missing project silently change into an unrelated cohort.
    const unknownProject =
      event.projectId !== null &&
      (!projects.has(event.projectId) ||
        projects.get(event.projectId)?.cohortId == null);
    const memberships = new Set([
      ...input.enrollments
        .filter(
          (row) =>
            row.personId === event.personId && isCurrent(row, event.occurredOn),
        )
        .map((row) => row.cohortId),
      ...input.assignments
        .filter(
          (row) =>
            row.studentId === event.personId &&
            isCurrent(row, event.occurredOn),
        )
        .map((row) => row.cohortId),
    ]);
    const candidates = [...memberships].filter(
      (cohortId) =>
        !unknownProject &&
        cohorts.has(cohortId) &&
        people.has(event.personId) &&
        (period == null || period === cohortId),
    );
    if (candidates.length === 1) {
      eventBindings.push({
        eventId: event.id,
        evaluationNodeId: nodeId(candidates[0]),
      });
    } else
      unresolvedEvents.push({
        eventId: event.id,
        reason:
          candidates.length === 0
            ? 'no_candidate_node'
            : 'multiple_candidate_nodes',
      });
  }
  return {
    nodes: nodes satisfies EvaluationNode[],
    subjects: [...subjects.values()],
    relations,
    eventBindings,
    unresolvedAssignments,
    unresolvedEvents,
  };
}
