import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { materialSourceSchema } from '../../../../contracts/sources';
import {
  MaterialProjectionError,
  projectAttachmentPdf,
  projectPdfParse,
  verifyPdfParse,
} from './projection';

const sha256 = (text: string) =>
  createHash('sha256').update(text, 'utf8').digest('hex');
const binding = {
  parseVersionId: 'demo-parse-v1',
  originalVersionId: 'demo-original-v1',
  contentDigest: sha256('synthetic PDF bytes; not a parsed real PDF'),
  parserVersion: 'synthetic-test-parser-v1',
  projectionVersion: 'synthetic-test-page-text-v1',
};
function fixture() {
  return {
    binding: { ...binding },
    pages: [
      { page: 1, text: '甲😀乙\r\n 演示正文 ' },
      { page: 2, text: '' },
      { page: 3, text: '第二段演示' },
    ],
    fragments: [
      {
        fragmentId: 'demo-fragment-a',
        originalVersionId: binding.originalVersionId,
        location: {
          kind: 'pdf' as const,
          page: 1,
          textRange: { start: 1, end: 3 },
        },
        excerpt: '😀',
        demo: true,
        sourceCategory: 'original' as const,
      },
      {
        fragmentId: 'demo-fragment-b',
        originalVersionId: binding.originalVersionId,
        location: {
          kind: 'pdf' as const,
          page: 3,
          textRange: { start: 0, end: 5 },
        },
        excerpt: '第二段演示',
        demo: true,
        sourceCategory: 'original' as const,
      },
    ],
  };
}
function invalid(operation: () => unknown) {
  expect(operation).toThrow(MaterialProjectionError);
  try {
    operation();
  } catch (error) {
    expect(error).toMatchObject({
      code: 'invalid_pdf_projection',
      message: 'invalid_pdf_projection',
    });
    expect(error).not.toHaveProperty('cause');
    expect(error).not.toHaveProperty('input');
    expect(error).not.toHaveProperty('issues');
  }
}

