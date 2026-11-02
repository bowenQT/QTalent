import type { Person } from '../../contracts/person';
import { canReadProject } from '../authz';
import {
  canReadTalent,
  projectTalentRecord,
  type TalentKind,
  type TalentSource,
} from '../authz/talent';
import {
  type PersonData,
  eventSubject,
  sourceKey,
  historicalSubject,
} from './person-data';
import { byCodePoint, byPinyin } from './person-identity';
import { sourceFromData } from './sources';
import { historicalEvaluationRequiredKind } from './historical-evaluation-policy';
import { orderCapabilityDimensions } from './person-display-policy';

type Ready<T> = T extends { status: 'ready'; data: infer D } ? D : never;
type Variant = Extract<Person, { role: 'manager' | 'hr' }>;
export type TimelineEntry = Ready<Variant['timeline']>[number];
export type KeyEvent = Extract<TimelineEntry, { kind: 'key_event' }>;
export type AiInference = Ready<Variant['aiInferences']>[number];
type EventScore = KeyEvent['scores'][number];
type Confirmed = Extract<EventScore, { state: 'confirmed' }>;
type Category =
  'evaluation' | 'management-observation' | 'restricted-evaluation';
type Dimension = PersonData['dimensions'][number];

/** An effective, non-conflicting confirmed score on a readable event. Every
 * projection that counts scores (spectrum, quick view, reference position) uses
 * this one list, so conflicts and unreadable events never leak into any of them.
 */
export interface EffectiveScore {
  score: Confirmed;
  dimension: Dimension;
  event: { id: string; title: string; occurredOn: string };
  /** Whether the caller may also read the quadrant of this event's period. */
  quadrant: boolean;
}
export interface Evidence {
  entries: TimelineEntry[];
  keyEvents: KeyEvent[];
  effective: EffectiveScore[];
  aiInferences: AiInference[];
  /** Readable human conclusions exist but carry no date yet (BOW-834 S7). */
  conclusionCount: number;
}
export const dimensionGroup = (dimension: Dimension) =>
  dimension.axis === 'prof'
    ? ('professional' as const)
    : dimension.core
      ? ('potential_core' as const)
      : ('potential_bonus' as const);
const groupRank = { professional: 0, potential_core: 1, potential_bonus: 2 };
/** There is no catalogue-order column yet: group, then id (never by score),
 * with the potential core in the fixed prototype order.
 */
export function orderedDimensions(data: PersonData): Dimension[] {
  return orderCapabilityDimensions(
    [...data.dimensions].sort(
      (a, b) =>
        groupRank[dimensionGroup(a)] - groupRank[dimensionGroup(b)] ||
        byCodePoint(a.id, b.id),
    ),
  );
}
const refOf = (reference: {
  fragmentId: string;
  originalVersionId: string;
}) => ({
  fragmentId: reference.fragmentId,
  originalVersionId: reference.originalVersionId,
});
const pluck = (reference: {
  fragmentId: string;
  originalVersionId: string;
  location: KeyEvent['sources'][number]['location'];
}) => ({ ...refOf(reference), location: reference.location });
const restricts = (
  sources: TalentSource[],
  reference: object,
  kind: 'management-observation' | 'restricted-evaluation',
) =>
  sources
    .find((source) => sourceKey(source) === sourceKey(reference as never))
    ?.requiredKinds?.includes(kind) ?? false;
// Preserve the current source classification in the response as well. Every
// contributing source still passes all of its requiredKinds in projectTalentRecord.
const categoryOf = (
  sources: TalentSource[],
  references: object[],
  management = false,
): Category =>
  management ||
  references.some((ref) => restricts(sources, ref, 'management-observation'))
    ? 'management-observation'
    : references.some((ref) => restricts(sources, ref, 'restricted-evaluation'))
      ? 'restricted-evaluation'
      : 'evaluation';
const newestFirst = (
  a: { occurredOn: string; id: string },
  b: { occurredOn: string; id: string },
) => byCodePoint(b.occurredOn, a.occurredOn) || byCodePoint(a.id, b.id);

interface Statement {
  id: string;
  text: string;
  kind: string;
  occurredOn: string;
  category: Category;
  sources: ReturnType<typeof pluck>[];
}
/** Statements are authorized as atomic fields: one unreadable contributing
 * source or subject drops the statement, never only its citation.
 */
