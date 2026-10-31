import type { EvaluationAuthzContext } from '../../../authz/evaluation-node';
import { canReadObservation, canReadObservationSource } from './policy';
import {
  referenceKey,
  type ManagementObservation,
  type ObservationSource,
  type VisibleObservation,
} from './model';

export function projectManagementObservation(
  context: EvaluationAuthzContext,
  row: ManagementObservation,
  sourceFacts: ObservationSource[],
): VisibleObservation | null {
  if (!canReadObservation(context, row)) return null;
  const sources: VisibleObservation['sources'] = [];
  for (const reference of row.sources) {
    const matches = sourceFacts.filter(
      (source) => referenceKey(source) === referenceKey(reference),
    );
    if (
      matches.length !== 1 ||
      !matches[0].subjects.some(
        (subject) =>
          subject.personId === row.personId &&
          subject.evaluationNodeId === row.evaluationNodeId,
      ) ||
      !canReadObservationSource(context, matches[0])
    )
      return null;
    const { fragmentId, originalVersionId, location } = matches[0];
    sources.push({
      fragmentId,
      originalVersionId,
      location: structuredClone(location),
    });
  }
  return structuredClone({
    id: row.id,
    evaluationNodeId: row.evaluationNodeId,
    personId: row.personId,
    text: row.text,
    origin: row.origin,
    kind: row.kind,
    nature: row.nature,
    author: row.author,
    authorUnconfirmed: row.authorUnconfirmed,
    importedBy: row.importedBy,
    recordedAt: row.recordedAt,
    occurredAt: row.occurredAt,
    sources,
  });
}
