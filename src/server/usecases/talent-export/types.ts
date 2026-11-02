import { z } from 'zod';
import type { TalentSourceProjectionData } from '../talent-source-projection';
import type { EvaluationAuthzContext } from '../../authz/evaluation-node';
import type { readDirectory } from '../../modules/directory';
import type {
  readTalentEvaluationRules,
  ruleVersions,
} from '../../modules/evaluation-system';
import type {
  confirmations,
  scoreReviews,
  aiSuggestions,
} from '../../modules/talent';
import type { cohorts, evaluationNodes } from '../../modules/programs';
import type { VisibleTalentSource } from '../../authz/talent';

export const exportRequestSchema = z.strictObject({
  scopeId: z.string().min(1).max(240).regex(/\S/),
  range: z.enum(['all', 'last12Months', 'last3Months']),
});
export type ExportRequest = z.infer<typeof exportRequestSchema>;
export type ExportRange = ExportRequest['range'];
export const personExportRequestSchema = z.strictObject({
  personId: z.string().min(1).max(240).regex(/\S/),
});
export type PersonExportRequest = z.infer<typeof personExportRequestSchema>;
/** Verified content only. This is deliberately not a complete print sheet. */
export type ConfirmedPersonExport = {
  person: { id: string; name: string; organization: string; demo: boolean };
  projection: ExportProjection;
};
export type PreparedPersonExport = ConfirmedPersonExport & {
  preparedAt: string;
  unavailableSections: readonly [
    'adopted_summary',
    'formal_position',
    'job_level_tenure',
    'complete_hidden_content_hint',
  ];
};
/** Native provenance is required, including explicit null for known legacy rows.
 * Missing fields are unavailable facts, never defaults for unmerged schema.
 */
export type ExportReview = typeof scoreReviews.$inferSelect & {
  saveId: string | null;
  confirmationId: string | null;
  counterpartConfirmationId: string | null;
  withdrawnAt: Date | null;
};
export type ExportSnapshot = Omit<
  TalentSourceProjectionData,
  'context' | 'events'
> &
  Awaited<ReturnType<typeof readTalentEvaluationRules>> & {
    context: EvaluationAuthzContext;
    directory: NonNullable<Awaited<ReturnType<typeof readDirectory>>>;
    events: (TalentSourceProjectionData['events'][number] & {
      withdrawnAt: Date | null;
    })[];
    confirmations: (typeof confirmations.$inferSelect)[];
    reviews: ExportReview[];
    suggestions: (typeof aiSuggestions.$inferSelect)[];
    cohorts: (typeof cohorts.$inferSelect)[];
    nodes: (typeof evaluationNodes.$inferSelect)[];
    ruleVersions: (typeof ruleVersions.$inferSelect)[];
  };
export type ExportPreview = { people: number; rows: number; skipped: number };
export type ExportScope = {
  id: string;
  label: string;
  people: number;
  previews: Record<ExportRange, ExportPreview>;
};
export type ExportView = { scopes: ExportScope[] };
export type ExportSource = VisibleTalentSource & { originalTitle: string };
export type ExportRow = {
  confirmationId: string;
  personId: string;
  personName: string;
  organization: string;
  eventId: string;
  eventDate: string;
  title: string;
  situation: string;
  behavior: string;
  impact: string;
  dimensionId: string;
  dimension: string;
  value: number;
  anchor: string;
  quote: string;
  evaluatorId: string;
  evaluatorName: string;
  ruleVersionId: string;
  confirmedAt: string | null;
  sourceCategory: 'original' | 'prototype_baseline';
  demo: boolean;
  /** Always preserve every authorized source of the event. */
  sources: ExportSource[];
  exactSource: ExportSource | null;
};
export type ExportProjection = ExportPreview & {
  scopeId: string;
  scopeLabel: string;
  range: ExportRange;
  asOf: string;
  actorName: string;
  data: ExportRow[];
};
export type ExportOutcome =
  | {
      status: 'done';
      people: number;
      rows: number;
      at: string;
      href: string;
      fileName: string;
    }
  | { status: 'denied' }
  | { status: 'empty' }
  | { status: 'failed'; reason: string };
export type ExportArtifact = {
  projection: ExportProjection;
  csv: string;
  at: string;
  fileName: string;
};
export type ExportPhase = 'preview' | 'generate' | 'download' | 'print';
export interface ExportStore<C> {
  transaction<T>(work: (tx: C) => Promise<T>): Promise<T>;
  readSnapshot(tx: C, accountId: string, now: string): Promise<ExportSnapshot>;
  audit(
    tx: C,
    input: {
      accountId: string;
      phase: ExportPhase;
      outcome: 'success' | 'empty' | 'denied' | 'failed';
      request: ExportRequest | PersonExportRequest | null;
    },
  ): Promise<void>;
}
export class TalentExportError extends Error {
  constructor(
    readonly code:
      | 'unauthenticated'
      | 'forbidden'
      | 'invalid_input'
      | 'unavailable'
      | 'changed'
      | 'audit_unavailable',
  ) {
    super(code);
    this.name = 'TalentExportError';
  }
}
