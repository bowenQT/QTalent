import { describe, expect, it } from 'vitest';
import { prepareMaterialParse, MaterialStoreError } from './store';

const binding = {
  parseVersionId: 'demo-parse',
  originalVersionId: 'demo-version',
  contentDigest: 'a'.repeat(64),
  parserVersion: 'synthetic-v1',
  projectionVersion: 'synthetic-v1',
};
const source = {
  fragmentId: 'demo-fragment',
  originalVersionId: binding.originalVersionId,
  sourceCategory: 'original',
  demo: true,
  excerpt: '演示原文',
  location: { kind: 'presentation', slide: 1 },
};
describe('material publication boundary', () => {
  it('normalizes object key order and requires explicit server provenance', () => {
    const input = { binding, fragments: [source], pages: [] };
    const expected = prepareMaterialParse(input);
    expect(
      prepareMaterialParse({
        pages: [],
        fragments: [
          { ...source, location: { slide: 1, kind: 'presentation' } },
        ],
        binding: Object.fromEntries(Object.entries(binding).reverse()),
      }),
    ).toEqual(expected);
    const withoutCategory = { ...source, sourceCategory: undefined };
    expect(() =>
      prepareMaterialParse({ ...input, fragments: [withoutCategory] }),
    ).toThrow(MaterialStoreError);
    expect(() =>
      prepareMaterialParse({
        ...input,
        fragments: [{ ...source, demo: undefined }],
      }),
    ).toThrow(MaterialStoreError);
  });
  it('rejects pages that do not belong to any PDF projection and baseline inference', () => {
    expect(() =>
      prepareMaterialParse({
        binding,
        fragments: [source],
        pages: [{ page: 1, text: 'orphan text' }],
      }),
    ).toThrow(MaterialStoreError);
    expect(() =>
      prepareMaterialParse({
        binding,
        fragments: [
          {
            ...source,
            sourceCategory: 'prototype_baseline',
            location: { kind: 'snapshot_field', fieldPath: 'demo' },
          },
        ],
        pages: [],
      }),
    ).toThrow(MaterialStoreError);
  });
  it('retains an original historical interview scale without turning it into an ordinary evaluation', () => {
    const input = {
      binding,
      fragments: [
        {
          ...source,
          sourceCategory: 'historical_evaluation',
          evaluationKind: 'interview',
          excerpt: 'S',
          location: { kind: 'pdf', page: 1, textRange: { start: 0, end: 1 } },
        },
      ],
      pages: [{ page: 1, text: 'S' }],
    };
    expect(prepareMaterialParse(input).fragments[0]).toEqual(
      input.fragments[0],
    );
    expect(() =>
      prepareMaterialParse({
        ...input,
        fragments: [
          {
            ...input.fragments[0],
            location: { kind: 'presentation', slide: 1 },
          },
        ],
      }),
    ).toThrow(MaterialStoreError);
  });
  it('rejects malformed boundary values without leaking their details', () => {
    for (const input of [
      null,
      { binding, fragments: [], pages: [] },
      {
        get binding() {
          throw new Error('private-content');
        },
      },
    ]) {
      try {
        prepareMaterialParse(input);
        throw new Error('expected rejection');
      } catch (error) {
        expect(error).toMatchObject({
          name: 'MaterialStoreError',
          code: 'invalid_material_parse',
          message: 'invalid_material_parse',
        });
        expect(error).not.toHaveProperty('cause');
        expect(error).not.toHaveProperty('issues');
      }
    }
  });
});
