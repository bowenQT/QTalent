import 'server-only';
import type { DbExecutor } from '../db/client';
import { loadProjectContext } from '../usecases/project-context';
import { readEvidenceForTalent } from '../modules/records';
import { readTalentEvaluationRules } from '../modules/evaluation-system';
import { readActiveConfirmations } from '../modules/talent';
import type {
  TalentSource,
  TalentSubject,
  TalentKind,
} from '../authz/talent';

/** Complete provenance is loaded before person filtering, including shared
 * fragments. This bounded P0 read does not use the prototype import archive.
 */
export async function loadPersonData(
  db: DbExecutor,
  accountId: string,
  today: string,
) {
  const base = await loadProjectContext(db, accountId, today);
  return {
    ...base,
    ...(await readEvidenceForTalent(db)),
    ...(await readTalentEvaluationRules(db)),
    confirmations: await readActiveConfirmations(db),
  };
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
export function talentSources(data: PersonData): TalentSource[] {
  return data.fragments.map((fragment) => {
    const reference = {
      fragmentId: fragment.id,
      originalVersionId: fragment.originalVersionId,
    };
    const links = data.eventSources.filter(
      (link) => sourceKey(link) === sourceKey(reference),
    );
    const linkedEvents = data.events.filter((event) =>
      links.some((link) => link.eventId === event.id),
    );
    const subjects = linkedEvents.flatMap((event) => {
      const subject = eventSubject(data, event);
      return [
        subject,
        ...data.participants
          .filter((p) => p.eventId === event.id)
          .map((p) => ({ ...subject, personId: p.personId })),
      ];
    });
    const history = data.historical.filter(
      (row) => sourceKey(row) === sourceKey(reference),
    );
    for (const row of history) {
      if (row.personId)
        subjects.push({ personId: row.personId, cohortId: null });
      for (const participant of data.historicalParticipants)
        if (participant.evaluationId === row.id)
          subjects.push({ personId: participant.personId, cohortId: null });
    }
    const requiredKinds: TalentKind[] = [];
    if (
      data.statements.some(
        (row) =>
          sourceKey(row) === sourceKey(reference) &&
          row.kind === 'management_observation',
      )
    )
      requiredKinds.push('management-observation');
    // Only the four classified baseline categories in BOW-834 are ordinary
    // evaluations. Free-text kinds are not a sensitivity classification.
    const ordinaryHistory = [
      '训练营周评',
      '结营评审',
      'MS 路演评审',
      '奖项答辩',
    ];
    if (
      history.some(
        (row) =>
          row.sourceCategory !== 'prototype_baseline' ||
          !ordinaryHistory.includes(row.kind) ||
          (!row.personId &&
            !data.historicalParticipants.some(
              (participant) => participant.evaluationId === row.id,
            )),
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

