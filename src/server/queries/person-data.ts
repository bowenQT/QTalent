import 'server-only';
import type { Database } from '../db/client';
import { loadEvaluationContext } from '../usecases/evaluation-context';
import { readEvidenceForTalent } from '../modules/records';
import { readTalentEvaluationRules } from '../modules/evaluation-system';
import { readActiveConfirmations } from '../modules/talent';
import { employments } from '../modules/directory';
import { cohorts } from '../modules/programs';
import type {
  TalentSource,
  TalentSubject,
  TalentKind,
  TalentAuthorizationContext,
} from '../authz/talent';
import { historicalEvaluationRequiredKind } from './historical-evaluation-policy';

/** Complete provenance is loaded before person filtering, including shared
 * fragments. This bounded P0 read does not use the prototype import archive.
 */
export async function loadPersonData(
  db: Database,
  accountId: string,
  now: string,
) {
  return db.transaction(
    async (tx) => {
      const base = await loadEvaluationContext(tx, accountId, now);
      const context: TalentAuthorizationContext = base.context;
      return {
        context,
        directory: base.directory,
        staffing: base.staffing,
        ...(await readEvidenceForTalent(tx)),
        ...(await readTalentEvaluationRules(tx)),
        confirmations: await readActiveConfirmations(tx),
        // Batch names and hire dates for the identity header.
        cohorts: await tx.select().from(cohorts),
        employments: await tx.select().from(employments),
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
/** Public date fields use the business day; authorization keeps the complete instant. */
export const personBusinessDay = (data: PersonData) =>
  data.context.now.slice(0, 10);
export function historicalSubject(
  data: PersonData,
  row: PersonData['historical'][number],
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
