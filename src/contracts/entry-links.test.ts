import { describe, expect, it } from 'vitest';
import {
  buildEntryDeepLink,
  parseEntryDeepLink,
  safeEntryReturnTo,
  entryLinkTargetSchema,
} from './entry-links';

describe('ordinary entry links', () => {
  it.each(['material_batch', 'staffing_demand'] as const)(
    'round trips only %s metadata',
    (kind) => {
      const target = { kind, id: 'demo-object:1', expectedRevision: 2 };
      const href = buildEntryDeepLink(target);
      expect(parseEntryDeepLink(href)).toEqual(target);
      expect(safeEntryReturnTo(href)).toBe(href);
      expect([
        ...new URL(href, 'https://demo.invalid').searchParams.keys(),
      ]).toEqual(['kind', 'id', 'expectedRevision']);
    },
  );
  it.each([
    'https://evil.invalid/entry/open?kind=material_batch&id=demo&expectedRevision=1',
    '//evil.invalid/entry/open?kind=material_batch&id=demo&expectedRevision=1',
    '/entry/open\\evil?kind=material_batch&id=demo&expectedRevision=1',
    '/entry/open?kind=material_batch&id=demo&expectedRevision=1#score',
    '/entry/open?kind=material_batch&id=demo&expectedRevision=1&token=secret',
    '/entry/open?kind=material_batch&id=demo&expectedRevision=1&id=other',
    '/entry/open?kind=material_batch&id=demo&expectedRevision=01',
    '/entry/open?kind=material_batch&id=demo&expectedRevision=0',
    '/entry/open?kind=person&id=demo&expectedRevision=1',
    '/entry/open?kind=material_batch&id=%2f%2fevil&expectedRevision=1',
    '/entry/open?kind=material_batch&id=demo%0Asecret&expectedRevision=1',
    '/entry/open?kind=material_batch&id=demo&expectedRevision=1\n',
    '/entry/open?kind=material_batch&expectedRevision=1&id=demo',
    '/%65ntry/open?kind=material_batch&id=demo&expectedRevision=1',
    '/entry/open?kind=material_batch&id=demo',
    '/entry/open?kind=material_batch&id=demo&expectedRevision=1&next=//evil',
    null,
    1,
    {},
    'x'.repeat(1001),
  ])('rejects unsafe/noncanonical return %j', (href) => {
    expect(parseEntryDeepLink(href)).toBeNull();
    expect(safeEntryReturnTo(href)).toBe('/');
  });
  it('refuses credentials, scores, text and unversioned targets', () => {
    const base = {
      kind: 'material_batch' as const,
      id: 'demo',
      expectedRevision: 1,
    };
    for (const extra of [
      { token: 'synthetic' },
      { score: 4 },
      { text: '演示' },
    ])
      expect(
        entryLinkTargetSchema.safeParse({ ...base, ...extra }).success,
      ).toBe(false);
    expect(() =>
      buildEntryDeepLink({ ...base, expectedRevision: Infinity }),
    ).toThrow();
  });
});
