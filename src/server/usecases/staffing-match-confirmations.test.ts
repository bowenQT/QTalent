import { describe, expect, it, vi } from 'vitest';
import type { DbExecutor } from '../db/client';
import {
  eventNature,
  readStaffingMatchConfirmations,
} from './staffing-match-confirmations';

function executor(rows: { id: string; recordId: string }[]) {
  const where = vi.fn(async () => rows);
  const select = vi.fn(() => ({ from: () => ({ where }) }));
  return { db: { select } as unknown as DbExecutor, select };
}
const event = (
  id: string,
  over: Partial<{ demo: boolean; withdrawnAt: Date | null }> = {},
) => ({
  id,
  personId: 'person-' + id,
  demo: true,
  withdrawnAt: null,
  ...over,
});

describe('BOW-854 matching confirmation facts', () => {
  it('reads the nature the statements state, never a default', () => {
    expect(eventNature(['original_fact', 'original_fact'])).toBe(
      'original_fact',
    );
    expect(eventNature(['self_report'])).toBe('self_report');
    expect(eventNature(['original_fact', 'management_observation'])).toBe(
      'management_observation',
    );
    // No statement, a model inference or mixed kinds state no nature.
    expect(eventNature([])).toBeNull();
    expect(eventNature(['ai_inference'])).toBeNull();
    expect(eventNature(['original_fact', 'self_report'])).toBeNull();
  });
  it('confirms a demo event through its single import snapshot', async () => {
    const { db } = executor([
      { id: 'snapshot-a', recordId: 'a' },
      { id: 'snapshot-w', recordId: 'w' },
    ]);
    const facts = await readStaffingMatchConfirmations(db, {
      events: [event('a'), event('w', { withdrawnAt: new Date() })],
      statements: [
        { eventId: 'a', kind: 'original_fact' },
        { eventId: 'w', kind: 'original_fact' },
      ],
    });
    expect(facts).toEqual([
      {
        recordId: 'a',
        personId: 'person-a',
        active: true,
        state: 'confirmed',
        confirmation: {
          kind: 'prototype_baseline',
          id: 'snapshot-a',
          demo: true,
        },
        nature: 'original_fact',
      },
      expect.objectContaining({ recordId: 'w', active: false }),
    ]);
  });
  it('gives no fact without a nature, without exactly one snapshot, or for a human save', async () => {
    const { db, select } = executor([
      { id: 'snapshot-b', recordId: 'b' },
      { id: 'snapshot-c1', recordId: 'c' },
      { id: 'snapshot-c2', recordId: 'c' },
    ]);
    expect(
      await readStaffingMatchConfirmations(db, {
        events: [
          event('b'),
          event('c'),
          event('d'),
          event('saved', { demo: false }),
        ],
        statements: [
          { eventId: 'c', kind: 'original_fact' },
          { eventId: 'd', kind: 'original_fact' },
          { eventId: 'saved', kind: 'original_fact' },
        ],
      }),
    ).toEqual([]);
    // Only demo events are looked up.
    expect(select).toHaveBeenCalledOnce();
    const none = executor([]);
    expect(
      await readStaffingMatchConfirmations(none.db, {
        events: [event('saved', { demo: false })],
        statements: [],
      }),
    ).toEqual([]);
    expect(none.select).not.toHaveBeenCalled();
  });
});
