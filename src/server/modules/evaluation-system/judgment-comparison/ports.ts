import type { z } from 'zod';
import type {
  ComparisonCase,
  ComparisonMapping,
  comparisonBatchSchema,
  standardAttributionCategorySchema,
} from '@/contracts/judgment-comparison';

// Human facts are separate from the outcome computed by this reader.
export type HumanComparabilityMark = Omit<
  Extract<ComparisonCase['outcome'], { state: 'not_comparable' }>,
  'state'
>;
export type ComparisonFacts = Omit<ComparisonCase, 'outcome'> & {
  nonComparable?: HumanComparabilityMark;
};
export type ComparisonBatch = z.infer<typeof comparisonBatchSchema>;
export type ComparisonDataset = {
  batch: ComparisonBatch;
  mapping: ComparisonMapping;
  cases: readonly ComparisonFacts[];
  confirmedAttributions: readonly {
    caseId: string;
    category: z.infer<typeof standardAttributionCategorySchema>;
  }[];
};
export type CurrentComparisonAccess = {
  audience: 'hr' | 'rater' | 'manager';
  viewerId: string;
  now: string;
  // Effective server-authorized stage grants for this viewer, not client roles.
  // The adapter must derive HR/manager scopes and current node relations through
  // the authorization domain; these are not invented persisted relationships.
  grants: readonly {
    personId: string;
    nodeId: string;
    validFrom: string;
    validUntil: string | null;
  }[];
};
export type ComparisonReadPorts = {
  loadCurrentAccess(): Promise<CurrentComparisonAccess | null>;
  // Return null for an unknown or out-of-scope batch before exposing metadata.
  loadBatch(
    batchId: string,
    access: CurrentComparisonAccess,
  ): Promise<ComparisonDataset | null>;
};
export class ComparisonInputError extends Error {}
