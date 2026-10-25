import { describe, expect, it } from 'vitest';
import {
  recordArrangeResultSchema,
  recordJobSchema,
  recordSelectionInputSchema,
} from './record';
import { recordDraftFixture } from './record-review.fixtures';

const selection = {
  state: 'selection_required',
  draftId: 'demo-draft',
  inputVersion: 'input-v1',
  originalInput: recordDraftFixture.originalInput,
  people: [
    {
      state: 'needs_selection',
      candidates: [{ id: 'demo-person', label: '演示人员' }],
      reason: '请选择原话对应的人员',
    },
  ],
  project: { state: 'none' },
};

describe('record selection before model arrangement', () => {
  it('returns authorized choices without inventing SBI or scores', () => {
    const parsed = recordArrangeResultSchema.parse(selection);
    expect(parsed).toEqual(selection);
    expect('sbi' in parsed).toBe(false);
    expect('scores' in parsed).toBe(false);
    const invented = { ...selection, sbi: recordDraftFixture.sbi };
    expect(recordArrangeResultSchema.safeParse(invented).success).toBe(false);
    const draft = recordArrangeResultSchema.safeParse(recordDraftFixture);
    expect(draft.success).toBe(true);
  });

  it('projects selection_required through the existing job envelope', () => {
    const job = {
      schemaVersion: 1,
      jobId: 'demo-job',
      kind: 'record_organize',
      status: 'awaiting_manual',
      attempt: 1,
      revision: 2,
      updatedAt: '2026-10-25T10:00:00Z',
      progress: null,
      result: selection,
      error: null,
      canRetry: false,
      canCancel: true,
      cancelRequestedAt: null,
    };
    expect(recordJobSchema.parse(job).result).toEqual(selection);
  });

  it('requires selected people and the original input version', () => {
    const input = {
      operation_id: 'demo-select',
      draftId: 'demo-draft',
      expected_input_version: 'input-v1',
      personIds: ['demo-person'],
      projectId: null,
    };
    expect(recordSelectionInputSchema.parse(input)).toEqual(input);
    const empty = { ...input, personIds: [] };
    const duplicate = { ...input, personIds: ['demo-person', 'demo-person'] };
    const unversioned = { ...input, expected_input_version: '' };
    const forged = { ...input, actorId: 'other' };
    for (const invalid of [empty, duplicate, unversioned, forged]) {
      expect(recordSelectionInputSchema.safeParse(invalid).success).toBe(false);
    }
  });
});
