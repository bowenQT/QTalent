import { isDeepStrictEqual } from 'node:util';
import {
  recordBatchDraftSchema,
  recordBatchDraftSetSchema,
  type RecordBatchDraft,
  type RecordBatchDraftSet,
} from '../../../../contracts/record';
import {
  batchDigest,
  batchId,
  batchReferenceKey,
  batchWitnessKey,
  canonicalReferences,
  type BatchIdentityLedger,
  type BatchQuote,
  type PreparedBatch,
} from './batch';
import { modelBatchSchema, type ModelBatch } from './batch-prompt';
export type ValidatedBatch = {
  events: ModelBatch['events'];
  groups: { key: string; eventKeys: string[]; reason: string }[];
};
export class BatchValidationError extends Error {
  constructor(readonly code: 'invalid_response' | 'invalid_ledger') {
    super(code);
    this.name = 'BatchValidationError';
  }
}
function validQuote(p: PreparedBatch, citation: BatchQuote, personId?: string) {
  const source = p.sources.find(
    (s) =>
      batchReferenceKey(s.reference) === batchReferenceKey(citation.reference),
  );
  return (
    source !== undefined &&
    isDeepStrictEqual(source.reference, citation.reference) &&
    source.text.includes(citation.quote) &&
    (personId === undefined || source.attributedPersonIds.includes(personId))
  );
}
export function validateBatchModel(
  prepared: PreparedBatch,
  raw: unknown,
): ValidatedBatch {
  const parsed = modelBatchSchema.safeParse(raw);
  if (!parsed.success) throw new BatchValidationError('invalid_response');
  const { events, similarGroups } = parsed.data;
  const keys = new Set(events.map((e) => e.eventKey));
  const generation = prepared.snapshot.generation;
  if (
    keys.size !== events.length ||
    (generation.kind === 'revise' &&
      (keys.size !== generation.events.length ||
        generation.events.some((e) => !keys.has(e.eventKey))))
  )
    throw new BatchValidationError('invalid_response');
  for (const event of events) {
    let foreignWitnesses = new Set<string>();
    if (generation.kind === 'revise') {
      const manifest = generation.events.find(
        (e) => e.eventKey === event.eventKey,
      )!;
      const own = new Set(manifest.witnesses.map(batchWitnessKey));
      const foreign = new Set(
        generation.events
          .filter((e) => e.eventKey !== event.eventKey)
          .flatMap((e) => e.witnesses.map(batchWitnessKey))
          .filter((key) => !own.has(key)),
      );
      foreignWitnesses = foreign;
      const proposed = new Set(event.evidence.map(batchWitnessKey));
      if (
        [...own].some((key) => !proposed.has(key)) ||
        [...proposed].some((key) => foreign.has(key))
      )
        throw new BatchValidationError('invalid_response');
    }
    if (
      event.personIds.some(
        (personId) =>
          !prepared.snapshot.personIds.includes(personId) ||
          !event.evidence.some((q) => validQuote(prepared, q, personId)),
      ) ||
      event.evidence.some((q) => !validQuote(prepared, q))
    )
      throw new BatchValidationError('invalid_response');
    const scoreKeys = new Set<string>();
    event.scores = event.scores.map((score) => {
      const key = JSON.stringify([score.personId, score.dimensionId]);
      if (
        !event.personIds.includes(score.personId) ||
        !prepared.rules.dimensions.includes(score.dimensionId) ||
        scoreKeys.has(key)
      )
        throw new BatchValidationError('invalid_response');
      scoreKeys.add(key);
      if (score.state === 'unknown') return score;
      const citationValid = score.citations.every(
        (q) =>
          validQuote(prepared, q, score.personId) &&
          !foreignWitnesses.has(batchWitnessKey(q)) &&
          event.evidence.some(
            (evidence) =>
              isDeepStrictEqual(evidence.reference, q.reference) &&
              evidence.quote.includes(q.quote),
          ),
      );
      const anchorValid =
        score.anchor.ruleVersion === prepared.rules.anchorVersionId &&
        prepared.rules.anchors.some(
          (a) =>
            a.id === score.anchor.id &&
            a.dimensionId === score.dimensionId &&
            a.versionId === score.anchor.ruleVersion &&
            a.value === score.value &&
            a.text === score.anchor.text,
        );
      return citationValid && anchorValid
        ? score
        : {
            state: 'unknown' as const,
            personId: score.personId,
            dimensionId: score.dimensionId,
            reason: citationValid
              ? '锚点未通过冻结版本校验'
              : '引用未通过原文或个人归属校验',
          };
    });
    event.personIds.sort();
    event.evidence = [
      ...new Map(event.evidence.map((q) => [batchWitnessKey(q), q])).values(),
    ].sort((a, b) => batchWitnessKey(a).localeCompare(batchWitnessKey(b)));
    event.scores.sort((a, b) =>
      JSON.stringify([a.personId, a.dimensionId]).localeCompare(
        JSON.stringify([b.personId, b.dimensionId]),
      ),
    );
    for (const score of event.scores)
      if (score.state === 'suggested')
        score.citations = [
          ...new Map(
            score.citations.map((q) => [batchWitnessKey(q), q]),
          ).values(),
        ].sort((a, b) => batchWitnessKey(a).localeCompare(batchWitnessKey(b)));
  }
  const exact = new Map<string, string[]>();
  for (const event of events) {
    const key = batchDigest({
      people: [...event.personIds].sort(),
      evidence: [...new Set(event.evidence.map(batchWitnessKey))].sort(),
    });
    exact.set(key, [...(exact.get(key) ?? []), event.eventKey]);
  }
  for (const eventKeys of exact.values())
    if (eventKeys.length > 1)
      similarGroups.push({
        eventKeys,
        reason: '同一批次的事件建议使用相同人员与事件依据，请确认是否同一件事',
      });
  // Union overlapping hints; each draft appears in at most one pending choice.
  const components: { keys: Set<string>; reasons: string[] }[] = [];
  for (const group of similarGroups) {
    if (group.eventKeys.some((key) => !keys.has(key)))
      throw new BatchValidationError('invalid_response');
    const overlap = components.filter((c) =>
      group.eventKeys.some((key) => c.keys.has(key)),
    );
    const merged = { keys: new Set(group.eventKeys), reasons: [group.reason] };
    for (const c of overlap) {
      for (const key of c.keys) merged.keys.add(key);
      merged.reasons.push(...c.reasons);
      components.splice(components.indexOf(c), 1);
    }
    components.push(merged);
  }
  return {
    events,
    groups: components
      .map((c) => {
        const eventKeys = [...c.keys].sort();
        return {
          key: batchDigest(eventKeys),
          eventKeys,
          reason: [...new Set(c.reasons)].sort().join('；'),
        };
      })
      .sort((a, b) => a.key.localeCompare(b.key)),
  };
}
function draftBody(draft: RecordBatchDraft) {
  const { revision: _revision, ...body } = draft;
  void _revision;
  return body;
}
export function materializeBatch(
  prepared: PreparedBatch,
  plan: ValidatedBatch,
  ledger: BatchIdentityLedger,
): RecordBatchDraftSet {
  const invalid = (): never => {
    throw new BatchValidationError('invalid_ledger');
  };
  if (
    ledger.expectedBatchRevision !== prepared.snapshot.batchRevision ||
    ledger.drafts.length !== plan.events.length ||
    ledger.candidates.length !== plan.groups.length ||
    new Set(ledger.drafts.map((d) => d.eventKey)).size !== plan.events.length ||
    new Set(ledger.drafts.map((d) => d.draftId)).size !== plan.events.length ||
    new Set(ledger.candidates.map((c) => c.key)).size !== plan.groups.length ||
    new Set(ledger.candidates.map((c) => c.candidateId)).size !==
      plan.groups.length
  )
    invalid();
  const drafts = plan.events.map((event): RecordBatchDraft => {
    const slot = ledger.drafts.find((d) => d.eventKey === event.eventKey);
    if (!slot || !batchId.safeParse(slot.draftId).success) return invalid();
    const previous = slot.previous;
    if (
      prepared.snapshot.generation.kind === 'revise' &&
      prepared.snapshot.generation.events.find(
        (e) => e.eventKey === event.eventKey,
      )?.draftId !== slot.draftId
    )
      return invalid();
    if (
      prepared.snapshot.generation.kind === 'revise' &&
      previous &&
      prepared.snapshot.generation.events
        .find((e) => e.eventKey === event.eventKey)!
        .witnesses.some(
          (q) =>
            !previous.sourceReferences.some((r) =>
              isDeepStrictEqual(r, q.reference),
            ),
        )
    )
      return invalid();
    if (
      (prepared.snapshot.generation.kind === 'revise' && previous === null) ||
      (previous !== null &&
        (!recordBatchDraftSchema.safeParse(previous).success ||
          previous.batchId !== prepared.snapshot.batchId ||
          previous.evaluationNodeId !== prepared.snapshot.evaluationNodeId ||
          previous.draftId !== slot.draftId))
    )
      return invalid();
    const next: RecordBatchDraft = {
      batchId: prepared.snapshot.batchId,
      evaluationNodeId: prepared.snapshot.evaluationNodeId,
      draftId: slot.draftId,
      revision: 1,
      origin: 'ai_suggestion',
      personIds: [...event.personIds].sort(),
      sourceReferences: canonicalReferences(
        event.evidence.map((q) => q.reference),
      ),
      dimensionVersionId: prepared.rules.dimensionVersionId,
      anchorVersionId: prepared.rules.anchorVersionId,
      sbi: event.sbi,
      scores: event.scores.map((s) =>
        s.state === 'unknown'
          ? s
          : {
              ...s,
              citations: s.citations.map((q) => ({
                ...q,
                kind: 'source' as const,
              })),
            },
      ),
    };
    next.scores.sort((a, b) =>
      JSON.stringify([a.personId, a.dimensionId]).localeCompare(
        JSON.stringify([b.personId, b.dimensionId]),
      ),
    );
    for (const score of next.scores)
      if (score.state === 'suggested')
        score.citations.sort((a, b) =>
          JSON.stringify(a).localeCompare(JSON.stringify(b)),
        );
    if (previous)
      next.revision =
        previous.revision +
        (isDeepStrictEqual(draftBody(previous), draftBody(next)) ? 0 : 1);
    // Do not adopt DTO text transforms: references retain exact source bytes.
    if (!recordBatchDraftSchema.safeParse(next).success) return invalid();
    return next;
  });
  const result: RecordBatchDraftSet = {
    batchId: prepared.snapshot.batchId,
    revision: prepared.snapshot.batchRevision + 1,
    drafts,
    duplicateCandidates: plan.groups.map((group) => {
      const slot = ledger.candidates.find((c) => c.key === group.key);
      if (!slot || !batchId.safeParse(slot.candidateId).success)
        return invalid();
      return {
        candidateId: slot.candidateId,
        draftIds: group.eventKeys.map(
          (key) => ledger.drafts.find((d) => d.eventKey === key)!.draftId,
        ),
        reason: group.reason,
      };
    }),
  };
  if (!recordBatchDraftSetSchema.safeParse(result).success) invalid();
  return result;
}
