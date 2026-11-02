import { z } from 'zod';
import { reviewCalibrationSchema } from '../../../../contracts/review-queue';
import { ScoreReviewStoreConflict, type CalibrationWrite } from './ports';
import { digest } from './service';

const text = z.string().trim().min(1);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const calibrationWriteSchema = z.strictObject({
  accountId: text,
  operationId: text,
  actorPersonId: text,
  fingerprint,
  scopeFingerprint: fingerprint,
  originalFingerprint: fingerprint,
  target: z.strictObject({
    itemId: text,
    eventId: text,
    personId: text,
    evaluationNodeId: text,
    dimensionId: text,
    ruleVersion: text,
    revision: z.number().int().positive(),
    status: z.literal('open'),
  }),
  result: reviewCalibrationSchema,
});

/** Checks a trusted write plan, not current authority or source authenticity.
 * The store must still compare the real current rows and operation ledger in
 * its transaction. Without the original action, fingerprint is only a digest
 * shape check; it cannot be reconstructed from the calibration result. */
export function validateCalibrationWrite(input: unknown): CalibrationWrite {
  try {
    const write: CalibrationWrite = calibrationWriteSchema.parse(input);
    const { target, result } = write;
    const { original, score } = result;
    const sides =
      original.kind === 'rater_gap'
        ? original.sides
        : [original.human, original.ai];
    if (
      result.itemId !== target.itemId ||
      original.id !== target.itemId ||
      original.eventId !== target.eventId ||
      original.personId !== target.personId ||
      original.dimensionId !== target.dimensionId ||
      original.revision !== target.revision ||
      result.revision !== target.revision + 1 ||
      score.raterId !== write.actorPersonId ||
      !score.reason.trim() ||
      score.anchor.ruleVersion !== target.ruleVersion ||
      sides.some((side) => side.anchor.ruleVersion !== target.ruleVersion) ||
      write.originalFingerprint !== digest(original) ||
      write.scopeFingerprint !==
        digest({
          itemId: target.itemId,
          eventId: target.eventId,
          personId: target.personId,
          evaluationNodeId: target.evaluationNodeId,
          dimensionId: target.dimensionId,
          ruleVersion: target.ruleVersion,
        })
    ) {
      throw new ScoreReviewStoreConflict();
    }

    // Service deduplicates full citation content, not quote text or source ID.
    // Union membership is independent of object-key and output-array ordering.
    const originals = new Set(
      sides
        .flatMap((side) => side.citations)
        .map((citation) => digest(citation)),
    );
    const calibrated = score.citations.map((citation) => digest(citation));
    if (
      calibrated.length !== originals.size ||
      new Set(calibrated).size !== originals.size ||
      calibrated.some((citation) => !originals.has(citation))
    ) {
      throw new ScoreReviewStoreConflict();
    }
    return write;
  } catch {
    // Never attach parser errors, original evidence, getters, or causes.
    throw new ScoreReviewStoreConflict();
  }
}
