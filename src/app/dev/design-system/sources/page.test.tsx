// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { sourceHref } from '@/features/sources/source-href';
import SourcesDesignSystem from './page';
import SourceViewerSample from './view/page';
import { SAMPLE_VIEW, findSample, sample, sampleKeys } from './samples';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not-found');
  },
}));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubEnv('NODE_ENV', 'development');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const params = (value: Record<string, string>) => ({
  searchParams: Promise.resolve(value),
});

describe('source viewer samples', () => {
  it('covers the six location kinds, code, the baseline and originals that stay closed', () => {
    expect(sampleKeys).toEqual([
      'document',
      'pdf',
      'spreadsheet',
      'presentation',
      'recording',
      'video',
      'image',
      'code',
      'baseline',
      'pdf-pending',
      'image-pending',
      'pdf-restricted',
      'image-restricted',
      'image-failed',
    ]);
    expect(sample('code').source.provenance).toEqual({
      kind: 'submitted_code_snapshot',
      notice: '提交的代码快照',
    });
    expect(() => sample('missing')).toThrow('Unknown source sample');
    expect(
      findSample({ fragmentId: 'demo-frag-pdf', originalVersionId: 'other' }),
    ).toBeNull();
  });

  it('links the three entries to one address, and every kind to its own', () => {
    render(<SourcesDesignSystem />);
    const entries = document.querySelector('[data-sample="entries"]')!;
    const links = within(entries as HTMLElement)
      .getAllByRole('link', { name: '查看原件' })
      .map((a) => a.getAttribute('href'));
    expect(links).toEqual(
      Array(3).fill(sourceHref(sample('document').source, SAMPLE_VIEW)),
    );
    const kinds = document.querySelectorAll('[data-sample="kinds"] li');
    expect(kinds).toHaveLength(sampleKeys.length);
    const locked = document.querySelector('[data-sample="locked"]')!;
    expect(
      within(locked as HTMLElement).queryByRole('link', { name: '查看原件' }),
    ).toBeNull();
  });

  it('opens a sample by its identifiers and locates the cited place', async () => {
    const { source } = sample('spreadsheet');
    render(
      await SourceViewerSample(
        params({
          fragment: source.fragmentId,
          version: source.originalVersionId,
        }),
      ),
    );
    expect(
      document.querySelector('[aria-current="location"]')?.textContent,
    ).toBe(source.excerpt);
  });

  it('shows the invalid-link page for an unknown or incomplete address', async () => {
    render(
      await SourceViewerSample(
        params({ fragment: 'demo-frag-locked', version: 'demo-ver-locked' }),
      ),
    );
    expect(screen.getByRole('heading', { name: '原件链接失效' })).toBeTruthy();
    cleanup();
    render(await SourceViewerSample(params({ fragment: 'demo-frag-pdf' })));
    expect(screen.getByRole('heading', { name: '原件链接失效' })).toBeTruthy();
  });

  it('is absent from production builds', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => SourcesDesignSystem()).toThrow('not-found');
    await expect(SourceViewerSample(params({}))).rejects.toThrow('not-found');
  });
});
