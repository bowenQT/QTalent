import { expect, it } from 'vitest';
import { parseFormalEvidence } from './evidence-input';
const ordinary = () => ({
  originals: [{ id: 'o', title: 'Synthetic original' }],
  originalVersions: [
    { id: 'v', originalId: 'o', version: 1, contentDigest: 'synthetic' },
  ],
  fragments: [
    {
      id: 'f',
      originalVersionId: 'v',
      location: { kind: 'document', paragraph: '1' },
      excerpt: 'Synthetic quote',
    },
  ],
  events: [
    {
      id: 'e',
      evaluationNodeId: 'node',
      personId: 'p',
      recorderId: 'r',
      occurredOn: '2026-07-24',
      title: 'Synthetic',
      situation: 'Synthetic context',
      behavior: 'Synthetic behavior',
      impact: '',
      ruleVersionId: 'published',
    },
  ],
  eventSources: [{ eventId: 'e', fragmentId: 'f', originalVersionId: 'v' }],
  confirmations: [
    {
      id: 'c',
      eventId: 'e',
      dimensionId: 'd',
      ruleVersionId: 'published',
      status: 'scored',
      value: 3,
      anchorId: 'a',
      fragmentId: 'f',
      originalVersionId: 'v',
      evaluatorId: 'r',
      modifiedBy: 'r',
      confirmedAt: '2026-07-24T00:00:00Z',
    },
  ],
});
it('parses the ordinary complete chain with formal defaults and an actual confirmation time', () => {
  const parsed = parseFormalEvidence(ordinary());
  expect(parsed.events[0]).toMatchObject({
    demo: false,
    behavior: 'Synthetic behavior',
    evaluationNodeId: 'node',
  });
  expect(parsed.confirmations[0]).toMatchObject({
    sourceCategory: 'original',
    revision: 1,
    confirmedAt: new Date('2026-07-24T00:00:00Z'),
  });
});
it('preserves an explicitly empty situation without inventing context for a formal event', () => {
  const input = ordinary();
  input.events[0].situation = '';
  expect(parseFormalEvidence(input).events[0]).toMatchObject({
    situation: '',
    behavior: 'Synthetic behavior',
    demo: false,
  });
});
it.each([
  { demo: true },
  { mode: 'demo' },
  { APP_ENV: 'test' },
  { snapshots: [] },
])(
  'rejects unknown top-level control fields instead of stripping them',
  (control) => {
    expect(() => parseFormalEvidence({ ...ordinary(), ...control })).toThrow();
  },
);
it.each([
  { kind: 'prototype_snapshot' },
  { displayNotice: 'Synthetic demo notice' },
  { demo: true },
])('rejects marked or disguised demo originals', (patch) => {
  const input = ordinary();
  Object.assign(input.originals[0], patch);
  expect(() => parseFormalEvidence(input)).toThrow();
});
it.each([
  { demo: true },
  { behavior: ' \t\n' },
  { situation: null },
  { situation: undefined },
  { env: 'local' },
])('rejects demo or incomplete formal events', (patch) => {
  const input = ordinary();
  Object.assign(input.events[0], patch);
  expect(() => parseFormalEvidence(input)).toThrow();
});
it.each([
  { sourceCategory: 'prototype_baseline' },
  { evaluatorId: null },
  { modifiedBy: null },
  { value: 0 },
  { value: 6 },
  { status: 'unknown', value: 3 },
  { status: 'unknown', value: null, anchorId: 'a' },
])(
  'rejects baseline or invalid formal score attribution and values',
  (patch) => {
    const input = ordinary();
    Object.assign(input.confirmations[0], patch);
    expect(() => parseFormalEvidence(input)).toThrow();
  },
);
it('rejects baseline AI and historical rows even when their complete shape and references are valid', () => {
  const input = ordinary();
  const suggestion = {
    id: 'ai',
    eventId: 'e',
    dimensionId: 'd',
    ruleVersionId: 'published',
    status: 'scored',
    value: 3,
    anchorId: 'a',
    fragmentId: 'f',
    originalVersionId: 'v',
    modelVersion: 'synthetic-v1',
    rationale: 'Synthetic rationale',
  };
  expect(() =>
    parseFormalEvidence({
      ...input,
      aiSuggestions: [{ ...suggestion, sourceCategory: 'prototype_baseline' }],
    }),
  ).toThrow(/rejects/);
  const history = {
    id: 'h',
    sourceRecordId: 'source-h',
    evaluationNodeId: null,
    recorderId: 'r',
    occurredOn: '2026-07-24',
    kind: 'Synthetic history',
    scale: [['Original scale', 'B']],
    fragmentId: 'f',
    originalVersionId: 'v',
  };
  expect(() =>
    parseFormalEvidence({
      ...input,
      historicalEvaluations: [
        { ...history, sourceCategory: 'prototype_baseline' },
      ],
    }),
  ).toThrow(/rejects/);
  expect(
    parseFormalEvidence({
      ...input,
      aiSuggestions: [suggestion],
      historicalEvaluations: [history],
      historicalParticipants: [{ evaluationId: 'h', personId: 'p' }],
    }).historicalEvaluations[0].ruleVersionId,
  ).toBeNull();
});
it('rejects snapshot locations disguised as ordinary source rows', () => {
  const input = ordinary();
  Object.assign(input.fragments[0], {
    location: { kind: 'snapshot_field', fieldPath: 'events[e].act' },
  });
  expect(() => parseFormalEvidence(input)).toThrow(/rejects/);
});
it.each([
  'originals',
  'originalVersions',
  'fragments',
  'events',
  'eventSources',
] as const)('rejects an incomplete chain after removing %s', (field) => {
  const input = ordinary();
  input[field] = [];
  expect(() => parseFormalEvidence(input)).toThrow(/complete/);
});
it('rejects dangling participants, review events and historical participants', () => {
  const input = ordinary();
  expect(() =>
    parseFormalEvidence({
      ...input,
      eventParticipants: [{ eventId: 'other', personId: 'p' }],
    }),
  ).toThrow(/complete/);
  expect(() =>
    parseFormalEvidence({
      ...input,
      scoreReviews: [
        {
          id: 'review',
          eventId: 'other',
          dimensionId: 'd',
          reason: 'score_gap',
        },
      ],
    }),
  ).toThrow(/complete/);
  expect(() =>
    parseFormalEvidence({
      ...input,
      historicalParticipants: [{ evaluationId: 'missing', personId: 'p' }],
    }),
  ).toThrow(/complete/);
  expect(() =>
    parseFormalEvidence({
      ...input,
      historicalEvaluations: [
        {
          id: 'h',
          sourceRecordId: 'h-source',
          evaluationNodeId: null,
          recorderId: 'r',
          occurredOn: '2026-07-24',
          kind: 'Synthetic history',
          scale: [],
          fragmentId: 'other',
          originalVersionId: 'v',
        },
      ],
    }),
  ).toThrow(/complete/);
});
it('accepts accurate recording/spreadsheet locations and rejects reversed time intervals', () => {
  const input = ordinary();
  expect(
    parseFormalEvidence({
      ...input,
      fragments: [
        {
          ...input.fragments[0],
          location: { kind: 'recording', startMs: 0, endMs: 1200 },
        },
      ],
    }).fragments[0].location.kind,
  ).toBe('recording');
  expect(
    parseFormalEvidence({
      ...input,
      fragments: [
        {
          ...input.fragments[0],
          location: { kind: 'spreadsheet', sheet: 'Synthetic', cell: 'B2' },
        },
      ],
    }).fragments[0].location.kind,
  ).toBe('spreadsheet');
  expect(() =>
    parseFormalEvidence({
      ...input,
      fragments: [
        {
          ...input.fragments[0],
          location: { kind: 'recording', startMs: 1200, endMs: 1200 },
        },
      ],
    }),
  ).toThrow();
});
it('does not confuse different composite references when IDs contain colons', () => {
  const input = ordinary();
  const malformed = {
    ...input,
    confirmations: [],
    originalVersions: [
      { ...input.originalVersions[0], id: 'b:c' },
      { ...input.originalVersions[0], id: 'c', version: 2 },
    ],
    fragments: [{ ...input.fragments[0], id: 'a', originalVersionId: 'b:c' }],
    eventSources: [{ eventId: 'e', fragmentId: 'a:b', originalVersionId: 'c' }],
  };
  expect(() => parseFormalEvidence(malformed)).toThrow(/complete/);
  const noLinkedScore = {
    ...input,
    events: [
      { ...input.events[0], id: 'e:x' },
      { ...input.events[0], id: 'e' },
    ],
    originalVersions: [
      { ...input.originalVersions[0], id: 'b:c' },
      { ...input.originalVersions[0], id: 'c', version: 2 },
    ],
    fragments: [
      { ...input.fragments[0], id: 'a', originalVersionId: 'b:c' },
      { ...input.fragments[0], id: 'x:a:b', originalVersionId: 'c' },
    ],
    eventSources: [
      { eventId: 'e', fragmentId: 'x:a:b', originalVersionId: 'c' },
    ],
    confirmations: [
      {
        ...input.confirmations[0],
        eventId: 'e:x',
        fragmentId: 'a',
        originalVersionId: 'b:c',
      },
    ],
  };
  expect(() => parseFormalEvidence(noLinkedScore)).toThrow(/complete/);
});

it.each(['', '  '])(
  'rejects a blank explicit formal node (%s)',
  (evaluationNodeId) => {
    const input = ordinary();
    Object.assign(input.events[0], { evaluationNodeId });
    expect(() => parseFormalEvidence(input)).toThrow();
  },
);

it.each([null, undefined])(
  'keeps a legacy formal event node unknown when the server import has no node (%s)',
  (evaluationNodeId) => {
    const input = ordinary();
    Object.assign(input.events[0], { evaluationNodeId });
    expect(parseFormalEvidence(input).events[0].evaluationNodeId).toBeNull();
  },
);
