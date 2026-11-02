import { createHash } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import type { DbExecutor, Transaction } from '../db/client';
import { canReadProject } from '../authz';
import { canConfirmOwnNodeScore } from '../authz/evaluation-node';
import { canReadTalent, type TalentSubject } from '../authz/talent';
import { accountBindings, grants, people } from '../modules/directory';
import { projects, members } from '../modules/staffing';
import {
  evaluationNodes,
  evaluationNodeSubjects,
  evaluationRelations,
  enrollments,
  assignments,
} from '../modules/programs';
import {
  readEvidenceForTalent,
  fragments,
  originals,
  originalVersions,
  events,
  eventSources,
  eventParticipants,
  historicalEvaluations,
  historicalParticipants,
  statements,
} from '../modules/records';
import type { StoredArrangeInput } from '../modules/records/arrange/input-state/schema';
import type { BatchSnapshot } from '../modules/records/arrange/batch';
import { loadEvaluationContext } from './evaluation-context';
import type { BatchJobMetadata } from './record-batch-arrange-state';

export class NativeArrangeUnavailable extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'NativeArrangeUnavailable';
  }
}
export async function loadArrangeActor(
  db: DbExecutor,
  accountId: string,
  at: string,
) {
  return loadEvaluationContext(db, accountId, at);
}
export type ArrangeActor = Awaited<ReturnType<typeof loadArrangeActor>>;
export function personSubjects(
  actor: ArrangeActor,
  personId: string,
  nodeId?: string,
): TalentSubject[] {
  return actor.context.evaluationNodeSubjects
    .filter(
      (subject) =>
        subject.personId === personId &&
        (!nodeId || subject.evaluationNodeId === nodeId),
    )
    .map((subject) => ({
      personId,
      evaluationNodeId: subject.evaluationNodeId,
      cohortId:
        actor.context.evaluationNodes.find(
          (node) => node.id === subject.evaluationNodeId,
        )?.cohortId ?? null,
    }));
}
export function writableSubject(
  actor: ArrangeActor,
  personId: string,
  nodeId?: string,
) {
  return personSubjects(actor, personId, nodeId).find((subject) =>
    canConfirmOwnNodeScore(actor.context, {
      evaluationNodeId: subject.evaluationNodeId!,
      personId,
      raterId: actor.context.account.personId,
    }),
  );
}
export function canWriteArrange(
  actor: ArrangeActor,
  personIds: readonly string[],
  projectId: string | null,
  nodeId?: string,
): boolean {
  const nodes = actor.context.evaluationNodes.filter(
    (node) => !nodeId || node.id === nodeId,
  );
  const writable = nodes.some((node) =>
    personIds.length
      ? personIds.every(
          (id) => writableSubject(actor, id, node.id) !== undefined,
        )
      : actor.context.evaluationNodeSubjects.some(
          (subject) =>
            subject.evaluationNodeId === node.id &&
            writableSubject(actor, subject.personId, node.id) !== undefined,
        ),
  );
  if (!writable) return false;
  if (projectId === null) return true;
  const project = actor.context.projects.find((item) => item.id === projectId);
  return project !== undefined && canReadProject(actor.context, project);
}
export interface RecordPageInput {
  personId: string | null;
  projectId: string | null;
  evaluationNodeId?: string | null;
}
export function buildRecordPageContext(
  actor: ArrangeActor,
  input: RecordPageInput,
) {
  const nodeId = input.evaluationNodeId ?? undefined;
  if (
    !canWriteArrange(
      actor,
      input.personId ? [input.personId] : [],
      input.projectId,
      nodeId,
    )
  )
    return null;
  return {
    accountId: actor.context.account.id,
    people: actor.directory.people
      .filter((person) => writableSubject(actor, person.id, nodeId))
      .map((person) => ({ id: person.id, label: person.name })),
    projects: actor.staffing.projects
      .filter((project) => canReadProject(actor.context, project))
      .map((project) => ({ id: project.id, label: project.name })),
    evaluationNodes: actor.context.evaluationNodes.filter((node) =>
      canWriteArrange(
        actor,
        input.personId ? [input.personId] : [],
        input.projectId,
        node.id,
      ),
    ),
    selectedPersonId: input.personId,
    selectedProjectId: input.projectId,
    selectedEvaluationNodeId: input.evaluationNodeId ?? null,
  };
}
/** Classification for a NEW user-authored text, never a reclassification of an upload.
 * Directory mentions widen privacy subjects, never behavior attribution or access. */
