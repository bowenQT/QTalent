import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { RecordBatchDraft } from '../../../../contracts/record';
import { effectiveRuleVersionSchema } from '../../../../contracts/selection-standard';
import {
  materialSourceReferenceSchema,
  type MaterialSourceReference,
} from '../../../../contracts/sources';
import {
  canReadNodeTalent,
  type EvaluationAuthzContext,
} from '../../../authz/evaluation-node';
import {
  canReadTalent,
  type TalentKind,
  type TalentSubject,
} from '../../../authz/talent';

export const batchText = z
  .string()
  .min(1)
  .refine((s) => s.trim().length > 0);
export const batchId = batchText.max(200);
export const batchQuoteSchema = z.strictObject({
  reference: materialSourceReferenceSchema,
  quote: batchText,
});
export type BatchQuote = z.infer<typeof batchQuoteSchema>;
export type BatchSource = {
  reference: MaterialSourceReference;
  text: string;
  /** Actual complete classification, not UI selection or a visible-person list. */
  complete: boolean;
  scope: 'resolved' | 'unresolved';
  category: 'original' | 'historical_evaluation' | 'submitted_code_snapshot';
  kind: TalentKind;
  requiredKinds: TalentKind[];
  subjects: TalentSubject[];
  attributedPersonIds: string[];
  acquisition:
    | { kind: 'text'; version: string }
    | { kind: 'parsed_attachment'; parseVersionId: string }
    | {
        kind: 'offline_transcript';
        recordingId: string;
        transcriptVersionId: string;
        bindingRevision: number;
        binding: 'resolved' | 'unresolved';
      };
};
export type BatchRuleBundle = {
  effective: z.infer<typeof effectiveRuleVersionSchema>;
  /** Authoritative content bound to the version read by category. */
  contentVersionId: string;
  dimensionVersionId: string;
  anchorVersionId: string;
  dimensions: string[];
  anchors: {
    id: string;
    dimensionId: string;
    versionId: string;
    value: number;
    text: string;
  }[];
};
export type BatchSnapshot = {
  batchId: string;
  accountId: string;
  evaluationNodeId: string;
  batchRevision: number;
  inputVersion: string;
  /** Server input save time; later publication must not rebind this generation. */
  boundAt: string;
  writeAllowed: boolean;
  identities: 'resolved' | 'unresolved';
  personIds: string[];
  context: EvaluationAuthzContext;
  requestedSources: MaterialSourceReference[];
  availableSources: BatchSource[];
  generation:
    | { kind: 'initial' }
    | {
        kind: 'revise';
        events: {
          eventKey: string;
          draftId: string;
          witnesses: BatchQuote[];
        }[];
      };
};
export type PreparedBatch = {
  snapshot: BatchSnapshot;
  rules: BatchRuleBundle;
  sources: BatchSource[];
  fingerprint: string;
};
export type BatchPreparation =
  | { status: 'ready'; value: PreparedBatch }
  | { status: 'not_found' }
  | {
      status: 'needs_review';
      reason: 'identity_unresolved' | 'scope_unresolved';
    }
  | {
      status: 'not_ready';
      reason: 'unsupported_material' | 'rules_unavailable' | 'invalid_input';
    };
