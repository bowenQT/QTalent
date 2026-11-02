'use server';
import 'server-only';
import { z } from 'zod';
import type { MaterialBatchReadResult } from '../../contracts/materials';
import { createClock } from '../../lib/clock';
import { requireSession } from '../auth/next';
import { getDatabase } from '../db/client';
import { getEnv } from '../env';
import {
  createRecordEvaluationNodeResolver,
  RecordNodeResolutionUnavailable,
  type RecordEvaluationNodeResolution,
} from '../usecases/record-evaluation-node';
import { readRecordMaterialBatchForCurrentUser } from '../queries/record-arrange';
import { readRecordAnchors } from '../queries/record-page';
import { readSourceForCurrentUser } from '../queries/sources';

/**
 * Thin actions for the record page (owner ruling #248 6559810703). Each one only calls
 * an existing read that checks the current session itself; none decides scope here.
 */
export async function readRecordBatchAction(
  input: unknown,
): Promise<MaterialBatchReadResult> {
  const result = await readRecordMaterialBatchForCurrentUser(input);
  // The query's own input check answers without field errors; give the contract shape.
  return result.status === 'validation_error' && !('fieldErrors' in result)
    ? {
        status: 'validation_error',
        fieldErrors: { batchId: ['请提供有效批次'] },
        input,
      }
    : result;
}

export async function readRecordSourceAction(input: unknown) {
  return readSourceForCurrentUser(input);
}

const anchorsInputSchema = z.strictObject({
  ruleVersions: z.array(z.string().trim().min(1)).max(20),
});
export async function readRecordAnchorsAction(input: unknown) {
  const parsed = anchorsInputSchema.safeParse(input);
  if (!parsed.success) return [];
  await requireSession();
  return readRecordAnchors(parsed.data.ruleVersions);
}

/**
 * The evaluation node for the chosen people (BOW-845 #327). It reads relations on the
 * same business clock as `page()` and the batch intake, so the demo's fixed business
 * day answers the same way everywhere. Discovery only: the intake checks again.
 */
export async function resolveRecordNodeAction(
  input: unknown,
): Promise<RecordEvaluationNodeResolution | { status: 'unavailable' }> {
  const session = await requireSession();
  const clock = createClock(getEnv().APP_ENV);
  try {
    return await createRecordEvaluationNodeResolver({
      db: getDatabase(),
      businessNow: () => clock.now().toISOString(),
    })(session.user.id, input);
  } catch (error) {
    // The reader already hides the cause; say so plainly instead of a network error.
    if (error instanceof RecordNodeResolutionUnavailable)
      return { status: 'unavailable' };
    throw error;
  }
}
