import type { TalentSource, TalentSubject, TalentKind } from '../authz/talent';

export interface SourceProjectionData {
  fragments: readonly {
    id: string;
    originalVersionId: string;
    excerpt: string;
    location: TalentSource['location'];
  }[];
  eventSources: readonly {
    eventId: string;
    fragmentId: string;
    originalVersionId: string;
  }[];
  events: readonly { id: string; personId: string; projectId: string | null }[];
  participants: readonly { eventId: string; personId: string }[];
  historical: readonly {
    id: string;
    personId: string | null;
    fragmentId: string;
    originalVersionId: string;
    sourceCategory: string;
    kind: string;
  }[];
  historicalParticipants: readonly {
    evaluationId: string;
    personId: string;
  }[];
  statements: readonly {
    fragmentId: string;
    originalVersionId: string;
    kind: string;
  }[];
  staffing: {
    projects: readonly { id: string; cohortId: string | null }[];
  };
}
export function eventSubject(
  data: SourceProjectionData,
  event: SourceProjectionData['events'][number],
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
export function talentSources(data: SourceProjectionData): TalentSource[] {
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
      links.some((link) => !linkedEvents.some((e) => e.id === link.eventId)) ||
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

/** Add only server-stored draft provenance. Never repair a dangling or
 * unclassified historical link by supplying a new, more permissive subject. */
export function sourcesForDraft(
  data: SourceProjectionData,
  references: readonly {
    fragmentId: string;
    originalVersionId: string;
    subjects: readonly TalentSubject[];
  }[],
): TalentSource[] {
  return talentSources(data).map((source) => {
    const additions = references
      .filter((reference) => sourceKey(reference) === sourceKey(source))
      .flatMap((reference) => reference.subjects);
    if (additions.length === 0) return source;
    const hasPriorRelations =
      data.eventSources.some(
        (row) => sourceKey(row) === sourceKey(source),
      ) ||
      data.historical.some(
        (row) => sourceKey(row) === sourceKey(source),
      );
    if (source.subjects.length === 0 && hasPriorRelations) return source;
    const subjects = new Map<string, TalentSubject>();
    for (const subject of [...source.subjects, ...additions]) {
      subjects.set(JSON.stringify([subject.personId, subject.cohortId]), subject);
    }
    return { ...source, subjects: [...subjects.values()] };
  });
}
