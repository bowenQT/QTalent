import { describe, expect, it } from 'vitest';
import type { SourceReference } from '@/contracts/sources';
import { sourceHref, sourceReadInputFrom } from './source-href';

describe('sourceHref', () => {
  it('puts only the fragment and original version into the viewer address', () => {
    const reference: SourceReference = {
      fragmentId: 'frag-test-1',
      originalVersionId: 'ver-test-1',
      location: { kind: 'spreadsheet', sheet: '观察表', cell: 'C7' },
    };
    expect(sourceHref(reference)).toBe(
      '/sources?fragment=frag-test-1&version=ver-test-1',
    );
  });

  it('gives the same address whatever location the entry carries', () => {
    const ids = { fragmentId: 'frag-test-1', originalVersionId: 'ver-test-1' };
    expect(
      sourceHref({
        ...ids,
        location: { kind: 'document', paragraph: '3' },
      } as SourceReference),
    ).toBe(sourceHref(ids));
  });

  it('encodes identifiers and accepts another base for samples', () => {
    expect(
      sourceHref(
        { fragmentId: 'a&b c', originalVersionId: 'v/1?' },
        '/dev/design-system/sources/view',
      ),
    ).toBe('/dev/design-system/sources/view?fragment=a%26b+c&version=v%2F1%3F');
  });
});

describe('sourceReadInputFrom', () => {
  it('reads back what sourceHref wrote', () => {
    const ids = { fragmentId: 'a&b c', originalVersionId: 'v/1?' };
    const query = new URL(sourceHref(ids), 'http://x.test').searchParams;
    expect(
      sourceReadInputFrom({
        fragment: query.get('fragment') ?? undefined,
        version: query.get('version') ?? undefined,
      }),
    ).toEqual(ids);
  });

  it.each([
    ['missing version', { fragment: 'f' }],
    ['missing fragment', { version: 'v' }],
    ['repeated fragment', { fragment: ['f', 'g'], version: 'v' }],
    ['blank fragment', { fragment: '  ', version: 'v' }],
    ['empty version', { fragment: 'f', version: '' }],
  ])('treats a %s as an invalid link', (_, search) => {
    expect(sourceReadInputFrom(search)).toBeNull();
  });
});
