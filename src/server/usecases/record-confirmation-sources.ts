import { createHash } from 'node:crypto';
import type { TalentKind, TalentSource } from '../authz/talent';
import type { StoredArrangeInput } from '../modules/records';
import { sourceKey } from './source-key';
import { intakeRows, type IntakeTable } from './talent-source-projection';

const kinds = new Set<TalentKind>([
  'person',
  'evaluation',
  'restricted-evaluation',
  'confirmed-score',
  'quadrant',
  'management-observation',
  'change',
  'performance',
  'ai-inference',
]);
interface ConfirmationProvenance {
  sources: TalentSource[];
  linkedSourceKeys: ReadonlySet<string>;
  versions: { id: string; originalId: string; contentDigest: string }[];
  originals: { id: string; kind: string }[];
  /** The whole intake table as read by readIntakeTable, never a subset. */
  intake: IntakeTable;
}

/** Internal to talent-source-projection: callers use completeTalentSources.
 * Supplement the complete formal graph with immutable intake provenance.
 * No actor/AI draft/attribution list is an authority or a substitute subject.
 * Keep superseded intake restrictions: rebinding cannot erase shared facts.
 * The caller applies current source permissions to the resulting full union. */
export function confirmationSources(
  data: ConfirmationProvenance,
): TalentSource[] {
  const inputs: readonly StoredArrangeInput[] = intakeRows(data.intake);
  return data.sources.map((source) => {
    const key = sourceKey(source);
    const matches = inputs.filter(
      (input) =>
        (input.inputSource && sourceKey(input.inputSource) === key) ||
        input.sourceContexts.some((context) => sourceKey(context) === key),
    );
    if (!matches.length) return source;
    let complete =
      !data.linkedSourceKeys.has(key) || source.subjects.length > 0;
    const subjects = [...source.subjects];
    const required = new Set(source.requiredKinds ?? []);
    for (const input of matches) {
      const contexts = input.sourceContexts.filter(
        (context) => sourceKey(context) === key,
      );
      const version = data.versions.find(
        (row) => row.id === source.originalVersionId,
      );
      const original = data.originals.find(
        (row) => row.id === version?.originalId,
      );
      if (
        !input.batchId ||
        !input.evaluationNodeId ||
        !input.boundAt ||
        !input.occurredOn ||
        input.origin !== 'text' ||
        input.originalInput.attachmentIds.length !== 0 ||
        !input.inputSource ||
        sourceKey(input.inputSource) !== key ||
        contexts.length !== 1 ||
        source.location.kind !== 'document' ||
        source.location.paragraph !== 'input' ||
        source.location.page !== undefined ||
        original?.kind !== 'original' ||
        version?.contentDigest !==
          createHash('sha256').update(source.excerpt).digest('hex') ||
        // RecordInput canonicalizes surrounding whitespace; the digest above
        // still authenticates the exact, untrimmed original bytes.
        source.excerpt.trim() !== input.originalInput.text
      ) {
        complete = false;
        continue;
      }
      const context = contexts[0]!;
      if (
        !context.subjects.length ||
        !kinds.has(context.kind) ||
        context.requiredKinds.some((kind) => !kinds.has(kind)) ||
        context.subjects.some(
          (subject) => !subject.personId || !subject.evaluationNodeId,
        )
      ) {
        complete = false;
        continue;
      }
      subjects.push(...context.subjects);
      if (context.kind !== source.kind) required.add(context.kind);
      for (const kind of context.requiredKinds) required.add(kind);
    }
    return {
      ...source,
      subjects: complete
        ? [
            ...new Map(
              subjects.map((subject) => [
                JSON.stringify([
                  subject.personId,
                  subject.evaluationNodeId,
                  subject.cohortId,
                ]),
                subject,
              ]),
            ).values(),
          ]
        : [],
      requiredKinds: [...required],
    };
  });
}
