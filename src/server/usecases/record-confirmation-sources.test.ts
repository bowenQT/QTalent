import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import type { StoredArrangeInput } from '../modules/records';
import type { TalentSource } from '../authz/talent';
import { confirmationSources } from './record-confirmation-sources';
import { sourceKey } from './talent-source-projection';

function fixture() {
  const source: TalentSource = {
    fragmentId: 'fragment',
    originalVersionId: 'version',
    subjects: [],
    kind: 'evaluation',
    requiredKinds: [],
    excerpt: '林舟补齐回滚步骤（演示）',
    location: { kind: 'document', paragraph: 'input' },
  };
  const input: StoredArrangeInput = {
    id: 'intake',
    creatorAccountId: 'creator',
    jobId: 'job',
    inputVersion: 'v1',
    batchId: 'batch',
    evaluationNodeId: 'node',
    boundAt: new Date('2026-09-04'),
    occurredOn: '2026-09-04',
    origin: 'text',
    originalInput: {
      operation_id: 'create',
      text: source.excerpt,
      attachmentIds: [],
      personId: 'person',
      projectId: null,
    },
    sourceContexts: [
      {
        fragmentId: 'fragment',
        originalVersionId: 'version',
        subjects: [
          { personId: 'person', evaluationNodeId: 'node', cohortId: 'cohort' },
        ],
        attributedPersonIds: ['person'],
        kind: 'evaluation',
        requiredKinds: [],
      },
    ],
    inputSource: { fragmentId: 'fragment', originalVersionId: 'version' },
    personIds: ['person'],
    projectMode: 'none',
    projectId: null,
    projectCandidateIds: [],
    supersededByInputId: null,
    createdAt: new Date('2026-09-04'),
  };
  return {
    sources: [source],
    inputs: [input],
    linkedSourceKeys: new Set<string>(),
    versions: [
      {
        id: 'version',
        originalId: 'original',
        contentDigest: createHash('sha256')
          .update(source.excerpt)
          .digest('hex'),
      },
    ],
    originals: [{ id: 'original', kind: 'original' }],
  };
}
it('uses real text intake before the first event exists', () => {
  const data = fixture();
  expect(confirmationSources(data)[0]!.subjects).toEqual(
    data.inputs[0]!.sourceContexts[0]!.subjects,
  );
  expect(data.sources[0]!.subjects).toEqual([]);
});
it('unions every intake and current formal subject, including superseded restrictions', () => {
  const data = fixture();
  const another = structuredClone(data.inputs[0]!);
  another.id = 'other-intake';
  another.creatorAccountId = 'other-creator';
  another.supersededByInputId = 'new-input';
  another.sourceContexts[0]!.subjects = [
    {
      personId: 'other-person',
      evaluationNodeId: 'other-node',
      cohortId: null,
    },
  ];
  another.sourceContexts[0]!.kind = 'restricted-evaluation';
  another.sourceContexts[0]!.requiredKinds = ['management-observation'];
  data.inputs.push(another);
  data.sources[0]!.subjects = [
    {
      personId: 'third-person',
      evaluationNodeId: 'third-node',
      cohortId: null,
    },
  ];
  data.linkedSourceKeys.add(sourceKey(data.sources[0]!));
  const result = confirmationSources(data)[0]!;
  expect(result.subjects.map((s) => s.personId).sort()).toEqual([
    'other-person',
    'person',
    'third-person',
  ]);
  expect(result.requiredKinds).toEqual([
    'restricted-evaluation',
    'management-observation',
  ]);
});
it('does not repair an incomplete existing graph with an otherwise valid intake', () => {
  const data = fixture();
  data.linkedSourceKeys.add(sourceKey(data.sources[0]!));
  expect(confirmationSources(data)[0]!.subjects).toEqual([]);
});
it('does not infer subjects from creator, selected people, or attribution', () => {
  const data = fixture();
  data.inputs[0]!.sourceContexts[0]!.subjects = [];
  expect(confirmationSources(data)[0]!.subjects).toEqual([]);
});
it('keeps the existing complete formal source when there is no intake', () => {
  const data = fixture();
  data.inputs = [];
  data.sources[0]!.subjects = [
    { personId: 'person', evaluationNodeId: 'node', cohortId: null },
  ];
  expect(confirmationSources(data)[0]).toEqual(data.sources[0]);
});
it('deduplicates facts without dropping different node requirements', () => {
  const data = fixture();
  const context = data.inputs[0]!.sourceContexts[0]!;
  context.subjects.push(...structuredClone(context.subjects), {
    personId: 'person',
    evaluationNodeId: 'other-node',
    cohortId: 'cohort',
  });
  expect(confirmationSources(data)[0]!.subjects).toHaveLength(2);
});
it.each([
  'missing-context',
  'different-source',
  'different-version',
  'missing-node',
  'missing-batch',
  'missing-time',
  'missing-date',
  'attachment',
  'recording',
  'digest',
  'raw-text',
  'page',
  'locator',
  'baseline',
  'missing-version',
  'subject-node',
  'unknown-kind',
  'unknown-required-kind',
  'duplicate-context',
] as const)(
  'keeps %s unavailable instead of manufacturing provenance',
  (kind) => {
    const data = fixture(),
      input = data.inputs[0]!,
      source = data.sources[0]!;
    switch (kind) {
      case 'missing-context':
        input.sourceContexts = [];
        break;
      case 'different-source':
        input.inputSource!.fragmentId = 'other';
        break;
      case 'different-version':
        input.inputSource!.originalVersionId = 'other';
        break;
      case 'missing-node':
        input.evaluationNodeId = null;
        break;
      case 'missing-batch':
        input.batchId = null;
        break;
      case 'missing-time':
        input.boundAt = null;
        break;
      case 'missing-date':
        input.occurredOn = null;
        break;
      case 'attachment':
        input.originalInput.attachmentIds = ['attachment'];
        break;
      case 'recording':
        input.origin = 'recording';
        break;
      case 'digest':
        data.versions[0]!.contentDigest = 'wrong';
        break;
      case 'raw-text':
        input.originalInput.text += ' changed';
        break;
      case 'page':
        source.location = { kind: 'document', paragraph: 'input', page: 1 };
        break;
      case 'locator':
        source.location = { kind: 'document', paragraph: 'other' };
        break;
      case 'baseline':
        data.originals[0]!.kind = 'prototype_snapshot';
        break;
      case 'missing-version':
        data.versions = [];
        break;
      case 'subject-node':
        input.sourceContexts[0]!.subjects[0]!.evaluationNodeId = null;
        break;
      case 'unknown-kind':
        Object.assign(input.sourceContexts[0]!, { kind: 'unknown' });
        break;
      case 'unknown-required-kind':
        Object.assign(input.sourceContexts[0]!, { requiredKinds: ['unknown'] });
        break;
      case 'duplicate-context':
        input.sourceContexts.push(structuredClone(input.sourceContexts[0]!));
        break;
    }
    expect(confirmationSources(data)[0]!.subjects).toEqual([]);
  },
);
it('an unrelated intake cannot affect this fragment', () => {
  const data = fixture();
  const other = structuredClone(data.inputs[0]!);
  other.inputSource!.fragmentId = 'other';
  other.sourceContexts[0]!.fragmentId = 'other';
  other.sourceContexts[0]!.subjects = [];
  data.inputs.push(other);
  expect(confirmationSources(data)[0]!.subjects).toHaveLength(1);
});

it('matches canonical RecordInput while retaining and hashing original whitespace', () => {
  const data = fixture();
  data.sources[0]!.excerpt = '  ' + data.sources[0]!.excerpt + '\n ';
  data.versions[0]!.contentDigest = createHash('sha256')
    .update(data.sources[0]!.excerpt)
    .digest('hex');
  expect(confirmationSources(data)[0]!.subjects).toHaveLength(1);
  expect(confirmationSources(data)[0]!.excerpt).toBe(data.sources[0]!.excerpt);
});
