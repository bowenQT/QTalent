import { expect, it } from 'vitest';
import { mapEvidenceSeed } from './evidence';
const input = () => ({
  DIMS: [{ id: 'test-dimension', name: 'Test', axis: 'prof', core: true }],
  ANCHORS: {
    prof: ['one', 'two', 'three', 'four', 'five'],
    pot: ['one', 'two', 'three', 'four', 'five'],
  },
  EVENTS: [
    {
      id: 'test-event',
      date: '2026-07-01',
      kind: 'obs',
      people: ['test-person'],
      recorder: 'test-evaluator',
      title: 'Synthetic',
      bg: 'Situation',
      act: 'Behavior',
      res: 'Impact',
      srcs: [
        {
          type: 'sheet',
          label: 'Synthetic source',
          loc: 'row 6',
          quote: 'Do not disclose in gaps',
        },
      ],
      scores: [
        {
          p: 'test-person',
          d: 'test-dimension',
          v: 3,
          st: 'confirmed',
          by: 'test-evaluator',
        },
      ],
    },
  ],
});
it('keeps baseline identity stable and never promotes unverifiable prototype scores', () => {
  const first = mapEvidenceSeed(input());
  expect(mapEvidenceSeed(input())).toEqual(first);
  expect(first.events).toHaveLength(1);
  expect(first.confirmations).toEqual([]);
  expect(first.fragments).toEqual([]);
  expect(first.gaps).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        recordId: 'test-event',
        missing: expect.arrayContaining(['originalVersionId', 'location']),
      }),
    ]),
  );
  expect(JSON.stringify(first.gaps)).not.toContain('Do not disclose');
  expect(first.snapshots[0]).toMatchObject({
    provenance: 'demo_import_snapshot',
    recordId: 'test-event',
  });
  expect(Object.keys(first)).not.toContain('frozenSnapshots');
});
it('keeps independent individual events and never copies team observations to people', () => {
  const raw = input();
  raw.EVENTS.push({
    ...raw.EVENTS[0],
    id: 'test-team',
    people: ['test-person', 'test-other'],
  });
  const mapped = mapEvidenceSeed(raw);
  expect(mapped.events.map((e) => e.id)).toEqual(['test-event']);
  expect(mapped.gaps).toContainEqual(
    expect.objectContaining({
      recordId: 'test-team',
      missing: ['individualContribution'],
    }),
  );
});
it('does not collapse multiple raters into an invented aggregate confirmation', () => {
  const raw = input();
  const event = {
    ...raw.EVENTS[0],
    scores: [
      {
        p: 'test-person',
        d: 'test-dimension',
        st: 'conflict',
        v: null,
        raters: [
          { by: 'test-evaluator', v: 4 },
          { by: 'test-other', v: 2 },
        ],
        ai: 3,
      },
    ],
  };
  const mapped = mapEvidenceSeed({ ...raw, EVENTS: [event] });
  expect(mapped.confirmations).toEqual([]);
  expect(
    mapped.gaps.filter((g) => g.recordId.includes('/scores/')),
  ).toHaveLength(3);
});
it('rejects duplicate identities, invalid dimensions and score ranges before import', () => {
  const raw = input();
  expect(() =>
    mapEvidenceSeed({ ...raw, EVENTS: [raw.EVENTS[0], raw.EVENTS[0]] }),
  ).toThrow(/duplicate/);
  expect(() =>
    mapEvidenceSeed({
      ...raw,
      EVENTS: [
        { ...raw.EVENTS[0], scores: [{ ...raw.EVENTS[0].scores[0], v: 0 }] },
      ],
    }),
  ).toThrow();
  expect(() =>
    mapEvidenceSeed({
      ...raw,
      EVENTS: [
        {
          ...raw.EVENTS[0],
          scores: [{ ...raw.EVENTS[0].scores[0], d: 'missing' }],
        },
      ],
    }),
  ).toThrow(/dimension/);
});
it('reports a missing evaluator and missing conflict raters without inventing confirmations', () => {
  const raw = input();
  const mapped = mapEvidenceSeed({
    ...raw,
    EVENTS: [
      {
        ...raw.EVENTS[0],
        scores: [
          { p: 'test-person', d: 'test-dimension', st: 'conflict', v: null },
          { p: 'test-person', d: 'test-dimension', st: 'confirmed', v: 3 },
        ],
      },
    ],
  });
  expect(
    mapped.gaps.filter((g) => g.missing.includes('evaluatorId')),
  ).toHaveLength(2);
  expect(mapped.confirmations).toEqual([]);
});
it('rejects numeric unknown and unrelated score subjects and does not silently supply missing anchors', () => {
  const raw = input();
  expect(() =>
    mapEvidenceSeed({
      ...raw,
      EVENTS: [
        {
          ...raw.EVENTS[0],
          scores: [{ ...raw.EVENTS[0].scores[0], st: 'unknown' }],
        },
      ],
    }),
  ).toThrow(/unknown score has value/);
  expect(() =>
    mapEvidenceSeed({
      ...raw,
      EVENTS: [
        {
          ...raw.EVENTS[0],
          scores: [{ ...raw.EVENTS[0].scores[0], p: 'test-unrelated' }],
        },
      ],
    }),
  ).toThrow(/score subject/);
  expect(() => mapEvidenceSeed({ ...raw, ANCHORS: undefined })).toThrow(
    /missing anchors/,
  );
  expect(mapEvidenceSeed({}).ruleVersions).toEqual([]);
});
it('preserves independent event identities and gaps when SBI or subjects are incomplete', () => {
  const raw = input();
  const mapped = mapEvidenceSeed({
    ...raw,
    EVENTS: [
      raw.EVENTS[0],
      {
        ...raw.EVENTS[0],
        id: 'test-other-event',
        people: ['test-other'],
        scores: [],
      },
      { ...raw.EVENTS[0], id: 'test-no-sbi', bg: undefined, scores: [] },
      { ...raw.EVENTS[0], id: 'test-no-person', people: [], scores: [] },
    ],
  });
  expect(mapped.events.map((e) => e.id)).toEqual([
    'test-event',
    'test-other-event',
  ]);
  expect(mapped.gaps).toContainEqual({
    recordId: 'test-no-sbi',
    missing: ['SBI', 'ruleVersionId'],
  });
  expect(mapped.gaps).toContainEqual({
    recordId: 'test-no-person',
    missing: ['individualContribution'],
  });
});
