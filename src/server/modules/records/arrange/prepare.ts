import { createHash } from 'node:crypto';
import { canReadProject } from '../../../authz';
import {
  buildAuthorizedModelInput,
  canReadTalent,
  type TalentSubject,
  type VisibleTalentSource,
} from '../../../authz/talent';
import type { ArrangeOutcome, ArrangeSnapshot, Selection } from './schema';

export interface ArrangeSource extends VisibleTalentSource {
  subjects: TalentSubject[];
  /** Verified behavior attribution, distinct from privacy provenance. */
  attributedPersonIds: string[];
}
export interface PreparedArrange {
  status: 'ready';
  snapshot: ArrangeSnapshot;
  sources: ArrangeSource[];
  fingerprint: string;
}
export function referenceKey(reference: {
  fragmentId: string;
  originalVersionId: string;
}): string {
  return JSON.stringify([reference.fragmentId, reference.originalVersionId]);
}
export async function prepareArrange(
  source: ArrangeSnapshot,
): Promise<
  | PreparedArrange
  | Extract<ArrangeOutcome, { status: 'not_found' | 'selection_required' }>
> {
  const snapshot = structuredClone(source);
  const context = snapshot.authorization.context;
  const readablePerson = (id: string) =>
    canReadTalent(
      context,
      { personId: id, cohortId: null, kind: 'evaluation' },
      'model-input',
    );
  const people: Selection[] = snapshot.people.map((selection) =>
    selection.state === 'needs_selection'
      ? {
          ...selection,
          candidates: selection.candidates.filter((person) =>
            readablePerson(person.id),
          ),
        }
      : selection,
  );
  if (
    people.some(
      (selection) =>
        selection.state === 'resolved' && !readablePerson(selection.id),
    )
  )
    return { status: 'not_found' };
  const readableProject = (id: string) => {
    const project = context.projects.find((project) => project.id === id);
    return project !== undefined && canReadProject(context, project);
  };
  const project: Selection =
    snapshot.project.state === 'needs_selection'
      ? {
          ...snapshot.project,
          candidates: snapshot.project.candidates.filter((candidate) =>
            readableProject(candidate.id),
          ),
        }
      : snapshot.project;
  if (project.state === 'resolved' && !readableProject(project.id))
    return { status: 'not_found' };
  snapshot.people = people;
  snapshot.project = project;
  if (
    people.length === 0 ||
    people.some((selection) => selection.state !== 'resolved')
  ) {
    return {
      status: 'selection_required',
      originalInput: snapshot.originalInput,
      people,
      project,
    };
  }
  const projected = await buildAuthorizedModelInput(
    async () => snapshot.authorization,
  );
  const visibleSources = new Map(
    projected.items
      .flatMap((item) => item.sources)
      .map((source) => [referenceKey(source), source]),
  );
  const requestedKeys = snapshot.requestedSources.map(referenceKey);
  if (
    requestedKeys.length === 0 ||
    new Set(requestedKeys).size !== requestedKeys.length
  )
    return { status: 'not_found' };
  const sources: ArrangeSource[] = [];
  for (const request of snapshot.requestedSources) {
    const key = referenceKey(request);
    const visible = visibleSources.get(key);
    const original = snapshot.authorization.sources.find(
      (source) => referenceKey(source) === key,
    );
    if (!visible || !original) return { status: 'not_found' };
    if (
      request.attributedPersonIds.some(
        (id) => !original.subjects.some((subject) => subject.personId === id),
      )
    )
      return { status: 'not_found' };
    sources.push({
      ...visible,
      subjects: original.subjects,
      attributedPersonIds: request.attributedPersonIds,
    });
  }
  // Includes exact evidence, complete subjects and attribution so changes during a
  // model call invalidate the result. Unrelated directory/profile fields do not.
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        draftId: snapshot.draftId,
        creatorAccountId: snapshot.creatorAccountId,
        inputVersion: snapshot.inputVersion,
        originalInput: snapshot.originalInput,
        origin: snapshot.origin,
        people,
        project,
        inputSource: snapshot.inputSource,
        ruleVersionId: snapshot.ruleVersionId,
        dimensions: snapshot.dimensions,
        anchors: snapshot.anchors,
        sources,
      }),
    )
    .digest('hex');
  return { status: 'ready', snapshot, sources, fingerprint };
}