describe('versioned PDF page projection (explicit synthetic input)', () => {
  it('keeps physical blank pages, exact text, source identities and contract locations', () => {
    const input = fixture();
    const result = projectPdfParse(input, binding);
    expect(result.binding).toEqual(binding);
    expect(result.pages.map(({ page, text }) => ({ page, text }))).toEqual(
      input.pages,
    );
    expect(result.pages[0].textDigest).toBe(sha256(input.pages[0].text));
    expect(result.pages[1].textDigest).toBe(sha256(''));
    expect(result.fragments).toEqual(input.fragments);
    for (const source of result.fragments) {
      expect(materialSourceSchema.parse(source)).toEqual(source);
      const page = result.pages.find(
        (page) => page.page === source.location.page,
      )!;
      expect(
        page.text.slice(
          source.location.textRange.start,
          source.location.textRange.end,
        ),
      ).toBe(source.excerpt);
    }
    expect(verifyPdfParse(JSON.parse(JSON.stringify(result)), binding)).toEqual(
      result,
    );
    expect(input).toEqual(fixture());
  });

  it('is deterministic across input key and row ordering without renumbering pages or fragments', () => {
    const input = fixture();
    const first = projectPdfParse(input, binding);
    input.pages.reverse();
    input.fragments.reverse();
    input.binding = Object.fromEntries(
      Object.entries(binding).reverse(),
    ) as typeof binding;
    expect(projectPdfParse(input, binding)).toEqual(first);
  });

  it('preserves repeated text at distinct real positions and explicit historical provenance', () => {
    const input = fixture();
    input.pages[0].text = '演示 演示';
    const original = {
      ...input.fragments[0],
      excerpt: '演示',
      location: {
        kind: 'pdf' as const,
        page: 1,
        textRange: { start: 0, end: 2 },
      },
    };
    const historical = {
      ...original,
      fragmentId: 'demo-history',
      sourceCategory: 'historical_evaluation',
      evaluationKind: 'interview',
      location: { ...original.location, textRange: { start: 3, end: 5 } },
    };
    const result = projectPdfParse(
      { ...input, fragments: [original, historical] },
      binding,
    );
    expect(
      result.fragments.find((source) => source.fragmentId === 'demo-history'),
    ).toEqual(historical);
    expect(
      result.fragments.find(
        (source) => source.fragmentId === 'demo-fragment-a',
      ),
    ).toEqual(original);
  });

  it.each(Object.keys(binding) as (keyof typeof binding)[])(
    'rejects a mismatched %s from independently loaded binding',
    (key) => {
      const other = {
        ...binding,
        [key]: key === 'contentDigest' ? 'b'.repeat(64) : 'other-version',
      };
      invalid(() => projectPdfParse(fixture(), other));
      invalid(() => verifyPdfParse(projectPdfParse(fixture(), binding), other));
    },
  );

  it.each([
    [1, 2, '\ud83d'],
    [2, 3, '\ude00'],
    [0, 2, '甲\ud83d'],
    [2, 4, '\ude00乙'],
    [1, 999, '😀'],
    [3, 3, ''],
    [-1, 1, '甲'],
    [1.5, 3, '😀'],
    [0, 1, 'different private excerpt'],
  ])('rejects incorrect or split UTF-16 span %s..%s', (start, end, excerpt) => {
    const input = fixture();
    invalid(() =>
      projectPdfParse(
        {
          ...input,
          fragments: [
            {
              ...input.fragments[0],
              excerpt,
              location: { kind: 'pdf', page: 1, textRange: { start, end } },
            },
          ],
        },
        binding,
      ),
    );
  });

  it('does not trim, normalize line endings or search for a nearby matching quote', () => {
    const input = fixture();
    input.fragments[0] = {
      ...input.fragments[0],
      excerpt: '\r\n 演示正文 ',
      location: {
        kind: 'pdf',
        page: 1,
        textRange: { start: 4, end: input.pages[0].text.length },
      },
    };
    expect(projectPdfParse(input, binding).fragments[0].excerpt).toBe(
      '\r\n 演示正文 ',
    );
    input.fragments[0].excerpt = '\n 演示正文 ';
    invalid(() => projectPdfParse(input, binding));
  });

  it.each(['\ud800', '\udc00', 'a\ud800b', '\ud800\ud800'])(
    'rejects malformed page Unicode without replacement-character hashing: %j',
    (text) => {
      const input = fixture();
      input.pages[1].text = text;
      invalid(() => projectPdfParse(input, binding));
    },
  );

  it.each([
    'page',
    'fragment',
    'original',
    'kind',
    'extra',
    'missing-page',
    'duplicate-page',
    'duplicate-fragment',
    'empty-fragments',
    'empty-pages',
    'version',
    'digest',
  ])('fails closed for %s inconsistency', (kind) => {
    const input = fixture();
    let value: unknown = input;
    if (kind === 'page') input.fragments[0].location.page = 4;
    if (kind === 'fragment') input.fragments[0].fragmentId = ' ';
    if (kind === 'original')
      input.fragments[0].originalVersionId = 'other-original';
    if (kind === 'kind')
      value = {
        ...input,
        fragments: [
          {
            ...input.fragments[0],
            location: { kind: 'document', page: 1, paragraph: 'pdf:items:0-1' },
          },
        ],
      };
    if (kind === 'extra') value = { ...input, extra: 'private input' };
    if (kind === 'missing-page') input.pages.splice(1, 1);
    if (kind === 'duplicate-page') input.pages.push({ ...input.pages[0] });
    if (kind === 'duplicate-fragment')
      input.fragments.push({ ...input.fragments[0] });
    if (kind === 'empty-fragments') input.fragments = [];
    if (kind === 'empty-pages') input.pages = [];
    if (kind === 'version') input.binding.projectionVersion = ' ';
    if (kind === 'digest') input.binding.contentDigest = 'not-sha256';
    invalid(() => projectPdfParse(value, binding));
  });

  it.each(['page-text', 'page-digest', 'result-digest', 'fragment', 'extra'])(
    'detects stored %s corruption',
    (kind) => {
      const result = projectPdfParse(fixture(), binding);
      let value: unknown = result;
      if (kind === 'page-text') result.pages[1].text = 'tampered unused page';
      if (kind === 'page-digest') result.pages[0].textDigest = 'f'.repeat(64);
      if (kind === 'result-digest') result.resultDigest = 'f'.repeat(64);
      if (kind === 'fragment')
        result.fragments[0].fragmentId = 'tampered-identity';
      if (kind === 'extra') value = { ...result, extra: true };
      invalid(() => verifyPdfParse(value, binding));
    },
  );

  it('binds deterministic digest to all page text and all provenance, including unused pages', () => {
    const input = fixture();
    const old = projectPdfParse(input, binding);
    input.pages[1].text = 'new page fact';
    expect(projectPdfParse(input, binding).resultDigest).not.toBe(
      old.resultDigest,
    );
    input.pages[1].text = '';
    input.fragments[0].demo = false;
    expect(projectPdfParse(input, binding).resultDigest).not.toBe(
      old.resultDigest,
    );
    const changedBinding = { ...binding, projectionVersion: 'synthetic-v2' };
    expect(
      projectPdfParse({ ...fixture(), binding: changedBinding }, changedBinding)
        .resultDigest,
    ).not.toBe(old.resultDigest);
  });

  it('does not expose parser or input-access errors', () => {
    invalid(() =>
      projectPdfParse(
        {
          get binding() {
            throw new Error('private-text');
          },
        },
        binding,
      ),
    );
    invalid(() => verifyPdfParse(null, binding));
  });
});

