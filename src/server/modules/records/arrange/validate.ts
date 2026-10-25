import { isDeepStrictEqual } from 'node:util';
import {
  recordDraftSchema,
  type RecordDraft,
} from '../../../../contracts/record';
import type { PreparedArrange, ArrangeSource } from './prepare';
import { referenceKey } from './prepare';
import { RECORD_ARRANGE_PROMPT_VERSION } from './prompt';
import { MAAS_MODEL } from '../../../integrations/maas';
import {
  modelArrangementSchema,
  type ArrangeOutcome,
  type DraftPersistence,
  type ModelArrangement,
} from './schema';

type ModelScore = ModelArrangement['scores'][number];
type Citation = Extract<
  ModelScore,
  { state: 'suggested' }
>['citations'][number];
function citationSource(
  citation: Citation,
  personId: string,
  prepared: PreparedArrange,
): ArrangeSource | undefined {
  const { snapshot } = prepared;
  const source =
    citation.kind === 'source'
      ? prepared.sources.find(
          (source) =>
            referenceKey(source) === referenceKey(citation.reference) &&
            isDeepStrictEqual(source.location, citation.reference.location) &&
            source.excerpt.includes(citation.quote),
        )
      : snapshot.origin === 'text' &&
          snapshot.inputSource !== null &&
          snapshot.originalInput.text.slice(citation.start, citation.end) ===
            citation.quote &&
          citation.end <= snapshot.originalInput.text.length
        ? prepared.sources.find(
            (source) =>
              referenceKey(source) === referenceKey(snapshot.inputSource!) &&
              source.excerpt === snapshot.originalInput.text,
          )
        : undefined;
  return source?.attributedPersonIds.includes(personId) ? source : undefined;
}
export function validateArrangement(
  prepared: PreparedArrange,
  raw: unknown,
): ArrangeOutcome {
  const parsed = modelArrangementSchema.safeParse(raw);
  const failed = {
    status: 'failed',
    failure: { kind: 'invalid_response', retryable: false },
  } as const;
  if (!parsed.success) return failed;
  const { snapshot } = prepared;
  const selected = new Set(
    snapshot.people.flatMap((person) =>
      person.state === 'resolved' ? [person.id] : [],
    ),
  );
  const seen = new Set<string>();
  const scores: RecordDraft['scores'] = [];
  const evidence: DraftPersistence['evidence'] = [];
  for (const score of parsed.data.scores) {
    const key = JSON.stringify([score.personId, score.dimensionId]);
    if (
      !selected.has(score.personId) ||
      !snapshot.dimensions.includes(score.dimensionId) ||
      seen.has(key)
    )
      return failed;
    seen.add(key);
    if (score.state === 'unknown') {
      scores.push({
        state: 'unknown',
        personId: score.personId,
        dimensionId: score.dimensionId,
        reason: score.reason,
      });
      continue;
    }
    const citations = score.citations.map((citation) =>
      citationSource(citation, score.personId, prepared),
    );
    const validCitations = citations.every((source) => source !== undefined);
    const validAnchor =
      score.anchor.ruleVersion === snapshot.ruleVersionId &&
      snapshot.anchors.some(
        (anchor) =>
          anchor.id === score.anchor.id &&
          anchor.dimensionId === score.dimensionId &&
          anchor.ruleVersionId === snapshot.ruleVersionId &&
          anchor.value === score.value &&
          anchor.text === score.anchor.text,
      );
    if (validCitations && validAnchor) {
      scores.push({
        state: 'suggested',
        personId: score.personId,
        dimensionId: score.dimensionId,
        value: score.value,
        anchor: score.anchor,
        citations: score.citations,
      });
    } else {
      scores.push({
        state: 'unknown',
        personId: score.personId,
        dimensionId: score.dimensionId,
        reason: validCitations
          ? '锚点不属于当前生效规则'
          : '引用未通过来源或个人归属校验',
      });
    }
    // Unknown public scores have no citations in contract129. Do not create a
    // separate evidence row that the receiving writer cannot match to that DTO.
    const primary = validCitations && validAnchor ? citations[0] : undefined;
    if (primary)
      evidence.push({
        personId: score.personId,
        dimensionId: score.dimensionId,
        fragmentId: primary.fragmentId,
        originalVersionId: primary.originalVersionId,
        modelVersion: MAAS_MODEL,
        rationale: score.rationale ?? '',
        suggestedValue: score.value,
      });
  }
  const draft = {
    draftId: snapshot.draftId,
    origin: snapshot.origin,
    originalInput: snapshot.originalInput,
    sbi: parsed.data.sbi,
    people: snapshot.people,
    project: snapshot.project,
    scores,
  };
  // Check the public shape without replacing the immutable original input with
  // contract text transforms. The persistence adapter retains its original bytes.
  if (!recordDraftSchema.safeParse({ ...draft, revision: 1 }).success)
    return failed;
  return {
    status: 'arranged',
    value: {
      id: snapshot.draftId,
      creatorAccountId: snapshot.creatorAccountId,
      ruleVersionId: snapshot.ruleVersionId,
      promptVersion: RECORD_ARRANGE_PROMPT_VERSION,
      modelVersion: MAAS_MODEL,
      inputVersion: snapshot.inputVersion,
      draft,
      sources: prepared.sources.map((source) => ({
        fragmentId: source.fragmentId,
        originalVersionId: source.originalVersionId,
        subjects: source.subjects,
      })),
      evidence,
    },
  };
}
