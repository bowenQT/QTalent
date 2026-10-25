import { z } from 'zod';
import {
  recordActionResultSchema,
  recordEvidenceScoreSchema,
  recordValueSchema,
} from './record';

const text = z.string().trim().min(1);
const revision = z.number().int().positive();
export const reviewHumanScoreSchema = recordEvidenceScoreSchema.extend({
  raterId: text,
  confirmedAt: z.iso.datetime(),
  reason: z.string(),
});
const itemBase = z.strictObject({
  id: text,
  revision,
  eventId: text,
  personId: text,
  dimensionId: text,
});
export const reviewQueueItemSchema = z.discriminatedUnion('kind', [
  itemBase
    .extend({
      kind: z.literal('rater_gap'),
      sides: z.tuple([reviewHumanScoreSchema, reviewHumanScoreSchema]),
    })
    .refine((x) => x.sides[0].raterId !== x.sides[1].raterId)
    .refine((x) => Math.abs(x.sides[0].value - x.sides[1].value) >= 2),
  itemBase
    .extend({
      kind: z.literal('ai_gap'),
      human: reviewHumanScoreSchema,
      ai: recordEvidenceScoreSchema,
    })
    .refine((x) => Math.abs(x.human.value - x.ai.value) >= 2)
    .refine((x) => x.human.reason.trim() === ''),
  z.strictObject({
    kind: z.literal('recalibration'),
    status: z.literal('not_connected'),
  }),
]);
const actionBase = z.strictObject({
  operation_id: text,
  expected_revision: revision,
  itemId: text,
  reason: text,
});
export const reviewQueueActionSchema = z.discriminatedUnion('action', [
  actionBase.extend({
    action: z.literal('calibrate'),
    kind: z.enum(['rater_gap', 'ai_gap']),
    value: recordValueSchema,
  }),
  actionBase.extend({
    action: z.literal('keep_score'),
    kind: z.literal('ai_gap'),
  }),
]);
// The response preserves the original sides; calibration is a new signed record.
export const reviewCalibrationSchema = z.strictObject({
  itemId: text,
  revision,
  score: reviewHumanScoreSchema,
  original: reviewQueueItemSchema,
});
export const reviewQueueResultSchema = recordActionResultSchema(
  reviewQueueActionSchema,
  reviewCalibrationSchema,
);
export const reviewQueueListSchema = z.strictObject({
  items: z.array(reviewQueueItemSchema),
});
export type ReviewQueueItem = z.infer<typeof reviewQueueItemSchema>;
export type ReviewQueueAction = z.infer<typeof reviewQueueActionSchema>;
export type ReviewQueueResult = z.infer<typeof reviewQueueResultSchema>;
