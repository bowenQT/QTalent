import { expect, it } from 'vitest';
import type { MaterialSourceReference } from '../../../contracts/sources';
import type { TalentSource } from '../../authz/talent';
import { resolveRecordSourceFacts } from './write-policy';

const reference: MaterialSourceReference = {
  fragmentId: 'fragment',
  originalVersionId: 'version',
  location: { kind: 'document', paragraph: '1' },
};
function fixture() {
  return {
    fragments: [
      {
        id: 'fragment',
        originalVersionId: 'version',
        location: reference.location,
        excerpt: '演示：原件中的逐字引文。',
      },
    ],
    versions: [{ id: 'version', originalId: 'original' }],
    originals: [{ id: 'original', kind: 'original' }],
    sources: [
      {
        ...reference,
        excerpt: '演示：原件中的逐字引文。',
        kind: 'evaluation',
        requiredKinds: ['restricted-evaluation', 'management-observation'],
        subjects: [
          { personId: 'one', cohortId: null, evaluationNodeId: 'node' },
          {
            personId: 'two',
            cohortId: 'cohort',
            evaluationNodeId: 'other-node',
          },
        ],
      },
    ] as TalentSource[],
  };
}
it('preserves every shared subject and sensitivity from the single source builder', () => {
  const data = fixture();
  expect(resolveRecordSourceFacts([reference], data)).toEqual([
    {
      reference,
      complete: true,
      excerpt: data.fragments[0].excerpt,
      kind: 'evaluation',
      requiredKinds: ['restricted-evaluation', 'management-observation'],
      subjects: [
        { personId: 'one', evaluationNodeId: 'node' },
        { personId: 'two', evaluationNodeId: 'other-node' },
      ],
    },
  ]);
});
it.each(['fragments', 'versions', 'originals', 'sources'] as const)(
  'does not fabricate missing %s',
  (key) => {
    const data = fixture();
    data[key] = [];
    expect(() => resolveRecordSourceFacts([reference], data)).toThrow(
      'immutable_source_missing',
    );
  },
);
it('checks the actual immutable version and locator', () => {
  const data = fixture();
  data.fragments[0].originalVersionId = 'another-version';
  expect(() => resolveRecordSourceFacts([reference], data)).toThrow(
    'immutable_source_missing',
  );
  expect(() =>
    resolveRecordSourceFacts(
      [{ ...reference, location: { kind: 'document', paragraph: 'forged' } }],
      fixture(),
    ),
  ).toThrow('source_locator_changed');
});
it('rejects a prototype snapshot at the formal confirmation boundary', () => {
  const data = fixture();
  data.originals[0].kind = 'prototype_snapshot';
  expect(() => resolveRecordSourceFacts([reference], data)).toThrow(
    'baseline_source_not_confirmable',
  );
});
it.each([null, undefined])(
  'never infers a missing node from a cohort (%s)',
  (evaluationNodeId) => {
    const data = fixture();
    data.sources[0].subjects[0].evaluationNodeId = evaluationNodeId;
    expect(resolveRecordSourceFacts([reference], data)[0]).toMatchObject({
      complete: false,
      subjects: [],
    });
  },
);
it('preserves an unknown/poisoned history as incomplete instead of adding draft subjects', () => {
  const data = fixture();
  data.sources[0].subjects = [];
  expect(resolveRecordSourceFacts([reference], data)[0]).toMatchObject({
    complete: false,
    subjects: [],
  });
});
it.each([
  { kind: 'recording', startMs: 0, endMs: 1000 },
  { kind: 'pdf', page: 1, textRange: { start: 0, end: 4 } },
  { kind: 'image', region: { left: 0, top: 0, right: 1, bottom: 1 } },
] satisfies MaterialSourceReference['location'][])(
  'keeps an unconnected material capability unavailable (%j)',
  (location) => {
    expect(() =>
      resolveRecordSourceFacts([{ ...reference, location }], fixture()),
    ).toThrow(
      location.kind === 'recording'
        ? 'speaker_binding_not_connected'
        : 'material_reader_not_connected',
    );
  },
);
it('does not use blank canonical text or a projected replacement quote', () => {
  const data = fixture();
  data.fragments[0].excerpt = '  ';
  expect(() => resolveRecordSourceFacts([reference], data)).toThrow(
    'immutable_source_missing',
  );
});
