import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../db/client';
import { requireRecordUndoCommit, type RecordUndoCommit } from './write';
describe('record undo commit proof', () => {
  it('rejects request-shaped or copied objects before any database access', () => {
    const tx = {} as Transaction;
    for (const input of [
      {},
      { saveId: 'demo-save', withdrawnAt: '2026-11-01T10:00:01Z' },
    ])
      expect(() =>
        requireRecordUndoCommit(tx, input as RecordUndoCommit),
      ).toThrow('record_undo_commit_required');
  });
});
