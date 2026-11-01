import 'server-only';
import type { Database } from '../db/client';
import { loadProjectContext } from '../usecases/project-context';
import { readEvidenceForTalent } from '../modules/records';
import { readTalentEvaluationRules } from '../modules/evaluation-system';
import { readActiveConfirmations } from '../modules/talent';
import type { TalentSource, TalentSubject, TalentKind } from '../authz/talent';
import { historicalEvaluationRequiredKind } from './historical-evaluation-policy';

/** Complete provenance is loaded before person filtering, including shared
 * fragments. This bounded P0 read does not use the prototype import archive.
 */
export async function loadPersonData(
  db: Database,
  accountId: string,
  today: string,
) {
  return db.transaction(
    async (tx) => {
      const base = await loadProjectContext(tx, accountId, today);
      return {
        ...base,
        ...(await readEvidenceForTalent(tx)),
        ...(await readTalentEvaluationRules(tx)),
        confirmations: await readActiveConfirmations(tx),
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
export type PersonData = Awaited<ReturnType<typeof loadPersonData>>;
export function eventSubject(
  data: PersonData,
  event: PersonData['events'][number],
): TalentSubject {
  return {
    personId: event.personId,
    cohortId:
      data.staffing.projects.find((p) => p.id === event.projectId)?.cohortId ??
      null,
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
export function talentSources(data: PersonData): TalentSource[] {
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
        subjects.push({ personId: row.personId, cohortId: null });
      for (const participant of historicalParticipantsByEvaluation.get(
        row.id,
      ) ?? [])
        subjects.push({ personId: participant.personId, cohortId: null });
    }
    const historyKinds = history.map(historicalEvaluationRequiredKind);
    const requiredKinds: TalentKind[] = [];
    if (observedSources.has(key)) requiredKinds.push('management-observation');
    // Sensitivity adds an access requirement without rewriting historical facts.
    if (historyKinds.includes('performance')) requiredKinds.push('performance');
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