function visibleStatements(
  data: PersonData,
  personId: string,
  sources: TalentSource[],
): Statement[] {
  return data.statements.flatMap((statement) => {
    const event = data.events.find((row) => row.id === statement.eventId);
    if (!event || event.withdrawnAt !== null || event.personId !== personId)
      return [];
    const kind: TalentKind =
      statement.kind === 'management_observation'
        ? 'management-observation'
        : statement.kind === 'ai_inference'
          ? 'ai-inference'
          : 'evaluation';
    const projected = projectTalentRecord(
      data.context,
      {
        id: statement.id,
        subject: eventSubject(data, event),
        kind,
        fields: [
          {
            name: 'text',
            kind,
            value: statement.text,
            subjects: [],
            sources: [refOf(statement)],
          },
        ],
      },
      sources,
      'person-profile',
    );
    if (!projected || typeof projected.fields.text !== 'string') return [];
    return [
      {
        id: statement.id,
        text: projected.fields.text,
        kind: statement.kind,
        occurredOn: event.occurredOn,
        category: categoryOf(
          sources,
          [statement],
          kind === 'management-observation',
        ),
        sources: projected.sources.map(pluck),
      },
    ];
  });
}
const clean = (value: string) => (value.trim() ? value : null);

export async function collectEvidence(
  data: PersonData,
  personId: string,
  sources: TalentSource[],
): Promise<Evidence> {
  const person = data.directory.people.find((row) => row.id === personId)!;
  const dimensions = orderedDimensions(data);
  const nameOf = (id: string) =>
    data.directory.people.find((row) => row.id === id)?.name;
  const keyEvents: KeyEvent[] = [];
  const effective: EffectiveScore[] = [];
  for (const event of data.events.filter(
    (row) => row.personId === personId && row.withdrawnAt === null,
  )) {
    const references = data.eventSources.filter(
      (link) => link.eventId === event.id,
    );
    const recorderName = nameOf(event.recorderId);
    // An event without a source is not readable; neither is one whose recorder
    // cannot be named.
    if (!references.length || !recorderName) continue;
    const statements = data.statements.filter(
      (row) => row.eventId === event.id,
    );
    const category = categoryOf(
      sources,
      references,
      statements.some((row) => row.kind === 'management_observation'),
    );
    const subject = eventSubject(data, event);
    const others = data.participants
      .filter((row) => row.eventId === event.id)
      .map((row) => ({ ...subject, personId: row.personId }));
    const field = (name: string, value: string) => ({
      name,
      kind: category,
      value,
      subjects: others,
      sources: references.map(refOf),
    });
    const projected = projectTalentRecord(
      data.context,
      {
        id: event.id,
        subject,
        kind: category,
        fields: [
          field('title', event.title),
          field('situation', event.situation),
          field('behavior', event.behavior),
          field('impact', event.impact),
        ],
      },
      sources,
      'person-profile',
    );
    if (!projected || Object.keys(projected.fields).length < 4) continue;
    const memberNames = [
      ...new Set([personId, ...others.map((row) => row.personId)]),
    ].map((id) => nameOf(id));
    if (memberNames.some((name) => !name)) continue;
    const project = data.staffing.projects.find(
      (row) => row.id === event.projectId,
    );
    const cardSources = projected.sources.map(pluck);
    // Scores: every row passes its own gate (kind, source, provenance) and is
    // grouped by dimension on this event.
    const scorable = canReadTalent(
      data.context,
      { ...subject, kind: 'confirmed-score' },
      'person-profile',
    );
    const quadrant = canReadTalent(
      data.context,
      { ...subject, kind: 'quadrant' },
      'person-profile',
    );
    const found = new Map<
      string,
      { scored: Confirmed[]; flags: Set<string> }
    >();
    for (const row of scorable
      ? data.confirmations.filter(
          (item) => item.active && item.eventId === event.id,
        )
      : []) {
      const dimension = dimensions.find((item) => item.id === row.dimensionId);
      const source = await sourceFromData(data, row, sources);
      if (
        !dimension ||
        source.status !== 'success' ||
        source.source.sourceCategory !== row.sourceCategory ||
        (row.sourceCategory === 'prototype_baseline' &&
          (!event.demo || !person.demo))
      )
        continue;
      const slot = found.get(dimension.id) ?? {
        scored: [],
        flags: new Set<string>(),
      };
      found.set(dimension.id, slot);
      if (row.status !== 'scored') {
        slot.flags.add(row.status);
        continue;
      }
      const anchor = data.anchors.find(
        (item) =>
          item.id === row.anchorId &&
          item.dimensionId === row.dimensionId &&
          item.ruleVersionId === row.ruleVersionId &&
          item.value === row.value,
      );
      const evaluatorName = row.evaluatorId && nameOf(row.evaluatorId);
      if (row.value === null || !anchor || !evaluatorName) continue;
      slot.scored.push({
        state: 'confirmed',
        scoreId: row.id,
        dimensionId: dimension.id,
        dimensionLabel: dimension.name,
        value: row.value,
        anchor: anchor.text,
        scoredByName: evaluatorName,
        ruleVersionId: row.ruleVersionId,
        sourceCategory: source.source.sourceCategory,
        sources: [pluck(source.source)],
      });
    }
    const scores: EventScore[] = [];
    for (const dimension of dimensions) {
      const slot = found.get(dimension.id);
      if (!slot) continue;
      const rated = slot.scored.sort((a, b) =>
        byCodePoint(a.scoreId, b.scoreId),
      );
      const label = {
        dimensionId: dimension.id,
        dimensionLabel: dimension.name,
      };
      if (!rated.length) {
        scores.push({
          state: slot.flags.has('not_demonstrated') ? 'absent' : 'insufficient',
          ...label,
        });
        continue;
      }
      const values = rated.map((row) => row.value);
      // Only a spread of two or more is a conflict; it counts nowhere.
      if (Math.max(...values) - Math.min(...values) >= 2) {
        scores.push({
          state: 'conflict',
          ...label,
          ratings: rated.map((score) => ({
            scoreId: score.scoreId,
            value: score.value,
            anchor: score.anchor,
            scoredByName: score.scoredByName,
            ruleVersionId: score.ruleVersionId,
            sourceCategory: score.sourceCategory,
            sources: score.sources,
          })),
        });
        continue;
      }
      for (const score of rated) {
        scores.push(score);
        effective.push({
          score,
          dimension,
          event: {
            id: event.id,
            title: event.title,
            occurredOn: event.occurredOn,
          },
          quadrant,
        });
      }
    }
    const participantNames = [...memberNames] as string[];
    keyEvents.push({
      kind: 'key_event',
      id: event.id,
      title: event.title,
      occurredOn: event.occurredOn,
      label: 'observation',
      category,
      sources: cardSources,
      recorderName,
      ...(project && canReadProject(data.context, project)
        ? { projectName: project.name }
        : {}),
      ...(participantNames.length >= 2
        ? {
            participants: participantNames
              .sort(byPinyin)
              .map((name) => ({ name })),
          }
        : {}),
      situation: event.situation,
      behavior: clean(event.behavior),
      impact: clean(event.impact),
      scores,
    });
  }
  const statements = visibleStatements(data, personId, sources);
  const selfReports: TimelineEntry[] = statements
    .filter((row) => row.kind === 'self_report')
    .map((row) => ({
      kind: 'self_report',
      id: row.id,
      title: row.text,
      occurredOn: row.occurredOn,
      label: 'self',
      category: row.category,
      sources: row.sources,
    }));
  // A history row taken from a key event the caller can read (the weekly review
  // of that event) repeats it on the timeline; the key event keeps its sources.
  const shownEvents = new Set(keyEvents.map((row) => row.id));
  const history: TimelineEntry[] = data.historical.flatMap((row) => {
    const members = data.historicalParticipants
      .filter((item) => item.evaluationId === row.id)
      .map((item) => item.personId);
    if (row.personId !== personId && !members.includes(personId)) return [];
    const category = historicalEvaluationRequiredKind(row);
    if (!category) return [];
    const reference = refOf(row);
    const projected = projectTalentRecord(
      data.context,
      {
        id: row.id,
        subject: historicalSubject(data, row, personId),
        kind: category,
        fields: [
          {
            name: 'kind',
            kind: category,
            value: row.kind,
            subjects: [...members, ...(row.personId ? [row.personId] : [])]
              .filter((id) => id !== personId)
              .map((id) => historicalSubject(data, row, id)),
            sources: [reference],
          },
        ],
      },
      sources,
      'person-profile',
    );
    if (!projected || !row.scale.length || shownEvents.has(row.sourceRecordId))
      return [];
    return [
      {
        kind: 'history' as const,
        id: row.id,
        title: row.period ? `${row.kind} · ${row.period}` : row.kind,
        occurredOn: row.occurredOn,
        label: 'history' as const,
        category,
        sources: projected.sources.map(pluck),
        scale: row.scale,
      },
    ];
  });
  return {
    entries: [...keyEvents, ...selfReports, ...history].sort(newestFirst),
    keyEvents: keyEvents.sort(newestFirst),
    effective,
    aiInferences: statements
      .filter((row) => row.kind === 'ai_inference')
      .map((row) => ({
        id: row.id,
        text: row.text,
        nature: 'ai_inference' as const,
        category: row.category,
        sources: row.sources,
      })),
    conclusionCount: statements.filter((row) => row.kind === 'human_conclusion')
      .length,
  };
}
