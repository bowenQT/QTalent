import { eq } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import { canReadProject } from '../authz';
import { type TalentSubject, type TalentSource } from '../authz/talent';
import { canConfirmOwnScore } from '../modules/talent/write-policy';
import { readEvidenceForTalent } from '../modules/records/read';
import { readTalentEvaluationRules } from '../modules/evaluation-system/read';
import { ruleVersions } from '../modules/evaluation-system';
import { loadProjectContext } from './project-context';
import { sourcesForDraft } from './talent-source-projection';
import { readArrangeInput } from '../modules/records/arrange/input-state/store';
import type { StoredArrangeInput } from '../modules/records/arrange/input-state/schema';
import type { ArrangeSnapshot, Selection } from '../modules/records/arrange';

export async function loadArrangeActor(
  tx: Transaction,
  accountId: string,
  today: string,
) {
  return loadProjectContext(tx, accountId, today);
}
export type ArrangeActor = Awaited<ReturnType<typeof loadArrangeActor>>;
export function personSubjects(
  actor: ArrangeActor,
  personId: string,
): TalentSubject[] {
  return [
    { personId, cohortId: null },
    ...actor.context.enrollments
      .filter((e) => e.personId === personId)
      .map((e) => ({ personId, cohortId: e.cohortId })),
    ...actor.context.assignments
      .filter((a) => a.studentId === personId)
      .map((a) => ({ personId, cohortId: a.cohortId })),
  ];
}
export function writableSubject(actor: ArrangeActor, personId: string) {
  return personSubjects(actor, personId).find((subject) =>
    canConfirmOwnScore(actor.context, subject, actor.context.account.personId),
  );
}
export function canWriteArrange(
  actor: ArrangeActor,
  personIds: readonly string[],
  projectId: string | null,
): boolean {
  const people = personIds.length
    ? personIds
    : actor.directory.people.map((p) => p.id);
  if (
    personIds.length
      ? people.some((id) => !writableSubject(actor, id))
      : !people.some((id) => writableSubject(actor, id))
  )
    return false;
  if (projectId === null) return true;
  const project = actor.context.projects.find((p) => p.id === projectId);
  return project !== undefined && canReadProject(actor.context, project);
}
export interface RecordPageInput {
  personId: string | null;
  projectId: string | null;
}
export function buildRecordPageContext(
  actor: ArrangeActor,
  input: RecordPageInput,
) {
  if (
    !canWriteArrange(
      actor,
      input.personId ? [input.personId] : [],
      input.projectId,
    )
  )
    return null;
  return {
    accountId: actor.context.account.id,
    people: actor.directory.people
      .filter((person) => writableSubject(actor, person.id))
      .map((person) => ({ id: person.id, label: person.name })),
    projects: actor.staffing.projects
      .filter((project) => canReadProject(actor.context, project))
      .map((project) => ({ id: project.id, label: project.name })),
    selectedPersonId: input.personId,
    selectedProjectId: input.projectId,
  };
}
export function textSubjects(
  actor: ArrangeActor,
  text: string,
  personIds: readonly string[],
): TalentSubject[] {
  const ids = new Set([
    ...personIds,
    ...actor.directory.people
      .filter((p) => p.name.trim() && text.includes(p.name))
      .map((p) => p.id),
  ]);
  return [...ids].map(
    (id) => writableSubject(actor, id) ?? { personId: id, cohortId: null },
  );
}
export function projectSelection(
  actor: ArrangeActor,
  input: StoredArrangeInput,
): Selection {
  if (input.projectMode === 'resolved' && input.projectId)
    return { state: 'resolved', id: input.projectId };
  if (input.projectMode === 'none') return { state: 'none' };
  return {
    state: 'needs_selection',
    reason: '请确认项目，或选择不关联项目',
    candidates: actor.staffing.projects
      .filter(
        (p) =>
          input.projectCandidateIds.includes(p.id) &&
          canReadProject(actor.context, p),
      )
      .map((p) => ({ id: p.id, label: p.name })),
  };
}
export async function loadRecordArrangeSnapshot(
  tx: Transaction,
  resourceId: string,
  accountId: string | undefined,
  today: string,
  environment: string,
): Promise<ArrangeSnapshot | null> {
  const input = await readArrangeInput(tx, resourceId);
  if (
    !input ||
    input.supersededByInputId !== null ||
    (accountId !== undefined && accountId !== input.creatorAccountId)
  )
    return null;
  const actor = await loadArrangeActor(
    tx,
    accountId ?? input.creatorAccountId,
    today,
  );
  if (!canWriteArrange(actor, input.personIds, input.projectId)) return null;
  const evidence = await readEvidenceForTalent(tx);
  const rules = await readTalentEvaluationRules(tx);
  const published = await tx
    .select()
    .from(ruleVersions)
    .where(eq(ruleVersions.provenance, 'published'));
  const eligible = published.filter((v) =>
    rules.anchors.some((a) => a.ruleVersionId === v.id),
  );
  let ruleVersionId: string | undefined;
  if (eligible.length === 1) ruleVersionId = eligible[0]!.id;
  else if (eligible.length === 0 && environment !== 'production') {
    const demo = await tx
      .select()
      .from(ruleVersions)
      .where(eq(ruleVersions.provenance, 'demo_import_snapshot'));
    const versions = demo.filter((v) =>
      rules.anchors.some((a) => a.ruleVersionId === v.id),
    );
    if (versions.length === 1) ruleVersionId = versions[0]!.id;
  }
  if (!ruleVersionId)
    throw new Error('Evaluation rule version is not uniquely effective');
  // This consumer accepts original text/media fragments, not prototype baseline
  // fields. Retain complete related-event/history data for the shared projector.
  const fragments = evidence.fragments.flatMap((fragment) => {
    const location = fragment.location;
    return location.kind === 'snapshot_field'
      ? []
      : [{ ...fragment, location }];
  });
  const projected = sourcesForDraft(
    { ...actor, ...evidence, fragments },
    input.sourceContexts,
  );
  const sources: TalentSource[] = projected.map((source) => {
    const context = input.sourceContexts.find(
      (c) =>
        c.fragmentId === source.fragmentId &&
        c.originalVersionId === source.originalVersionId,
    );
    return context
      ? {
          ...source,
          requiredKinds: [
            ...new Set([
              ...(source.requiredKinds ?? []),
              ...(context.kind === 'evaluation' ? [] : [context.kind]),
              ...context.requiredKinds,
            ]),
          ],
        }
      : source;
  });
  const records = input.sourceContexts.flatMap((reference) => {
    const source = sources.find(
      (s) =>
        s.fragmentId === reference.fragmentId &&
        s.originalVersionId === reference.originalVersionId,
    );
    if (!source?.subjects[0]) return [];
    return [
      {
        id: reference.fragmentId,
        subject: source.subjects[0],
        kind: 'evaluation' as const,
        fields: [
          {
            name: 'excerpt',
            kind: 'evaluation' as const,
            value: source.excerpt,
            subjects: source.subjects,
            sources: [
              {
                fragmentId: reference.fragmentId,
                originalVersionId: reference.originalVersionId,
              },
            ],
          },
        ],
      },
    ];
  });
  const people: ArrangeSnapshot['people'] = input.personIds.length
    ? input.personIds.map((id) => ({ state: 'resolved', id }))
    : [
        {
          state: 'needs_selection',
          reason: '请选择本条记录涉及的人员',
          candidates: actor.directory.people
            .filter((p) => writableSubject(actor, p.id))
            .map((p) => ({ id: p.id, label: p.name })),
        },
      ];
  return {
    draftId: input.id,
    creatorAccountId: input.creatorAccountId,
    inputVersion: input.inputVersion,
    origin: input.origin,
    originalInput: input.originalInput,
    people,
    project: projectSelection(actor, input),
    authorization: { context: actor.context, records, sources },
    requestedSources: input.sourceContexts.map((c) => ({
      fragmentId: c.fragmentId,
      originalVersionId: c.originalVersionId,
      attributedPersonIds: c.attributedPersonIds,
    })),
    inputSource: input.inputSource,
    ruleVersionId,
    dimensions: rules.dimensions.map((d) => d.id),
    anchors: rules.anchors.filter((a) => a.ruleVersionId === ruleVersionId),
  };
}
