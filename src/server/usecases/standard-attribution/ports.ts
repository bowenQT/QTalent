import type { z } from 'zod';
import type {
  comparisonActorSchema,
  ComparisonCase,
  ComparisonMapping,
} from '../../../contracts/judgment-comparison';
import type {
  ConfirmedStandardAttribution,
  StandardAttributionHypothesis,
} from '../../../contracts/standard-attribution';
import type {
  effectiveRuleVersionSchema,
  selectionStandardContentSchema,
  selectionAiDraftSchema,
} from '../../../contracts/selection-standard';
import type { StructuredMaasInput } from '../../integrations/maas';

/** Only a current server-side HR/project/node policy may construct this snapshot.
 * authorizedCaseIds means BOTH stages are currently disclosable, not merely a
 * past front-stage participation. Candidates are filtered before model input.
 */
export interface HrAttributionBatch {
  accountId: string;
  actor: z.infer<typeof comparisonActorSchema>;
  batchId: string;
  mapping: ComparisonMapping;
  authorizedCaseIds: readonly string[];
  candidates: readonly ComparisonCase[];
}
export interface AttributionDraftContext {
  batch: HrAttributionBatch;
  attribution: ConfirmedStandardAttribution;
  standard: {
    version: z.infer<typeof effectiveRuleVersionSchema>;
    content: z.infer<typeof selectionStandardContentSchema>;
  };
}
/** An AI proposal awaiting 918 integration; never a published revision or HR edit. */
export interface SelectionDraftProposal {
  id: string;
  attributionId: string;
  baseVersionId: string;
  aiDraft: z.infer<typeof selectionAiDraftSchema>;
  humanVersion: null;
}
export type AttributionOperation = {
  fingerprint: string;
  evidenceFingerprint: string;
  reservationId: string;
} & (
  | { state: 'pending' }
  | { state: 'finished'; result: unknown; modelRequestId?: string }
);
export interface AttributionPorts<Tx> {
  /** Native transaction, actor+operation lock, Read Committed and fresh reads.
   * Artifact, audit and receipt writes must all roll back together. No default
   * production adapter is supplied by this early implementation.
   */
  transaction<T>(
    accountId: string,
    operationId: string,
    work: (tx: Tx) => Promise<T>,
  ): Promise<T>;
  loadHrBatch(
    tx: Tx,
    accountId: string,
    batchId: string,
    at: string,
  ): Promise<HrAttributionBatch | null>;
  /** Resolve attribution -> batch -> current HR scope BEFORE private reads. */
  loadDraftContext(
    tx: Tx,
    accountId: string,
    attributionId: string,
    baseVersionId: string,
    at: string,
  ): Promise<AttributionDraftContext | null>;
  readHypothesis(
    tx: Tx,
    batchId: string,
    hypothesisId: string,
  ): Promise<StandardAttributionHypothesis | null>;
  readOperation(
    tx: Tx,
    accountId: string,
    operationId: string,
  ): Promise<AttributionOperation | null>;
  writeOperation(
    tx: Tx,
    accountId: string,
    operationId: string,
    operation: AttributionOperation,
  ): Promise<void>;
  saveHypotheses(
    tx: Tx,
    hypotheses: StandardAttributionHypothesis[],
  ): Promise<void>;
  saveAttribution(
    tx: Tx,
    attribution: ConfirmedStandardAttribution,
  ): Promise<void>;
  saveProposal(tx: Tx, proposal: SelectionDraftProposal): Promise<void>;
  audit(
    tx: Tx,
    event: {
      accountId: string;
      action: 'hypotheses' | 'confirm' | 'draft';
      batchId: string;
      operationId: string;
      at: string;
    },
  ): Promise<void>;
}
/** The subset consumed from 843's public structured client; no transport copy.
 * Composition supplies MODELINK_MODEL from the verified Gemini client.
 */
export interface AttributionModel {
  expectedModel: string;
  client: {
    generateStructured<T extends Record<string, unknown>>(
      input: StructuredMaasInput<T>,
    ): Promise<
      | {
          ok: true;
          value: T;
          metadata: {
            model: string;
            promptVersion: string;
            requestId?: string;
          };
        }
      | {
          ok: false;
          metadata: {
            model: string;
            promptVersion: string;
            requestId?: string;
          };
        }
    >;
  };
}
