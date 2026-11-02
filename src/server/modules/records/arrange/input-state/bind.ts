import { createHash } from 'node:crypto';
import type { RecordSelectionInput } from '../../../../../contracts/record';
import type { TalentSubject } from '../../../../authz/talent';
import type { StoredArrangeInput } from './schema';
function canonical(input: unknown): string {
  if (Array.isArray(input)) return '[' + input.map(canonical).join(',') + ']';
  if (input !== null && typeof input === 'object')
    return (
      '{' +
      Object.entries(input)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => JSON.stringify(key) + ':' + canonical(value))
        .join(',') +
      '}'
    );
  return JSON.stringify(input);
}
export function arrangeOperationFingerprint(input: unknown): string {
  return createHash('sha256').update(canonical(input)).digest('hex');
}
export function bindSelectedInput(
  previous: StoredArrangeInput,
  input: RecordSelectionInput,
  subjects: TalentSubject[],
  identity: Pick<
    StoredArrangeInput,
    'id' | 'jobId' | 'inputVersion' | 'createdAt'
  >,
): StoredArrangeInput {
  if (
    previous.id !== input.draftId ||
    previous.inputVersion !== input.expected_input_version ||
    previous.supersededByInputId !== null ||
    identity.id === previous.id ||
    identity.jobId === previous.jobId ||
    identity.inputVersion === previous.inputVersion
  )
    throw new Error('input changed');
  const next = structuredClone(previous);
  Object.assign(next, identity, {
    personIds: [...input.personIds],
    projectMode: input.projectId === null ? 'none' : 'resolved',
    projectId: input.projectId,
    projectCandidateIds: [],
    supersededByInputId: null,
  });
  if (previous.origin === 'text' && previous.inputSource) {
    next.sourceContexts = next.sourceContexts.map((context) => {
      if (
        context.fragmentId !== previous.inputSource!.fragmentId ||
        context.originalVersionId !== previous.inputSource!.originalVersionId
      )
        return context;
      const complete = new Map(
        [...context.subjects, ...subjects].map((s) => [
          JSON.stringify([s.personId, s.cohortId]),
          s,
        ]),
      );
      return {
        ...context,
        subjects: [...complete.values()],
        attributedPersonIds: [...input.personIds],
      };
    });
  }
  return next;
}
