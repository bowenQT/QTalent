import { describe, expect, it } from 'vitest';
import {
  materialSourceLocationSchema,
  sourceLocationSchema,
} from '../../../../contracts/sources';
import {
  decodeCanonicalLocation,
  encodeCanonicalLocation,
  MaterialLocationError,
  parseCanonicalLocation,
  type CanonicalSourceLocation,
} from './location-codec';

const codeLocation = {
  kind: 'code',
  repository: ' 演示仓库🧪 ',
  commit: '0123456789abcdef0123456789abcdef01234567',
  path: '源码/演示🧪.ts',
  startLine: 1,
  endLine: 1,
} satisfies CanonicalSourceLocation;

const locations = [
  { kind: 'document', paragraph: ' 段落🧪一\n' },
  { kind: 'document', page: 2, paragraph: '段落二' },
  { kind: 'spreadsheet', sheet: ' 工作表🧪 ', cell: ' A1:B2 ' },
  { kind: 'recording', startMs: 0, endMs: 1 },
  { kind: 'snapshot_field', fieldPath: '演示🧪.字段[0]' },
  {
    kind: 'snapshot_field',
    fieldPath: ' 演示🧪.字段[0] ',
    originalLocation: ' 原始位置🧪\n',
  },
  { kind: 'pdf', page: 1, textRange: { start: 0, end: 2 } },
  { kind: 'presentation', slide: 1 },
  { kind: 'video', startMs: 0, endMs: 2 },
  {
    kind: 'image',
    region: {
      left: 0.12345678901234566,
      top: Number.MIN_VALUE,
      right: 0.9876543210987654,
      bottom: 1,
    },
  },
  codeLocation,
] satisfies CanonicalSourceLocation[];

function reverseKeys(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, entry]) => [key, reverseKeys(entry)]),
    );
  }
  return value;
}

function expectInvalid(operation: () => unknown) {
  let caught: unknown;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(MaterialLocationError);
  expect(caught).toMatchObject({
    name: 'MaterialLocationError',
    code: 'invalid_location',
    message: 'invalid_location',
  });
  expect(caught).not.toHaveProperty('cause');
  expect(caught).not.toHaveProperty('issues');
  expect(caught).not.toHaveProperty('input');
}

