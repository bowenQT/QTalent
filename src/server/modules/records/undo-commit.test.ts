import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../db/client';
import {
  requireRecordUndoCommit,
  readStoredUndoReceipt,
  type RecordUndoCommit,
} from './write';
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

describe('stored undo receipt projection', () => {
  const legacy = {
    saveId: 'demo-save',
    withdrawnEvents: [],
    withdrawnConfirmationIds: [],
    withdrawnReviewItemIds: [],
    originalInput: {
      operation_id: 'demo-input',
      text: '化名演示',
      attachmentIds: [],
      personId: null,
      projectId: null,
    },
  };
  it('projects both historical generations without guessing or mutating a revision', () => {
    for (const value of [
      legacy,
      { ...legacy, inputRestoration: 'available' },
    ]) {
      const before = structuredClone(value);
      expect(readStoredUndoReceipt(value)).toMatchObject({
        draftRestoration: { status: 'refresh_required' },
        inputRestoration: 'unavailable',
        originalInput: null,
      });
      expect(value).toEqual(before);
    }
  });
  it('strips cancellation facts and never restores stored text', () => {
    const value = {
      ...legacy,
      inputRestoration: 'available',
      draftRestoration: {
        status: 'available',
        draftId: 'demo-draft',
        draftRevision: 3,
      },
      cancelledConfirmationWork: [],
    };
    expect(readStoredUndoReceipt(value)).toEqual({
      saveId: 'demo-save',
      withdrawnEvents: [],
      withdrawnConfirmationIds: [],
      withdrawnReviewItemIds: [],
      inputRestoration: 'unavailable',
      originalInput: null,
      draftRestoration: {
        status: 'available',
        draftId: 'demo-draft',
        draftRevision: 3,
      },
    });
  });
  it('rejects a malformed claimed revision rather than silently treating it as legacy', () => {
    expect(() =>
      readStoredUndoReceipt({
        ...legacy,
        inputRestoration: 'available',
        draftRestoration: {
          status: 'available',
          draftId: 'demo-draft',
          draftRevision: 0,
        },
      }),
    ).toThrow();
  });
});