export function textSubjects(
  actor: ArrangeActor,
  text: string,
  personIds: readonly string[],
  nodeId: string,
): TalentSubject[] {
  const ids = new Set([
    ...personIds,
    ...actor.directory.people
      .filter((person) => person.name.trim() && text.includes(person.name))
      .map((person) => person.id),
  ]);
  return [...ids].map(
    (personId) =>
      personSubjects(actor, personId, nodeId)[0] ?? {
        personId,
        cohortId: null,
        evaluationNodeId: null,
      },
  );
}
export function requireNativeInput(input: StoredArrangeInput) {
  if (
    !input.batchId ||
    !input.evaluationNodeId ||
    !input.boundAt ||
    !input.occurredOn ||
    input.origin !== 'text' ||
    input.originalInput.attachmentIds.length ||
    !input.inputSource ||
    input.sourceContexts.length !== 1
  )
    throw new NativeArrangeUnavailable('native_text_input_facts_required');
  return {
    batchId: input.batchId,
    evaluationNodeId: input.evaluationNodeId,
    boundAt: input.boundAt.toISOString(),
    occurredOn: input.occurredOn,
  };
}
/** Lock existing authorization rows and the FK-backed complete source graph.
 * The job row is locked by the caller first. No locks survive model dispatch. */
export async function lockNativeTextFacts(
  tx: Transaction,
  input: StoredArrangeInput,
) {
  const native = requireNativeInput(input);
  await tx
    .select()
    .from(accountBindings)
    .where(eq(accountBindings.accountId, input.creatorAccountId))
    .for('share');
  await tx
    .select()
    .from(grants)
    .where(eq(grants.accountId, input.creatorAccountId))
    .orderBy(grants.id)
    .for('share');
  await tx
    .select()
    .from(fragments)
    .where(eq(fragments.id, input.inputSource!.fragmentId))
    .for('update');
  await tx
    .select()
    .from(originalVersions)
    .where(eq(originalVersions.id, input.inputSource!.originalVersionId))
    .for('update');
  await tx
    .select()
    .from(eventSources)
    .where(eq(eventSources.fragmentId, input.inputSource!.fragmentId))
    .for('update');
  const before = await readEvidenceForTalent(tx);
  const linked = before.eventSources
    .filter(
      (source) =>
        source.fragmentId === input.inputSource!.fragmentId &&
        source.originalVersionId === input.inputSource!.originalVersionId,
    )
    .map((source) => source.eventId);
  const history = before.historical
    .filter(
      (source) =>
        source.fragmentId === input.inputSource!.fragmentId &&
        source.originalVersionId === input.inputSource!.originalVersionId,
    )
    .map((source) => source.id);
  if (linked.length) {
    await tx
      .select()
      .from(events)
      .where(inArray(events.id, linked))
      .orderBy(events.id)
      .for('update');
    await tx
      .select()
      .from(eventParticipants)
      .where(inArray(eventParticipants.eventId, linked))
      .for('update');
  }
  if (history.length) {
    await tx
      .select()
      .from(historicalEvaluations)
      .where(inArray(historicalEvaluations.id, history))
      .orderBy(historicalEvaluations.id)
      .for('update');
    await tx
      .select()
      .from(historicalParticipants)
      .where(inArray(historicalParticipants.evaluationId, history))
      .for('update');
  }
  await tx
    .select()
    .from(statements)
    .where(eq(statements.fragmentId, input.inputSource!.fragmentId))
    .for('update');
  const lockedGraph = await readEvidenceForTalent(tx);
  const ids = [
    ...new Set([
      ...input.personIds,
      ...input.sourceContexts.flatMap((source) =>
        source.subjects.map((subject) => subject.personId),
      ),
      ...lockedGraph.events
        .filter((event) => linked.includes(event.id))
        .map((event) => event.personId),
      ...lockedGraph.participants
        .filter((row) => linked.includes(row.eventId))
        .map((row) => row.personId),
      ...lockedGraph.historical
        .filter((row) => history.includes(row.id) && row.personId !== null)
        .map((row) => row.personId!),
      ...lockedGraph.historicalParticipants
        .filter((row) => history.includes(row.evaluationId))
        .map((row) => row.personId),
    ]),
  ].sort();
  if (ids.length) {
    await tx
      .select()
      .from(people)
      .where(inArray(people.id, ids))
      .orderBy(people.id)
      .for('share');
    await tx
      .select()
      .from(evaluationNodeSubjects)
      .where(inArray(evaluationNodeSubjects.personId, ids))
      .for('share');
    await tx
      .select()
      .from(evaluationRelations)
      .where(inArray(evaluationRelations.personId, ids))
      .orderBy(evaluationRelations.id)
      .for('share');
    await tx
      .select()
      .from(enrollments)
      .where(inArray(enrollments.personId, ids))
      .orderBy(enrollments.id)
      .for('share');
    await tx
      .select()
      .from(assignments)
      .where(inArray(assignments.studentId, ids))
      .orderBy(assignments.id)
      .for('share');
  }
  await tx
    .select()
    .from(evaluationNodes)
    .where(
      inArray(
        evaluationNodes.id,
        [
          ...new Set([
            native.evaluationNodeId,
            ...input.sourceContexts.flatMap((context) =>
              context.subjects.flatMap(
                (subject) => subject.evaluationNodeId ?? [],
              ),
            ),
            ...lockedGraph.events
              .filter((event) => linked.includes(event.id))
              .flatMap((event) => event.evaluationNodeId ?? []),
            ...lockedGraph.historical
              .filter((row) => history.includes(row.id))
              .flatMap((row) => row.evaluationNodeId ?? []),
          ]),
        ].sort(),
      ),
    )
    .orderBy(evaluationNodes.id)
    .for('share');
  if (input.projectId !== null) {
    await tx
      .select()
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .for('share');
    await tx
      .select()
      .from(members)
      .where(eq(members.projectId, input.projectId))
      .orderBy(members.id)
      .for('share');
  }
  const version = before.versions.find(
    (row) => row.id === input.inputSource!.originalVersionId,
  );
  if (version)
    await tx
      .select()
      .from(originals)
      .where(eq(originals.id, version.originalId))
      .for('update');
}
export async function loadRecordBatchSnapshot(
  tx: Transaction,
  input: StoredArrangeInput,
  metadata: BatchJobMetadata,
  at: string,
  batchRevision: number,
  generation: BatchSnapshot['generation'] = { kind: 'initial' },
): Promise<BatchSnapshot | null> {
  const native = requireNativeInput(input);
  if (input.supersededByInputId !== null) return null;
  const attribution = input.sourceContexts[0]!;
  if (
    input.originalInput.operation_id !== metadata.operationId ||
    input.originalInput.projectId !== input.projectId ||
    input.originalInput.personId !==
      (input.personIds.length === 1 ? input.personIds[0] : null) ||
    attribution.kind !== 'evaluation' ||
    attribution.requiredKinds.length !== 0 ||
    JSON.stringify([...attribution.attributedPersonIds].sort()) !==
      JSON.stringify([...input.personIds].sort())
  )
    throw new NativeArrangeUnavailable('native_intake_facts_inconsistent');
  await lockNativeTextFacts(tx, input);
  const actor = await loadArrangeActor(tx, input.creatorAccountId, at);
  if (
    actor.context.account.personId !== metadata.actorPersonId ||
    !canWriteArrange(
      actor,
      input.personIds,
      input.projectId,
      native.evaluationNodeId,
    )
  )
    return null;
  const data = await readEvidenceForTalent(tx); // Reload after graph locks and waits.
  const stored = input.sourceContexts[0]!;
  const fragment = data.fragments.find(
    (row) =>
      row.id === input.inputSource!.fragmentId &&
      row.originalVersionId === input.inputSource!.originalVersionId,
  );
  const version = data.versions.find(
    (row) => row.id === input.inputSource!.originalVersionId,
  );
  const original = data.originals.find((row) => row.id === version?.originalId);
  if (
    !fragment ||
    !version ||
    !original ||
    original.kind !== 'original' ||
    fragment.location.kind !== 'document' ||
    fragment.location.paragraph !== 'input' ||
    fragment.location.page !== undefined ||
    stored.fragmentId !== fragment.id ||
    stored.originalVersionId !== version.id ||
    version.contentDigest !==
      createHash('sha256').update(fragment.excerpt).digest('hex') ||
    fragment.excerpt.trim() !== input.originalInput.text.trim()
  )
    throw new NativeArrangeUnavailable('immutable_text_source_changed');
  // Consume the current846 projection instead of reviving its removed sourcesForDraft.
  const { rawTalentSourceGraph } = await import('./talent-source-projection');
  const graph = rawTalentSourceGraph({ ...actor, ...data }).find(
    (source) =>
      source.fragmentId === fragment.id &&
      source.originalVersionId === version.id,
  );
  const hasRelatedFacts =
    data.eventSources.some(
      (row) =>
        row.fragmentId === fragment.id && row.originalVersionId === version.id,
    ) ||
    data.historical.some(
      (row) =>
        row.fragmentId === fragment.id && row.originalVersionId === version.id,
    );
  if (!graph || (hasRelatedFacts && graph.subjects.length === 0))
    throw new NativeArrangeUnavailable('complete_source_graph_missing');
  const allSubjects = [
    ...new Map(
      [...stored.subjects, ...graph.subjects].map((subject) => [
        JSON.stringify(subject),
        subject,
      ]),
    ).values(),
  ];
  const requiredKinds = [
    ...new Set([
      ...stored.requiredKinds,
      ...(graph.requiredKinds ?? []),
      ...(graph.kind === stored.kind ? [] : [graph.kind]),
    ]),
  ];
  if (
    allSubjects.some(
      (subject) =>
        subject.evaluationNodeId == null ||
        [stored.kind, ...requiredKinds].some(
          (kind) =>
            !canReadTalent(actor.context, { ...subject, kind }, 'model-input'),
        ),
    )
  )
    return null;
  return {
    ...native,
    accountId: input.creatorAccountId,
    batchRevision,
    inputVersion: input.inputVersion,
    project:
      input.projectMode === 'resolved' && input.projectId
        ? { state: 'resolved', id: input.projectId }
        : input.projectMode === 'none'
          ? { state: 'none' }
          : { state: 'unresolved' },
    reviewItems: metadata.pending,
    resolvedItems: [],
    writeAllowed: true,
    identities: input.personIds.length ? 'resolved' : 'unresolved',
    personIds: [...input.personIds],
    context: actor.context,
    generation: structuredClone(generation),
    requestedSources: [
      {
        fragmentId: fragment.id,
        originalVersionId: version.id,
        location: fragment.location,
      },
    ],
    availableSources: [
      {
        reference: {
          fragmentId: fragment.id,
          originalVersionId: version.id,
          location: fragment.location,
        },
        text: fragment.excerpt,
        complete: allSubjects.length > 0,
        scope: 'resolved',
        category: 'original',
        subjects: allSubjects,
        attributedPersonIds: [...stored.attributedPersonIds],
        kind: stored.kind,
        requiredKinds,
        reviewItemIds: metadata.pending.map((item) => item.itemId),
        acquisition: { kind: 'text', version: version.id },
      },
    ],
  };
}
