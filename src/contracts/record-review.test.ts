import { describe, expect, it } from 'vitest';
import { recordScoreSchema, recordUndoInputSchema } from './record';
import { reviewQueueItemSchema } from './review-queue';

describe('record and review contracts', () => {
  it('keeps unknown separate from scored suggestions', () => {
    const unknown = {
      personId: 'demo-person',
      dimensionId: 'prof',
      state: 'unknown',
      reason: '未体现',
    };
    expect(recordScoreSchema.safeParse(unknown).success).toBe(true);
    const scored = recordScoreSchema.safeParse({ ...unknown, value: 1 });
    expect(scored.success).toBe(false);
  });

  it('does not trust client time for undo', () => {
    const undo = { operation_id: 'demo-undo', saveId: 'demo-save' };
    expect(recordUndoInputSchema.safeParse(undo).success).toBe(true);
    const timed = recordUndoInputSchema.safeParse({ ...undo, now: 0 });
    expect(timed.success).toBe(false);
  });

  it('marks frozen-position recalibration as not connected', () => {
    expect(
      reviewQueueItemSchema.safeParse({
        kind: 'recalibration',
        status: 'not_connected',
      }).success,
    ).toBe(true);
    expect(
      reviewQueueItemSchema.safeParse({
        kind: 'recalibration',
        status: 'completed',
      }).success,
    ).toBe(false);
  });
});
