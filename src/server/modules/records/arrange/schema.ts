import { z } from 'zod';
import { recordDraftSchema, recordEvidenceScoreSchema, recordSbiSchema, type RecordDraft } from '../../../../contracts/record';
import { sourceReadInputSchema } from '../../../../contracts/sources';
import { MAAS_MODEL, type MaasFailureKind } from '../../../integrations/maas';
import type { LoadTalentSnapshot } from '../../../authz/talent';

const text = z.string().min(1);
export const modelArrangementSchema = z.strictObject({
  sbi: recordSbiSchema,
  scores: z.array(z.discriminatedUnion('state', [
    recordEvidenceScoreSchema.extend({ state: z.literal('suggested'), personId: text, dimensionId: text, rationale: z.string().optional() }),
    z.strictObject({ state: z.literal('unknown'), personId: text, dimensionId: text, reason: text, rationale: z.string().optional() }),
  ])),
});
export type ModelArrangement = z.infer<typeof modelArrangementSchema>;
export type Selection = RecordDraft['project'];
export interface ArrangeSnapshot {
  draftId: string;
  creatorAccountId: string;
  inputVersion: string;
  originalInput: RecordDraft['originalInput'];
  origin: RecordDraft['origin'];
  people: RecordDraft['people'];
  project: Selection;
  /** Fully server-resolved privacy provenance, preferably using 837's shared projection. */
  authorization: Awaited<ReturnType<LoadTalentSnapshot>>;
  requestedSources: Array<{ fragmentId: string; originalVersionId: string; attributedPersonIds: string[] }>;
  inputSource: { fragmentId: string; originalVersionId: string } | null;
  ruleVersionId: string;
  dimensions: string[];
  anchors: Array<{ id: string; dimensionId: string; ruleVersionId: string; value: number; text: string }>;
}
export type LoadArrangeSnapshot = () => Promise<ArrangeSnapshot | null>;
const metadataSchema = z.strictObject({
  promptVersion: text,
  modelVersion: z.literal(MAAS_MODEL),
  inputVersion: text,
  ruleVersionId: text,
});
export const draftPersistenceSchema = metadataSchema.extend({
  id: text,
  creatorAccountId: text,
  draft: recordDraftSchema.omit({ revision: true }),
  sources: z.array(sourceReadInputSchema.extend({ subjects: z.array(z.strictObject({ personId: text, cohortId: text.nullable() })).min(1) })),
  evidence: z.array(z.strictObject({
    personId: text, dimensionId: text, fragmentId: text, originalVersionId: text,
    modelVersion: z.literal(MAAS_MODEL), rationale: z.string(), suggestedValue: z.number().int().min(1).max(5).nullable(),
  })),
});
export type DraftPersistence = z.infer<typeof draftPersistenceSchema>;
export type ArrangeFailure = { kind: MaasFailureKind; retryable: boolean };
export type ArrangeOutcome =
  | { status: 'arranged'; value: DraftPersistence }
  | { status: 'selection_required'; originalInput: RecordDraft['originalInput']; people: RecordDraft['people']; project: Selection }
  | { status: 'failed'; failure: ArrangeFailure }
  | { status: 'not_found' };
export const arrangeFailureSchema = z.strictObject({
  kind: z.enum(['configuration', 'invalid_request', 'authentication', 'permission', 'network', 'outcome_unknown', 'invalid_response', 'cancelled']),
  retryable: z.boolean(),
});
/** Internal persistence only. Public jobs always project this through recordDraftSchema. */
export const arrangeJobResultSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('draft'), draft: recordDraftSchema, fingerprint: text, inputVersion: text, promptVersion: text, modelVersion: z.literal(MAAS_MODEL), ruleVersionId: text }),
  z.strictObject({ state: z.literal('selection_required'), inputVersion: text }),
  z.strictObject({ state: z.literal('failure'), failure: arrangeFailureSchema, inputVersion: text, attemptsUsed: z.number().int().positive().max(2) }),
]);
