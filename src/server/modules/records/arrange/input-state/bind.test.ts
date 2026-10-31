import { describe, expect, it } from 'vitest';
import { bindSelectedInput, arrangeOperationFingerprint } from './bind';
import type { StoredArrangeInput } from './schema';
import type { RecordSelectionInput } from '../../../../../contracts/record';
const old = (): StoredArrangeInput => ({
  id: 'old-draft',
  creatorAccountId: 'actor',
  jobId: 'old-job',
  inputVersion: 'v1',
  origin: 'text',
  originalInput: {
    operation_id: 'create',
    text: '  原话（演示）  ',
    attachmentIds: ['attachment'],
    personId: null,
    projectId: null,
  },
  sourceContexts: [
    {
      fragmentId: 'fragment',
      originalVersionId: 'version',
      subjects: [],
      attributedPersonIds: [],
      kind: 'evaluation',
      requiredKinds: [],
    },
  ],
  inputSource: { fragmentId: 'fragment', originalVersionId: 'version' },
  personIds: [],
  projectMode: 'none',
  projectId: null,
  projectCandidateIds: [],
  supersededByInputId: null,
  createdAt: new Date('2026-10-25T00:00:00Z'),
});
const selection = (): RecordSelectionInput => ({
  operation_id: 'selection',
  draftId: 'old-draft',
  expected_input_version: 'v1',
  personIds: ['p1', 'p2'],
  projectId: null,
});
describe('new input after explicit selection', () => {
  it('preserves raw input/attachments and creates new identities without reviving the old draft', () => {
    const previous = old();
    const next = bindSelectedInput(
      previous,
      selection(),
      [
        { personId: 'p1', cohortId: 'cohort' },
        { personId: 'p2', cohortId: 'cohort' },
      ],
      {
        id: 'new-draft',
        jobId: 'new-job',
        inputVersion: 'v2',
        createdAt: new Date('2026-10-25T01:00:00Z'),
      },
    );
    expect(next).toMatchObject({
      id: 'new-draft',
      jobId: 'new-job',
      inputVersion: 'v2',
      personIds: ['p1', 'p2'],
      originalInput: previous.originalInput,
    });
    expect(next.sourceContexts[0]!.subjects).toHaveLength(2);
    expect(previous.personIds).toEqual([]);
    expect(previous.supersededByInputId).toBeNull();
  });
  it.each(['recording', 'attachment'] as const)(
    'does not spread selected people over %s behavior attribution',
    (origin) => {
      const previous = old();
      previous.origin = origin;
      previous.inputSource = null;
      previous.sourceContexts[0]!.subjects = [
        { personId: 'p1', cohortId: null },
        { personId: 'p2', cohortId: null },
      ];
      previous.sourceContexts[0]!.attributedPersonIds = ['p1'];
      const next = bindSelectedInput(
        previous,
        selection(),
        previous.sourceContexts[0]!.subjects,
        {
          id: 'new',
          jobId: 'new-job',
          inputVersion: 'v2',
          createdAt: new Date(),
        },
      );
      expect(next.sourceContexts).toEqual(previous.sourceContexts);
    },
  );
  it.each(['version', 'consumed', 'resource'] as const)(
    'rejects an obsolete %s without changing the old input',
    (kind) => {
      const previous = old();
      const input = selection();
      if (kind === 'version') input.expected_input_version = 'old';
      if (kind === 'consumed') previous.supersededByInputId = 'winner';
      if (kind === 'resource') input.draftId = 'other';
      expect(() =>
        bindSelectedInput(previous, input, [], {
          id: 'new',
          jobId: 'new-job',
          inputVersion: 'v2',
          createdAt: new Date(),
        }),
      ).toThrow('input changed');
    },
  );
  it('uses a stable semantic fingerprint, preserving distinct original text bytes', () => {
    expect(arrangeOperationFingerprint({ a: 1, b: [2, 3] })).toBe(
      arrangeOperationFingerprint({ b: [2, 3], a: 1 }),
    );
    expect(arrangeOperationFingerprint({ text: '  原话  ' })).not.toBe(
      arrangeOperationFingerprint({ text: '原话' }),
    );
  });
});
