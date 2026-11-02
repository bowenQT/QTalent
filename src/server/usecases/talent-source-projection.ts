import type {
  TalentSource,
  TalentSubject,
  TalentKind,
  TalentAuthorizationContext,
} from '../authz/talent';
import type { readEvidenceForTalent } from '../modules/records';

/** Complete raw provenance, including withdrawn events and every shared subject.
 * This graph is not a permission grant or an immutable-version/locator check.
 * Callers still apply current authorization and validate the actual original.
 */
export type TalentSourceProjectionData = Awaited<
  ReturnType<typeof readEvidenceForTalent>
> & {
  context: TalentAuthorizationContext;
  staffing: { projects: { id: string; cohortId: string | null }[] };
};

/** Permission requirement for the four approved, pinned prototype history kinds.
 * The baseline's graduation row needs restricted evaluation access, not the
 * personnel-material restriction that excludes every role from model input.
 * Its historical kind, source category, scale and values remain unchanged.
 * New source types/free-text labels need their own confirmed classification.
 */
export function historicalEvaluationRequiredKind(row: {
  kind: string;
  sourceCategory: string;
}): 'evaluation' | 'restricted-evaluation' | null {
  if (row.sourceCategory !== 'prototype_baseline') return null;
  switch (row.kind) {
    case '训练营周评':
    case 'MS 路演评审':
    case '奖项答辩':
      return 'evaluation';
    case '结营评审':
      return 'restricted-evaluation';
    default:
      return null;
  }
}

export function eventSubject(
  data: TalentSourceProjectionData,
  event: TalentSourceProjectionData['events'][number],
): TalentSubject {
  return {
    personId: event.personId,
    evaluationNodeId: event.evaluationNodeId,
    cohortId:
      event.evaluationNodeId !== null
        ? (data.context.evaluationNodes?.find(
            (node) => node.id === event.evaluationNodeId,
          )?.cohortId ?? null)
        : (data.staffing.projects.find((p) => p.id === event.projectId)
            ?.cohortId ?? null),
  };
}
export function historicalSubject(
  data: TalentSourceProjectionData,
  row: TalentSourceProjectionData['historical'][number],
  personId: string,
): TalentSubject {
  return {
    personId,
    evaluationNodeId: row.evaluationNodeId,
    cohortId:
      data.context.evaluationNodes?.find(
        (node) => node.id === row.evaluationNodeId,
      )?.cohortId ?? null,
  };
}
export function sourceKey(reference: {
  fragmentId: string;
  originalVersionId: string;
}): string {
  return JSON.stringify([reference.fragmentId, reference.originalVersionId]);
}
function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  return groups;
}
/** Relations are indexed once per call: the full demo snapshot has ~1k
 * fragments, and per-fragment scans of every relation cost seconds per read.
 */
export function talentSources(
  data: TalentSourceProjectionData,
): TalentSource[] {
  const linksBySource = groupBy(data.eventSources, sourceKey);
  const eventOrder = new Map(
    data.events.map((event, index) => [event.id, index]),
  );
  const participantsByEvent = groupBy(data.participants, (p) => p.eventId);
  const historyBySource = groupBy(data.historical, sourceKey);
  const historicalParticipantsByEvaluation = groupBy(
    data.historicalParticipants,
    (participant) => participant.evaluationId,
  );
  const observedSources = new Set(
    data.statements
      .filter((row) => row.kind === 'management_observation')
      .map(sourceKey),
  );
  return data.fragments.map((fragment) => {
    const reference = {
      fragmentId: fragment.id,
      originalVersionId: fragment.originalVersionId,
    };
    const key = sourceKey(reference);
    const links = linksBySource.get(key) ?? [];
    const linkedEvents = [
      ...new Set(links.flatMap((link) => eventOrder.get(link.eventId) ?? [])),
    ]
      .sort((a, b) => a - b)
      .map((index) => data.events[index]!);
    const subjects = linkedEvents.flatMap((event) => {
      const subject = eventSubject(data, event);
      return [
        subject,
        ...(participantsByEvent.get(event.id) ?? []).map((p) => ({
          ...subject,
          personId: p.personId,
        })),
      ];
    });
    const history = historyBySource.get(key) ?? [];
    for (const row of history) {
      if (row.personId)
        subjects.push(historicalSubject(data, row, row.personId));
      for (const participant of historicalParticipantsByEvaluation.get(
        row.id,
      ) ?? [])
        subjects.push(historicalSubject(data, row, participant.personId));
    }
    const historyKinds = history.map(historicalEvaluationRequiredKind);
    const requiredKinds: TalentKind[] = [];
    if (observedSources.has(key)) requiredKinds.push('management-observation');
    // Sensitivity adds an access requirement without rewriting historical facts.
    if (historyKinds.includes('restricted-evaluation'))
      requiredKinds.push('restricted-evaluation');
    if (
      links.some((link) => !eventOrder.has(link.eventId)) ||
      historyKinds.includes(null) ||
      history.some(
        (row) =>
          !row.personId && !historicalParticipantsByEvaluation.has(row.id),
      )
    )
      subjects.length = 0;
    return {
      ...reference,
      subjects,
      kind: 'evaluation',
      requiredKinds,
      excerpt: fragment.excerpt,
      location: fragment.location,
    };
  });
}
