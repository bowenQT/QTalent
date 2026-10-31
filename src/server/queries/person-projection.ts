import 'server-only';
import {
  personSchema,
  type Person,
  type CapabilityScore,
} from '../../contracts/person';
import { activeRoles, canReadProject, isCurrent } from '../authz';
import {
  canReadTalent,
  projectTalentRecord,
  type TalentKind,
  type TalentSubject,
} from '../authz/talent';
import { deriveReferencePosition } from '../modules/talent';
import type { PositionScore } from '../modules/talent';
import { type PersonData, eventSubject, talentSources } from './person-data';
import { sourceFromData } from './sources';

export function personRole(data: PersonData) {
  const roles = activeRoles(data.context);
  return roles.includes('manager')
    ? 'manager'
    : roles.includes('hr')
      ? 'hr'
      : roles.includes('mentor')
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
const block = <T>(items: T[]) =>
  items.length
    ? { status: 'ready' as const, data: items }
    : { status: 'empty' as const };

export async function personFromData(
  data: PersonData,
  id: string,
): Promise<Person | null> {
  const role = personRole(data);
  const person = data.directory.people.find((row) => row.id === id);
  const subjects = personSubjects(data, id);
  const allowed = (kind: TalentKind) =>
    subjects.some((subject) =>
      canReadTalent(data.context, { ...subject, kind }, 'person-profile'),
    );
  if (!role || !person || !allowed('person')) return null;
  const organization = data.directory.organizations.find(
    (row) => row.id === person.organizationId,
  );
  if (!organization) throw new Error('人员组织引用不存在');
  const sources = talentSources(data);
  const visibleStatement = data.statements.flatMap((statement) => {
    const event = data.events.find((row) => row.id === statement.eventId);
    if (!event || event.personId !== id) return [];
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
            sources: [statement],
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
        nature: statement.kind,
        occurredAt: event.occurredOn + 'T00:00:00.000Z',
        sources: projected.sources.map((source) => ({
          fragmentId: source.fragmentId,
          originalVersionId: source.originalVersionId,
          location: source.location,
        })),
      },
    ];
  });
  const scores: CapabilityScore[] = [];
  const positionScores: PositionScore[] = [];
  for (const confirmation of data.confirmations) {
    if (!confirmation.active || confirmation.status !== 'scored') continue;
    const event = data.events.find((row) => row.id === confirmation.eventId);
    if (!event || event.personId !== id) continue;
    const subject = eventSubject(data, event);
    if (
      !canReadTalent(
        data.context,
        { ...subject, kind: 'confirmed-score' },
        'person-profile',
      )
    )
      continue;
    const source = await sourceFromData(data, confirmation, sources);
    if (source.status !== 'success') continue;
    if (source.source.sourceCategory !== confirmation.sourceCategory) continue;
    if (
      confirmation.sourceCategory === 'prototype_baseline' &&
      (!event.demo || !person.demo)
    )
      continue;
    const dimension = data.dimensions.find(
      (row) => row.id === confirmation.dimensionId,
    );
    const anchor = data.anchors.find(
      (row) =>
        row.id === confirmation.anchorId &&
        row.dimensionId === confirmation.dimensionId &&
        row.ruleVersionId === confirmation.ruleVersionId &&
        row.value === confirmation.value,
    );
    const evaluator = data.directory.people.find(
      (row) => row.id === confirmation.evaluatorId,
    );
    if (!dimension || !anchor || !evaluator || confirmation.value === null)
      continue;
    scores.push({
      id: confirmation.id,
      dimensionId: dimension.id,
      dimensionLabel: dimension.name,
      status: 'confirmed',
      sourceCategory: confirmation.sourceCategory,
      value: confirmation.value,
      anchor: anchor.text,
      scoredBy: evaluator.name,
      ruleVersionId: confirmation.ruleVersionId,
      sources: [
        {
          fragmentId: source.source.fragmentId,
          originalVersionId: source.source.originalVersionId,
          location: source.source.location,
        },
      ],
    });
    if (
      canReadTalent(
        data.context,
        { ...subject, kind: 'quadrant' },
        'person-profile',
      )
    )
      positionScores.push({
        eventId: event.id,
        occurredOn: event.occurredOn,
        dimensionId: dimension.id,
        axis: dimension.axis,
        core: dimension.core,
        value: confirmation.value,
        ruleVersionId: confirmation.ruleVersionId,
      });
  }
  scores.sort(
    (a, b) =>
      a.dimensionId.localeCompare(b.dimensionId) || a.id.localeCompare(b.id),
  );
  const cited = visibleStatement.filter((row) =>
    ['original_fact', 'self_report', 'human_conclusion'].includes(row.nature),
  );
  const statementOnly = (row: (typeof visibleStatement)[number]) => ({
    id: row.id,
    text: row.text,
    nature: row.nature,
    sources: row.sources,
  });
  const projects = data.staffing.projects
    .filter(
      (project) =>
        canReadProject(data.context, project) &&
        (project.ownerId === id ||
          data.staffing.members.some(
            (member) =>
              member.projectId === project.id &&
              member.personId === id &&
              member.validFrom <= data.context.now,
          )),
    )
    .map((project) => ({
      id: project.id,
      name: project.name,
      participation: project.ownerId === id ? 'owner' : 'member',
    }));
  const shared = {
    role,
    person: {
      id: person.id,
      demo: person.demo,
      name: person.name,
      teamId: organization.id,
      teamName: organization.shortName,
      jobTitle: '职位未接入',
    },
    summary: block(cited.map(statementOnly)),
    capabilityProfile: scores.length
      ? block(scores)
      : { status: 'insufficient_evidence', reason: '暂无可用的已确认维度分' },
    timeline: block(
      visibleStatement
        .filter((row) => row.nature !== 'ai_inference')
        .map((row) => ({
          id: row.id,
          occurredAt: row.occurredAt,
          statement: statementOnly(row),
        }))
        .sort(
          (a, b) =>
            b.occurredAt.localeCompare(a.occurredAt) ||
            a.id.localeCompare(b.id),
        ),
    ),
    projects: block(projects),
    aiInferences: block(
      visibleStatement
        .filter((row) => row.nature === 'ai_inference')
        .map(statementOnly),
    ),
  };
  return personSchema.parse(
    role === 'mentor'
      ? shared
      : {
          ...shared,
          referencePosition: allowed('quadrant')
            ? deriveReferencePosition(positionScores, data.context.now)
            : { status: 'unknown', reason: '当前权限不可读取参考位置' },
          managementObservations: block(
            visibleStatement
              .filter((row) => row.nature === 'management_observation')
              .map(statementOnly),
          ),
          calibrationHistory: { status: 'not_connected' },
          versionsAndChanges: { status: 'not_connected' },
        },
  );
}