describe('canonical source location codec', () => {
  it.each(locations)('losslessly round-trips $kind JSON', (location) => {
    const input: unknown = JSON.parse(JSON.stringify(location));
    expect(parseCanonicalLocation(input)).toStrictEqual(location);
    const encoded = encodeCanonicalLocation(input);
    expect(JSON.parse(encoded)).toStrictEqual(location);
    expect(decodeCanonicalLocation(encoded)).toStrictEqual(location);
    expect(encodeCanonicalLocation(decodeCanonicalLocation(encoded))).toBe(
      encoded,
    );
    expect(input).toStrictEqual(location);
  });

  it.each(locations)('uses schema key order for $kind', (location) => {
    expect(encodeCanonicalLocation(reverseKeys(location))).toBe(
      encodeCanonicalLocation(location),
    );
  });

  it('encodes nested keys in a fixed order without guessing optional fields', () => {
    expect(
      encodeCanonicalLocation({
        textRange: { end: 2, start: 0 },
        page: 1,
        kind: 'pdf',
      }),
    ).toBe('{"kind":"pdf","page":1,"textRange":{"start":0,"end":2}}');
    expect(
      encodeCanonicalLocation({ paragraph: '段落', kind: 'document' }),
    ).toBe('{"kind":"document","paragraph":"段落"}');
  });

  it('keeps snapshot fields as legacy storage, not material-success locations', () => {
    const location = { kind: 'snapshot_field', fieldPath: '演示.字段' };
    expect(sourceLocationSchema.safeParse(location).success).toBe(true);
    expect(materialSourceLocationSchema.safeParse(location).success).toBe(
      false,
    );
    expect(
      decodeCanonicalLocation(encodeCanonicalLocation(location)),
    ).toStrictEqual(location);
  });

  it('validates PDF numeric shape without claiming source text bounds', () => {
    // No page text is supplied; versioned projection must check length and
    // surrogate-pair boundaries before resolving this locator to an excerpt.
    const location = {
      kind: 'pdf',
      page: 1,
      textRange: { start: 1, end: 999 },
    };
    expect(parseCanonicalLocation(location)).toStrictEqual(location);
  });

  const invalidLocations: [string, unknown][] = [
    ['null', null],
    ['array', []],
    ['number', 1],
    ['boolean', false],
    ['JSON string instead of object', '{"kind":"presentation","slide":1}'],
    ['missing kind', { slide: 1 }],
    ['unknown kind', { kind: 'unknown', slide: 1 }],
    [
      'case-changed kind',
      { kind: 'PDF', page: 1, textRange: { start: 0, end: 1 } },
    ],
    ['untrimmed kind', { kind: ' document', paragraph: '段落' }],
    ['missing required field', { kind: 'document' }],
    ['empty paragraph', { kind: 'document', paragraph: '' }],
    ['blank paragraph', { kind: 'document', paragraph: ' \n\t' }],
    ['null optional page', { kind: 'document', paragraph: '段落', page: null }],
    ['zero document page', { kind: 'document', paragraph: '段落', page: 0 }],
    [
      'fractional document page',
      { kind: 'document', paragraph: '段落', page: 1.5 },
    ],
    ['empty sheet', { kind: 'spreadsheet', sheet: '', cell: 'A1' }],
    ['blank cell', { kind: 'spreadsheet', sheet: '演示', cell: ' ' }],
    ['blank field path', { kind: 'snapshot_field', fieldPath: ' ' }],
    [
      'empty original location',
      { kind: 'snapshot_field', fieldPath: '演示', originalLocation: '' },
    ],
    [
      'null original location',
      { kind: 'snapshot_field', fieldPath: '演示', originalLocation: null },
    ],
    ['negative audio start', { kind: 'recording', startMs: -1, endMs: 1 }],
    ['empty audio range', { kind: 'recording', startMs: 1, endMs: 1 }],
    ['reversed audio range', { kind: 'recording', startMs: 2, endMs: 1 }],
    ['fractional audio time', { kind: 'recording', startMs: 0, endMs: 1.5 }],
    [
      'zero PDF page',
      { kind: 'pdf', page: 0, textRange: { start: 0, end: 1 } },
    ],
    [
      'negative text start',
      { kind: 'pdf', page: 1, textRange: { start: -1, end: 1 } },
    ],
    [
      'empty text range',
      { kind: 'pdf', page: 1, textRange: { start: 1, end: 1 } },
    ],
    [
      'reversed text range',
      { kind: 'pdf', page: 1, textRange: { start: 2, end: 1 } },
    ],
    [
      'fractional text offset',
      { kind: 'pdf', page: 1, textRange: { start: 0, end: 1.5 } },
    ],
    ['negative slide', { kind: 'presentation', slide: -1 }],
    ['zero slide', { kind: 'presentation', slide: 0 }],
    ['fractional slide', { kind: 'presentation', slide: 1.5 }],
    ['numeric string', { kind: 'presentation', slide: '1' }],
    ['negative video start', { kind: 'video', startMs: -1, endMs: 1 }],
    ['empty video range', { kind: 'video', startMs: 0, endMs: 0 }],
    ['reversed video range', { kind: 'video', startMs: 2, endMs: 1 }],
    ['fractional video time', { kind: 'video', startMs: 0.5, endMs: 1 }],
    [
      'negative image coordinate',
      { kind: 'image', region: { left: -0.1, top: 0, right: 1, bottom: 1 } },
    ],
    [
      'image outside original',
      { kind: 'image', region: { left: 0, top: 0, right: 1.1, bottom: 1 } },
    ],
    [
      'empty image width',
      { kind: 'image', region: { left: 0, top: 0, right: 0, bottom: 1 } },
    ],
    [
      'reversed image height',
      { kind: 'image', region: { left: 0, top: 1, right: 1, bottom: 0 } },
    ],
    ['blank repository', { ...codeLocation, repository: ' ' }],
    ['abbreviated commit', { ...codeLocation, commit: '0123456' }],
    [
      'uppercase commit',
      { ...codeLocation, commit: codeLocation.commit.toUpperCase() },
    ],
    ['nonhex commit', { ...codeLocation, commit: 'g'.repeat(40) }],
    ['zero code line', { ...codeLocation, startLine: 0 }],
    ['reversed code range', { ...codeLocation, startLine: 2, endLine: 1 }],
    ['fractional code line', { ...codeLocation, endLine: 1.5 }],
  ];

  it.each(invalidLocations)(
    'rejects %s at every boundary',
    (_label, location) => {
      expectInvalid(() => parseCanonicalLocation(location));
      expectInvalid(() => encodeCanonicalLocation(location));
      expectInvalid(() => decodeCanonicalLocation(JSON.stringify(location)));
    },
  );

  it.each([
    '',
    ' ',
    '/src/a.ts',
    '../a.ts',
    'src/../a.ts',
    './a.ts',
    'src/./a.ts',
    'src//a.ts',
    'src/',
    'src\\a.ts',
    'src/\0a.ts',
  ])('rejects invalid code path %j', (path) => {
    const location = { ...codeLocation, path };
    expectInvalid(() => encodeCanonicalLocation(location));
    expectInvalid(() => decodeCanonicalLocation(JSON.stringify(location)));
  });

  it.each(locations)('rejects extra top-level fields on $kind', (location) => {
    expectInvalid(() =>
      encodeCanonicalLocation({ ...location, extra: 'private-input' }),
    );
  });

  it.each([
    { kind: 'pdf', page: 1, textRange: { start: 0, end: 1, extra: true } },
    {
      kind: 'image',
      region: { left: 0, top: 0, right: 1, bottom: 1, extra: true },
    },
  ])('rejects extra nested fields on $kind', (location) => {
    expectInvalid(() => decodeCanonicalLocation(JSON.stringify(location)));
  });

  it.each([NaN, Infinity, -Infinity])(
    'rejects nonfinite number %s',
    (value) => {
      for (const location of [
        { kind: 'document', paragraph: '段落', page: value },
        { kind: 'recording', startMs: 0, endMs: value },
        { kind: 'pdf', page: 1, textRange: { start: 0, end: value } },
        { kind: 'presentation', slide: value },
        { kind: 'video', startMs: value, endMs: 1 },
        { kind: 'image', region: { left: 0, top: 0, right: value, bottom: 1 } },
        { ...codeLocation, startLine: value },
      ]) {
        expectInvalid(() => parseCanonicalLocation(location));
        expectInvalid(() => encodeCanonicalLocation(location));
      }
    },
  );

  it.each([
    '',
    '{',
    'undefined',
    '{"kind":"presentation","slide":1,}',
    '{"kind":"presentation","slide":NaN}',
    '{"kind":"presentation","slide":Infinity}',
    '{"kind":"presentation","slide":1e400}',
    '{"kind":"presentation","slide":1} trailing-private-input',
  ])('rejects malformed or nonfinite encoded JSON %j safely', (encoded) =>
    expectInvalid(() => decodeCanonicalLocation(encoded)),
  );

  it('does not leak input or thrown input-access details', () => {
    expectInvalid(() => parseCanonicalLocation(undefined));
    expectInvalid(() =>
      parseCanonicalLocation({
        get kind() {
          throw new Error('private-input');
        },
      }),
    );
  });
});
