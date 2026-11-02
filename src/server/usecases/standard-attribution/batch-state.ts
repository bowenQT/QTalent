import { asc, eq } from 'drizzle-orm';
import {
  confirmedStandardAttributionSchema,
  standardAttributionHypothesisSchema,
  type ConfirmedStandardAttribution,
  type StandardAttributionHypothesis,
} from '../../../contracts/standard-attribution';
import type { Transaction } from '../../db/client';
import {
  attributionHypotheses,
  standardAttributions,
} from '../../modules/evaluation-system';
import { readCurrentSelectionStandard } from '../../modules/evaluation-system/selection/postgres';
import { readComparisonDataset } from '../judgment-comparison-dataset';
import {
  createAttributionReadAdapter,
  referencesMatch,
  type AttributionReadServices,
} from './read-adapter';

/** The production 919/918 readers the attribution store consumes. */
export function nativeAttributionReadServices(
  clock: () => Date,
): AttributionReadServices {
  return {
    readCanonicalComparisonBatch: readComparisonDataset,
    readSelectionStandard: (tx, versionId) =>
      readCurrentSelectionStandard(tx, versionId, clock),
  };
}

export type BatchAttributionState = {
  hypotheses: StandardAttributionHypothesis[];
  attributions: ConfirmedStandardAttribution[];
};

/**
 * The HR page's saved hypotheses and confirmed attributions for one batch. Null
 * when the batch is unknown or outside the caller's current HR scope. An item is
 * returned only while every case it cites is still disclosable to the caller;
 * stored citations are not a current grant.
 */
export async function readBatchAttributionState(
  tx: Transaction,
  batchId: string,
  accountId: string,
  at: string,
): Promise<BatchAttributionState | null> {
  const reader = createAttributionReadAdapter(
    nativeAttributionReadServices(() => new Date(at)),
  );
  const batch = await reader.loadHrBatch(tx, accountId, batchId, at);
  if (!batch) return null;
  const hypotheses = (
    await tx
      .select({ payload: attributionHypotheses.payload })
      .from(attributionHypotheses)
      .where(eq(attributionHypotheses.batchId, batchId))
      .orderBy(asc(attributionHypotheses.id))
  )
    .map((row) => standardAttributionHypothesisSchema.parse(row.payload))
    .filter((value) => referencesMatch(batch, value.citations));
  const attributions = (
    await tx
      .select({ payload: standardAttributions.payload })
      .from(standardAttributions)
      .where(eq(standardAttributions.batchId, batchId))
      .orderBy(
        asc(standardAttributions.confirmedAt),
        asc(standardAttributions.id),
      )
  )
    .map((row) => confirmedStandardAttributionSchema.parse(row.payload))
    .filter((value) => referencesMatch(batch, value.citations));
  return { hypotheses, attributions };
}
