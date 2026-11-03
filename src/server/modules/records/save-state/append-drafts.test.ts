import { describe, expect, it } from 'vitest';
import { recordBatchDraftFixture } from '../../../../contracts/materials.fixtures';
import type { RecordBatchDraftSet } from '../../../../contracts/record';
import { combineAppendedDrafts } from './append-drafts';

function set(id: string, revision = 2): RecordBatchDraftSet {
  return {
    batchId: 'demo-batch',
    revision,
    duplicateCandidates: [],
    drafts: [{ ...structuredClone(recordBatchDraftFixture), draftId: id }],
  };
}
describe('independent file draft append', () => {
  it('uses the current parent revision, not the other file generation revision', () => {
    const current = set('demo-a', 17);
    current.drafts[0]!.revision = 9;
    const incoming = set('demo-b', 2);
    const before = structuredClone(current);
    const result = combineAppendedDrafts(current, incoming);
    expect(result.revision).toBe(18);
    expect(result.drafts[0]).toEqual(before.drafts[0]);
    expect(result.drafts[1]).toEqual(incoming.drafts[0]);
    expect(current).toEqual(before);
    expect(incoming.revision).toBe(2);
  });
  it('rejects a same-ID rewrite rather than replacing a confirmed draft', () => {
    const addition = set('demo-a');
    addition.drafts[0]!.sbi.title = '演示另一个内容';
    expect(() => combineAppendedDrafts(set('demo-a'), addition)).toThrow(
      'append_draft_identity_changed',
    );
  });
  it('accepts only a new draft revision', () => {
    const addition = set('demo-b');
    addition.drafts[0]!.revision = 2;
    expect(() => combineAppendedDrafts(set('demo-a'), addition)).toThrow(
      'append_draft_identity_changed',
    );
  });
  it('does not append another batch', () => {
    const addition = set('demo-b');
    addition.batchId = 'demo-other';
    addition.drafts[0]!.batchId = addition.batchId;
    expect(() => combineAppendedDrafts(set('demo-a'), addition)).toThrow(
      'append_draft_identity_changed',
    );
  });
  it('preserves existing duplicate decisions and rejects colliding groups', () => {
    const current = set('demo-a');
    current.drafts.push({
      ...structuredClone(current.drafts[0]!),
      draftId: 'demo-a2',
    });
    current.duplicateCandidates = [
      {
        candidateId: 'demo-group',
        draftIds: ['demo-a', 'demo-a2'],
        reason: '演示相似材料',
      },
    ];
    const addition = set('demo-b');
    expect(
      combineAppendedDrafts(current, addition).duplicateCandidates,
    ).toEqual(current.duplicateCandidates);
    addition.drafts.push({
      ...structuredClone(addition.drafts[0]!),
      draftId: 'demo-b2',
    });
    addition.duplicateCandidates = [
      {
        candidateId: 'demo-group',
        draftIds: ['demo-b', 'demo-b2'],
        reason: '演示相似材料',
      },
    ];
    expect(() => combineAppendedDrafts(current, addition)).toThrow(
      'append_draft_set_invalid',
    );
  });
});
