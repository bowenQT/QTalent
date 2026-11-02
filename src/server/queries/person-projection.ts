import 'server-only';
import { personSchema, type Person } from '../../contracts/person';
import { activeRoles, canReadProject, isCurrent } from '../authz';
import {
  canReadTalent,
  type TalentKind,
  type TalentSource,
  type TalentSubject,
} from '../authz/talent';
import { deriveReferencePosition } from '../modules/talent';
import type { PositionScore } from '../modules/talent';
import {
  type PersonData,
  talentSources,
  personBusinessDay,
} from './person-data';
import { byCodePoint, identityOf, landingOf } from './person-identity';
import {
  collectEvidence,
  dimensionGroup,
  orderedDimensions,
  type EffectiveScore,
  type Evidence,
} from './person-evidence';
import { missingVisibleCapabilityEvidence } from './person-display-policy';

export function personRole(data: PersonData) {
  const roles = activeRoles(data.context);
  return roles.includes('manager')
    ? 'manager'
    : roles.includes('hr')
      ? 'hr'
      : roles.includes('mentor') ||
          data.context.evaluationRelations?.some(
            (relation) =>
              relation.evaluatorId === data.context.account.personId &&
              isCurrent(relation, data.context.now),
          )
        ? 'mentor'
        : null;
}
function personSubjects(data: PersonData, id: string): TalentSubject[] {
  return [
    { personId: id, cohortId: null },
    ...data.context.enrollments
      .filter((row) => row.personId === id && isCurrent(row, data.context.now))
      .map((row) => ({ personId: id, cohortId: row.cohortId })),
  ];
}
/** The profile gate shared by the profile and the quick view: role, directory
 * row and the right to read the person at all. Absent and out-of-scope people
 * are indistinguishable (null).
 */
export function profileGate(data: PersonData, id: string) {
  const role = personRole(data);
  const row = data.directory.people.find((item) => item.id === id);
  const subjects = personSubjects(data, id);
  const allowed = (kind: TalentKind) =>
    subjects.some((subject) =>
      canReadTalent(data.context, { ...subject, kind }, 'person-profile'),
    );
  return role && row && allowed('person') ? { role, row, allowed } : null;
}
const block = <T>(items: T[]) =>
  items.length
    ? { status: 'ready' as const, data: items }
    : { status: 'empty' as const };
const dayMs = 86_400_000;
const shiftDays = (day: string, delta: number) =>
  new Date(Date.parse(day) + delta * dayMs).toISOString().slice(0, 10);

/** Only projects the caller may read, one row per membership started by the
 * business day. A project owner without a membership row has no role, mode or
 * dates to show and is not listed.
 */
export function projectsOf(data: PersonData, id: string) {
  return data.staffing.members
    .filter(
      (member) =>
        member.personId === id && member.validFrom <= data.context.now,
    )
    .flatMap((member) => {
      const project = data.staffing.projects.find(
        (row) => row.id === member.projectId,
      );
      return project && canReadProject(data.context, project)
        ? [
            {
              id: project.id,
              name: project.name,
              role: member.role,
              mode: member.mode,
              from: member.validFrom,
              to: member.validTo,
            },
          ]
        : [];
    })
    .sort(
      (a, b) =>
        byCodePoint(b.from, a.from) ||
        byCodePoint(a.name, b.name) ||
        byCodePoint(a.id, b.id),
    );
}
export function referenceOf(
  data: PersonData,
  allowed: boolean,
  effective: EffectiveScore[],
) {
  if (!allowed)
    return { status: 'unknown' as const, reason: '当前权限不可读取参考位置' };
  const scores: PositionScore[] = effective
    .filter((row) => row.quadrant)
    .map((row) => ({
      eventId: row.event.id,
      occurredOn: row.event.occurredOn,
      dimensionId: row.dimension.id,
      axis: row.dimension.axis,
      core: row.dimension.core,
      value: row.score.value,
      ruleVersionId: row.score.ruleVersionId,
    }));
  return deriveReferencePosition(scores, personBusinessDay(data));
}
function spectrum(data: PersonData, evidence: Evidence) {
  const asOf = personBusinessDay(data);
  const windowFrom = shiftDays(asOf, -365);
  const dimensions = orderedDimensions(data);
  const rank = new Map(dimensions.map((row, index) => [row.id, index]));
  const scores = evidence.effective
    .filter(
      (row) =>
        row.event.occurredOn >= windowFrom && row.event.occurredOn <= asOf,
    )
    .map((row) => ({
      id: row.score.scoreId,
      dimensionId: row.dimension.id,
      dimensionLabel: row.dimension.name,
      status: 'confirmed' as const,
      sourceCategory: row.score.sourceCategory,
      value: row.score.value,
      anchor: row.score.anchor,
      scoredByName: row.score.scoredByName,
      ruleVersionId: row.score.ruleVersionId,
      eventId: row.event.id,
      eventTitle: row.event.title,
      occurredOn: row.event.occurredOn,
      sources: row.score.sources,
    }))
    .sort(
      (a, b) =>
        rank.get(a.dimensionId)! - rank.get(b.dimensionId)! ||
        byCodePoint(a.id, b.id),
    );
  if (!scores.length)
    return {
      status: 'insufficient_evidence' as const,
      reason: missingVisibleCapabilityEvidence(),
    };
  const scored = new Set(scores.map((row) => row.dimensionId));
  // Only dimensions on event cards this viewer can already read.
  const visible = new Set(
    evidence.keyEvents.flatMap((row) =>
      row.scores.map((score) => score.dimensionId),
    ),
  );
  return {
    status: 'ready' as const,
    data: {
      windowFrom,
      dimensions: dimensions.map((row) => ({
        id: row.id,
        label: row.name,
        group: dimensionGroup(row),
        state: scored.has(row.id)
          ? ('scored' as const)
          : ('insufficient' as const),
        ...(scored.has(row.id)
          ? {}
          : { missing: missingVisibleCapabilityEvidence(row.id, visible) }),
      })),
      scores,
    },
  };
}
export async function personFromData(
  data: PersonData,
  id: string,
  sources: TalentSource[] = talentSources(data),
): Promise<Person | null> {
  const gate = profileGate(data, id);
  if (!gate) return null;
  const evidence = await collectEvidence(data, id, sources);
  const shared = {
    role: gate.role,
    person: identityOf(data, gate.row),
    asOf: personBusinessDay(data),
    landing: landingOf(data, id),
    // A readable human conclusion has no date yet (BOW-834 S7): unknown, not empty.
    summary: evidence.conclusionCount
      ? {
          status: 'unknown' as const,
          reason: '人工结论的署名日期尚未接入',
        }
      : { status: 'empty' as const },
    capabilityProfile: spectrum(data, evidence),
    timeline: block(evidence.entries),
    projects: block(projectsOf(data, id)),
    aiInferences: block(evidence.aiInferences),
  };
  return personSchema.parse(
    gate.role === 'mentor'
      ? shared
      : {
          ...shared,
          referencePosition: referenceOf(
            data,
            gate.allowed('quadrant'),
            evidence.effective,
          ),
          calibrationHistory: { status: 'not_connected' },
          versionsAndChanges: { status: 'not_connected' },
        },
  );
}