export function batchDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function batchWitnessKey(q: BatchQuote) {
  return JSON.stringify([
    q.reference.fragmentId,
    q.reference.originalVersionId,
    materialSourceReferenceSchema.parse(q.reference).location,
    q.quote,
  ]);
}
export function batchReferenceKey(reference: MaterialSourceReference) {
  return JSON.stringify([reference.fragmentId, reference.originalVersionId]);
}
export function canonicalReferences(references: MaterialSourceReference[]) {
  const byKey = new Map(references.map((r) => [batchReferenceKey(r), r]));
  return [...byKey.values()].sort((a, b) =>
    batchReferenceKey(a).localeCompare(batchReferenceKey(b)),
  );
}
function uniqueIds(ids: string[], nonempty = true) {
  return (
    (!nonempty || ids.length > 0) &&
    ids.every((id) => batchId.safeParse(id).success) &&
    new Set(ids).size === ids.length
  );
}
export function prepareBatch(
  snapshot: BatchSnapshot,
  rules: BatchRuleBundle,
): BatchPreparation {
  const s = structuredClone(snapshot);
  if (
    !batchId.safeParse(s.batchId).success ||
    !batchId.safeParse(s.inputVersion).success ||
    !Number.isSafeInteger(s.batchRevision) ||
    s.batchRevision < 1 ||
    !z.iso.datetime().safeParse(s.boundAt).success ||
    !uniqueIds(s.personIds, false)
  )
    return { status: 'not_ready', reason: 'invalid_input' };
  if (
    s.accountId !== s.context.account.id ||
    !s.writeAllowed ||
    !s.context.evaluationNodes ||
    !s.context.evaluationNodeSubjects ||
    !s.context.evaluationRelations ||
    !s.personIds.every((personId) =>
      canReadNodeTalent(
        s.context,
        { evaluationNodeId: s.evaluationNodeId, personId, kind: 'evaluation' },
        'model-input',
      ),
    )
  )
    return { status: 'not_found' };
  if (!s.personIds.length || s.identities !== 'resolved')
    return { status: 'needs_review', reason: 'identity_unresolved' };
  s.personIds.sort();
  if (
    s.generation.kind === 'revise' &&
    (!uniqueIds(s.generation.events.map((e) => e.eventKey)) ||
      !uniqueIds(s.generation.events.map((e) => e.draftId)))
  )
    return { status: 'not_ready', reason: 'invalid_input' };
  const refs = s.requestedSources;
  if (
    !refs.length ||
    refs.length > 500 ||
    refs.some((r) => !materialSourceReferenceSchema.safeParse(r).success) ||
    new Set(refs.map(batchReferenceKey)).size !== refs.length
  )
    return { status: 'not_ready', reason: 'invalid_input' };
  const sources: BatchSource[] = [];
  for (const reference of refs) {
    const matches = s.availableSources.filter(
      (source) =>
        batchReferenceKey(source.reference) === batchReferenceKey(reference),
    );
    if (matches.length !== 1) return { status: 'not_found' };
    const source = matches[0];
    if (
      !isDeepStrictEqual(source.reference, reference) ||
      !batchText.safeParse(source.text).success ||
      !source.complete ||
      !source.subjects.length ||
      !uniqueIds(source.attributedPersonIds, false)
    )
      return { status: 'not_found' };
    if (
      !source.subjects.every(
        (subject) =>
          subject.evaluationNodeId != null &&
          [source.kind, ...source.requiredKinds].every((kind) =>
            canReadTalent(s.context, { ...subject, kind }, 'model-input'),
          ),
      ) ||
      source.attributedPersonIds.some(
        (personId) =>
          !source.subjects.some((subject) => subject.personId === personId),
      )
    )
      return { status: 'not_found' };
    if (!source.attributedPersonIds.length)
      return { status: 'needs_review', reason: 'identity_unresolved' };
    if (
      source.scope !== 'resolved' ||
      (source.acquisition.kind === 'offline_transcript' &&
        source.acquisition.binding !== 'resolved')
    )
      return { status: 'needs_review', reason: 'scope_unresolved' };
    if (
      source.category !== 'original' ||
      ['image', 'code', 'video'].includes(reference.location.kind)
    )
      return { status: 'not_ready', reason: 'unsupported_material' };
    const a = source.acquisition;
    if (
      (a.kind === 'text' && !batchId.safeParse(a.version).success) ||
      (a.kind === 'parsed_attachment' &&
        !batchId.safeParse(a.parseVersionId).success) ||
      (a.kind === 'offline_transcript' &&
        (!batchId.safeParse(a.recordingId).success ||
          !batchId.safeParse(a.transcriptVersionId).success ||
          !Number.isSafeInteger(a.bindingRevision) ||
          a.bindingRevision < 1 ||
          reference.location.kind !== 'recording'))
    )
      return { status: 'not_ready', reason: 'invalid_input' };
    if (
      (a.kind === 'text' && reference.location.kind !== 'document') ||
      (a.kind === 'parsed_attachment' &&
        !['document', 'pdf', 'presentation', 'spreadsheet'].includes(
          reference.location.kind,
        ))
    )
      return { status: 'not_ready', reason: 'invalid_input' };
    if (
      reference.location.kind === 'recording' &&
      a.kind !== 'offline_transcript'
    )
      return { status: 'not_ready', reason: 'invalid_input' };
    sources.push({
      ...source,
      reference: materialSourceReferenceSchema.parse(source.reference),
      subjects: source.subjects
        .map((subject) => ({
          personId: subject.personId,
          cohortId: subject.cohortId,
          evaluationNodeId: subject.evaluationNodeId,
        }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      attributedPersonIds: [...source.attributedPersonIds].sort(),
      requiredKinds: [...source.requiredKinds].sort(),
    });
  }
  if (
    sources.reduce(
      (sum, source) => sum + Buffer.byteLength(source.text, 'utf8'),
      0,
    ) > 262144
  )
    return { status: 'not_ready', reason: 'invalid_input' };
  if (s.generation.kind === 'revise') {
    const events = s.generation.events;
    if (
      events.some(
        (event) =>
          !event.witnesses.length ||
          event.witnesses.some(
            (q) =>
              !batchQuoteSchema.safeParse(q).success ||
              !sources.some(
                (source) =>
                  isDeepStrictEqual(source.reference, q.reference) &&
                  source.text.includes(q.quote),
              ),
          ),
      )
    )
      return { status: 'not_ready', reason: 'invalid_input' };
    for (const event of events) {
      const others = new Set(
        events
          .filter((e) => e.eventKey !== event.eventKey)
          .flatMap((e) => e.witnesses.map(batchWitnessKey)),
      );
      if (!event.witnesses.some((q) => !others.has(batchWitnessKey(q))))
        return { status: 'not_ready', reason: 'invalid_input' };
      event.witnesses.sort((a, b) =>
        batchWitnessKey(a).localeCompare(batchWitnessKey(b)),
      );
    }
    events.sort((a, b) => a.eventKey.localeCompare(b.eventKey));
  }
  const v = effectiveRuleVersionSchema.safeParse(rules.effective);
  const at = Date.parse(s.boundAt);
  if (
    !v.success ||
    v.data.category !== 'dimension_anchors' ||
    v.data.versionId !== rules.contentVersionId ||
    Date.parse(v.data.effectiveFrom) > at ||
    (v.data.effectiveUntil !== null &&
      at >= Date.parse(v.data.effectiveUntil)) ||
    !batchId.safeParse(rules.dimensionVersionId).success ||
    !batchId.safeParse(rules.anchorVersionId).success ||
    !uniqueIds(rules.dimensions) ||
    !rules.anchors.length ||
    new Set(rules.anchors.map((a) => a.id)).size !== rules.anchors.length ||
    rules.anchors.some(
      (a) =>
        !batchId.safeParse(a.id).success ||
        a.versionId !== rules.anchorVersionId ||
        !rules.dimensions.includes(a.dimensionId) ||
        !Number.isInteger(a.value) ||
        a.value < 1 ||
        a.value > 5 ||
        !batchText.safeParse(a.text).success,
    )
  )
    return { status: 'not_ready', reason: 'rules_unavailable' };
  sources.sort((a, b) =>
    batchReferenceKey(a.reference).localeCompare(
      batchReferenceKey(b.reference),
    ),
  );
  const rulesCopy = structuredClone(rules);
  return {
    status: 'ready',
    value: {
      snapshot: s,
      rules: rulesCopy,
      sources,
      fingerprint: batchDigest({
        batchId: s.batchId,
        accountId: s.accountId,
        node: s.evaluationNodeId,
        inputVersion: s.inputVersion,
        boundAt: s.boundAt,
        personIds: s.personIds,
        generation: s.generation,
        sources,
        rules: {
          category: rulesCopy.effective.category,
          effectiveVersionId: rulesCopy.effective.versionId,
          contentVersionId: rulesCopy.contentVersionId,
          dimensionVersionId: rulesCopy.dimensionVersionId,
          anchorVersionId: rulesCopy.anchorVersionId,
          dimensions: [...rulesCopy.dimensions].sort(),
          anchors: [...rulesCopy.anchors].sort((a, b) =>
            a.id.localeCompare(b.id),
          ),
        },
      }),
    },
  };
}
export type BatchDraftIdentity = {
  eventKey: string;
  draftId: string;
  previous: RecordBatchDraft | null;
};
export type BatchIdentityLedger = {
  expectedBatchRevision: number;
  drafts: BatchDraftIdentity[];
  candidates: { key: string; candidateId: string }[];
};
