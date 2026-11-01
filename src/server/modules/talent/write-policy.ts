import type { MaterialSourceReference } from '../../../contracts/sources';
import type { TalentSource } from '../../authz/talent';
import {
  ConfirmationError,
  confirmationSemanticKey,
  type ConfirmationSourceFact,
} from './record-confirmation';

/** Convert the shared complete provenance graph into immutable source facts.
 * This never grants access or supplies missing upload/speaker bindings. */
export function resolveRecordSourceFacts(
  references: MaterialSourceReference[],
  data: {
    fragments: {
      id: string;
      originalVersionId: string;
      location: unknown;
      excerpt: string;
    }[];
    versions: { id: string; originalId: string }[];
    originals: { id: string; kind: string }[];
    sources: TalentSource[];
  },
): ConfirmationSourceFact[] {
  return references.map((reference) => {
    if (!['document', 'spreadsheet'].includes(reference.location.kind))
      throw new ConfirmationError(
        'unavailable',
        reference.location.kind === 'recording'
          ? 'speaker_binding_not_connected'
          : 'material_reader_not_connected',
      );
    const fragment = data.fragments.find(
      (row) =>
        row.id === reference.fragmentId &&
        row.originalVersionId === reference.originalVersionId,
    );
    const version = data.versions.find(
      (row) => row.id === reference.originalVersionId,
    );
    const original = data.originals.find(
      (row) => row.id === version?.originalId,
    );
    const source = data.sources.find(
      (row) =>
        row.fragmentId === reference.fragmentId &&
        row.originalVersionId === reference.originalVersionId,
    );
    if (
      !fragment ||
      !version ||
      !original ||
      !source ||
      !fragment.excerpt.trim()
    )
      throw new ConfirmationError('unavailable', 'immutable_source_missing');
    if (original.kind !== 'original')
      throw new ConfirmationError(
        'forbidden',
        'baseline_source_not_confirmable',
      );
    if (
      confirmationSemanticKey(fragment.location) !==
      confirmationSemanticKey(reference.location)
    )
      throw new ConfirmationError('conflict', 'source_locator_changed');
    const complete =
      source.subjects.length > 0 &&
      source.subjects.every((subject) => subject.evaluationNodeId != null);
    return {
      reference,
      complete,
      excerpt: fragment.excerpt,
      subjects: complete
        ? source.subjects.map((subject) => ({
            evaluationNodeId: subject.evaluationNodeId!,
            personId: subject.personId,
          }))
        : [],
      kind: source.kind,
      requiredKinds: source.requiredKinds ?? [],
    };
  });
}
