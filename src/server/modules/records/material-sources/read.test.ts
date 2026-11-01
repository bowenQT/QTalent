import { beforeEach, expect, it, vi } from 'vitest';
import type { Transaction } from '../../../db/client';
import { fixture } from '../../../queries/person-test-helpers';
import { talentSources } from '../../../queries/person-data';
import { materialSourceReadResultSchema } from '../../../../contracts/sources';
import { readAuthorizedMaterialSource } from './read';
import * as store from './store';

const tx = {} as Transaction;
const reference = { fragmentId: 'fragment-0', originalVersionId: 'version' };
function setup() {
  const data = fixture('manager');
  const source = {
    ...reference,
    location: {
      kind: 'pdf' as const,
      page: 1,
      textRange: { start: 0, end: 4 },
    },
    excerpt: '演示原文',
    demo: true,
    sourceCategory: 'original' as const,
  };
  Object.assign(data.fragments[0], {
    location: source.location,
    excerpt: source.excerpt,
  });
  const facts = { context: data.context, sources: talentSources(data) };
  const read = vi
    .spyOn(store, 'readMaterialFragment')
    .mockResolvedValue({
      source,
      binding: {
        parseVersionId: 'parse',
        originalVersionId: 'version',
        contentDigest: 'a'.repeat(64),
        parserVersion: 'parser',
        projectionVersion: 'pdf-page-text-v1',
      },
      resultDigest: 'b'.repeat(64),
    });
  return { data, facts, source, read };
}
beforeEach(() => vi.restoreAllMocks());
it('returns only final material source after existing shared-subject policy and canonical verification', async () => {
  const f = setup();
  const result = await readAuthorizedMaterialSource(tx, f.facts, reference);
  expect(result).toEqual({ status: 'success', source: f.source });
  expect(materialSourceReadResultSchema.parse(result)).toEqual(result);
  expect(f.read).toHaveBeenCalledExactlyOnceWith(
    tx,
    reference.fragmentId,
    reference.originalVersionId,
  );
  expect(result).not.toHaveProperty('binding');
});
it.each([
  null,
  {},
  { ...reference, location: { kind: 'pdf', page: 999 } },
  { ...reference, fragmentId: ' ' },
])(
  'rejects client locators or invalid identifiers without storage access: %j',
  async (input) => {
    const f = setup();
    expect(
      await readAuthorizedMaterialSource(tx, f.facts, input),
    ).toMatchObject({ status: 'validation_error', input: null });
    expect(f.read).not.toHaveBeenCalled();
  },
);
it.each([
  'empty',
  'unknown',
  'hidden-shared',
  'restricted',
  'revoked',
  'expired',
] as const)('does not inspect hidden canonical facts: %s', async (mode) => {
  const f = setup();
  const source = f.facts.sources[0]!;
  if (mode === 'empty') source.subjects = [];
  if (mode === 'unknown')
    source.subjects.push({ personId: 'unknown', cohortId: null });
  if (mode === 'hidden-shared') {
    source.subjects.push({ personId: 'two', cohortId: null });
    f.facts.context.people.find((p) => p.id === 'two')!.noReview = true;
  }
  if (mode === 'restricted') {
    source.requiredKinds = ['performance'];
    f.facts.context.grants[0].role = 'mentor';
  }
  if (mode === 'revoked') f.facts.context.grants[0].revokedAt = '2026-06-01';
  if (mode === 'expired') f.facts.context.grants[0].validTo = '2026-06-01';
  const result = await readAuthorizedMaterialSource(tx, f.facts, reference);
  expect(result).toEqual({
    status: 'not_found',
    message: '来源不存在或不可见',
  });
  expect(f.read).not.toHaveBeenCalled();
});
it.each(['missing', 'id', 'version', 'excerpt', 'location'] as const)(
  'refuses mismatched canonical material: %s',
  async (mode) => {
    const f = setup();
    if (mode === 'missing') f.read.mockResolvedValue(null);
    if (mode === 'id') f.source.fragmentId = 'different';
    if (mode === 'version') f.source.originalVersionId = 'different';
    if (mode === 'excerpt') f.source.excerpt = '另一原文';
    if (mode === 'location') f.source.location.page = 2;
    // The graph is a separately loaded projection, not an alias of the store result.
    f.facts.sources[0].location = {
      kind: 'pdf',
      page: 1,
      textRange: { start: 0, end: 4 },
    };
    expect(
      await readAuthorizedMaterialSource(tx, f.facts, reference),
    ).toMatchObject({ status: 'not_found' });
  },
);
it.each([
  'material_conflict',
  'invalid_material_parse',
  'storage_unavailable',
] as const)('sanitizes store failure %s', async (code) => {
  const f = setup();
  f.read.mockRejectedValue(new store.MaterialStoreError(code));
  expect(
    await readAuthorizedMaterialSource(tx, f.facts, reference),
  ).toMatchObject({
    status: code === 'storage_unavailable' ? 'conflict' : 'not_found',
  });
});
it('never echoes unknown database error text', async () => {
  const f = setup();
  f.read.mockRejectedValue(new Error('private quote or connection details'));
  const result = await readAuthorizedMaterialSource(tx, f.facts, reference);
  expect(result.status).toBe('conflict');
  expect(JSON.stringify(result)).not.toContain('private');
});
