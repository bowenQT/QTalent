import type { AuthzContext } from '../../../authz';
import type { TalentSource, TalentRecord } from '../../../authz/talent';
import type { Source } from '../../../../contracts/sources';
import { MatchingError, type EventConfirmationFact } from './types';

export interface MatchingEvidenceMaterial {
  context: AuthzContext;
  directory: {
    people: { id: string; name: string; organizationId: string }[];
    organizations: { id: string; name: string }[];
  };
  projects: { id: string; cohortId: string | null }[];
  events: {
    id: string;
    personId: string;
    projectId: string | null;
    situation: string;
    behavior: string;
    impact: string;
  }[];
  eventSources: {
    eventId: string;
    fragmentId: string;
    originalVersionId: string;
  }[];
  confirmations: EventConfirmationFact[];
  sources: TalentSource[];
  sourceDetails: Source[];
}
/** Matching eligibility is narrower than permission to read a subjective note. */
export function isMatchingNature(nature: EventConfirmationFact['nature']) {
  return (
    nature === 'original_fact' ||
    nature === 'self_report' ||
    nature === 'human_conclusion'
  );
}
/** Matching-specific records only. Complete source projection comes from 837. */
export function assembleMatchingEvidence(material: MatchingEvidenceMaterial): {
  snapshot: {
    context: AuthzContext;
    records: TalentRecord[];
    sources: TalentSource[];
  };
  confirmations: EventConfirmationFact[];
  sources: Source[];
  actor: { id: string; name: string };
} {
  const actor = material.directory.people.find(
    (person) => person.id === material.context.account.personId,
  );
  if (!actor || !actor.name.trim()) throw new MatchingError('forbidden');
  const records: TalentRecord[] = [];
  for (const person of material.directory.people) {
    const organization = material.directory.organizations.find(
      (row) => row.id === person.organizationId,
    );
    if (!organization) throw new MatchingError('conflict');
    // These are factual period variants, not authorization decisions. 835
    // decides which variant is visible; the usecase merges identical identity.
    const periods = new Set<string | null>([
      null,
      ...material.context.enrollments
        .filter((row) => row.personId === person.id)
        .map((row) => row.cohortId),
    ]);
    for (const cohortId of periods)
      records.push({
        id: JSON.stringify(['person', person.id, cohortId]),
        subject: { personId: person.id, cohortId },
        kind: 'person',
        fields: [
          {
            name: 'name',
            kind: 'person',
            value: person.name,
            subjects: [],
            sources: [],
          },
          {
            name: 'orgName',
            kind: 'person',
            value: organization.name,
            subjects: [],
            sources: [],
          },
        ],
      });
  }
  for (const event of material.events) {
    const facts = material.confirmations.filter(
      (fact) =>
        fact.recordId === event.id &&
        fact.personId === event.personId &&
        fact.active &&
        fact.state === 'confirmed',
    );
    if (facts.length === 0) continue;
    if (facts.length !== 1) throw new MatchingError('conflict');
    if (!isMatchingNature(facts[0]!.nature)) continue;
    const project = material.projects.find((row) => row.id === event.projectId);
    if (event.projectId !== null && !project)
      throw new MatchingError('conflict');
    const kind = 'evaluation' as const;
    const sources = material.eventSources
      .filter((row) => row.eventId === event.id)
      .map((row) => ({
        fragmentId: row.fragmentId,
        originalVersionId: row.originalVersionId,
      }));
    records.push({
      id: event.id,
      subject: {
        personId: event.personId,
        cohortId: project?.cohortId ?? null,
      },
      kind,
      fields: [
        {
          name: 'situation',
          kind,
          value: event.situation,
          subjects: [],
          sources,
        },
        {
          name: 'behavior',
          kind,
          value: event.behavior,
          subjects: [],
          sources,
        },
        { name: 'impact', kind, value: event.impact, subjects: [], sources },
      ],
    });
  }
  return {
    snapshot: { context: material.context, records, sources: material.sources },
    confirmations: material.confirmations,
    sources: material.sourceDetails,
    actor: { id: actor.id, name: actor.name },
  };
}