describe('866 page-text adapter (frozen interface, synthetic producer bundle)', () => {
  const expected = { ...binding, projectionVersion: 'pdf-page-text-v1' };
  function attachment() {
    const input = fixture();
    return {
      status: 'parsed',
      parseVersionId: binding.parseVersionId,
      originalVersionId: binding.originalVersionId,
      sha256: binding.contentDigest,
      parserVersion: binding.parserVersion,
      fragments: input.fragments.map((fragment) => ({
        fragmentId: fragment.fragmentId,
        originalVersionId: fragment.originalVersionId,
        excerpt: fragment.excerpt,
        location: {
          kind: 'document',
          page: fragment.location.page,
          paragraph: 'pdf:items:0-99',
        },
      })),
      pdfText: {
        version: 'pdf-page-text-v1',
        pages: input.pages,
        ranges: input.fragments.map((fragment) => ({
          fragmentId: fragment.fragmentId,
          page: fragment.location.page,
          textRange: fragment.location.textRange,
        })),
      },
    };
  }
  const original = { sourceCategory: 'original', demo: true };

  it('joins by fragment identity, retains producer identities and uses real ranges rather than item indices', () => {
    const input = attachment();
    input.pdfText.ranges.reverse();
    const result = projectAttachmentPdf(input, expected, original);
    expect(result.fragments).toEqual(fixture().fragments);
    expect(result.binding.parseVersionId).toBe(input.parseVersionId);
    expect(result.binding.projectionVersion).toBe('pdf-page-text-v1');
    expect(verifyPdfParse(result, expected)).toEqual(result);
  });

  it('keeps historical interview provenance only when explicitly supplied by server context', () => {
    const result = projectAttachmentPdf(attachment(), expected, {
      sourceCategory: 'historical_evaluation',
      evaluationKind: 'interview',
      demo: false,
    });
    for (const source of result.fragments)
      expect(source).toMatchObject({
        sourceCategory: 'historical_evaluation',
        evaluationKind: 'interview',
        demo: false,
      });
    invalid(() => projectAttachmentPdf(attachment(), expected, undefined));
    invalid(() =>
      projectAttachmentPdf(attachment(), expected, {
        sourceCategory: 'prototype_baseline',
        demo: true,
      }),
    );
  });

  it.each([
    'missing',
    'unknown-version',
    'missing-range',
    'extra-range',
    'duplicate-range',
    'wrong-fragment',
    'wrong-page',
    'wrong-original',
    'old-mode',
    'unbound-original',
    'wrong-digest',
    'wrong-parser',
    'wrong-parse',
  ])('rejects %s without old-item fallback', (kind) => {
    const input = attachment();
    let value: unknown = input;
    if (kind === 'missing') value = { ...input, pdfText: undefined };
    if (kind === 'unknown-version') input.pdfText.version = 'unknown';
    if (kind === 'missing-range') input.pdfText.ranges.pop();
    if (kind === 'extra-range')
      input.pdfText.ranges.push({
        ...input.pdfText.ranges[0],
        fragmentId: 'extra',
      });
    if (kind === 'duplicate-range')
      input.pdfText.ranges[1] = { ...input.pdfText.ranges[0] };
    if (kind === 'wrong-fragment')
      input.pdfText.ranges[0].fragmentId = 'unknown';
    if (kind === 'wrong-page') input.fragments[0].location.page = 3;
    if (kind === 'wrong-original')
      input.fragments[0].originalVersionId = 'other';
    if (kind === 'old-mode') input.fragments[0].location.kind = 'recording';
    if (kind === 'unbound-original') input.originalVersionId = 'other';
    if (kind === 'wrong-digest') input.sha256 = 'e'.repeat(64);
    if (kind === 'wrong-parser') input.parserVersion = 'other';
    if (kind === 'wrong-parse') input.parseVersionId = 'other';
    invalid(() => projectAttachmentPdf(value, expected, original));
  });
});
