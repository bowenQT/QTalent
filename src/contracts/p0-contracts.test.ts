import { describe, expect, it } from 'vitest';
import {
  sourceLocationSchema,
  sourceReferenceSchema,
  sourceReadInputSchema,
  sourceReadResultSchema,
} from './sources';
import {
  personSchema,
  capabilityScoreSchema,
  referencePositionSchema,
} from './person';
import { peopleInputSchema, peopleListSchema, quickViewSchema } from './people';
import { workbenchSchema } from './workbench';
import {
  fixtures,
  source,
  identity,
  confirmedScore,
} from '../../tests/fixtures/p0-contracts';

describe('P0 contracts: strict authorized response boundaries', () => {
  it('accepts synthetic role fixtures and all documented block states', () => {
    fixtures.people.forEach((x) =>
      expect(peopleListSchema.safeParse(x).success).toBe(true),
    );
    fixtures.people.forEach((x) =>
      x.people.forEach((p) =>
        expect(quickViewSchema.safeParse(p).success).toBe(true),
      ),
    );
    fixtures.person.forEach((x) =>
      expect(personSchema.safeParse(x).success).toBe(true),
    );
    fixtures.workbench.forEach((x) =>
      expect(workbenchSchema.safeParse(x).success).toBe(true),
    );
    fixtures.sources.forEach((x) =>
      expect(sourceReadResultSchema.safeParse(x).success).toBe(true),
    );
  });
  it('validates every data block state without disguising failures', () => {
    const mentor = fixtures.person.find((x) => x.role === 'mentor')!;
    for (const key of [
      'summary',
      'capabilityProfile',
      'timeline',
      'projects',
      'aiInferences',
    ]) {
      for (const block of [
        { status: 'empty' },
        { status: 'insufficient_evidence', reason: '合成资料缺口' },
        { status: 'unknown', reason: '合成未知' },
      ]) {
        expect(
          personSchema.safeParse({ ...mentor, [key]: block }).success,
        ).toBe(true);
      }
      for (const block of [
        { status: 'loading' },
        { status: 'forbidden' },
        { status: 'not_connected' },
        { status: 'empty', data: [] },
        { status: 'unknown' },
        { status: 'insufficient_evidence', reason: '', value: 0 },
      ]) {
        expect(
          personSchema.safeParse({ ...mentor, [key]: block }).success,
        ).toBe(false);
      }
    }
    const list = fixtures.people[0];
    expect(
      peopleListSchema.safeParse({
        ...list,
        people: list.people.map((p) => ({ ...p, role: 'hr' })),
      }).success,
    ).toBe(false);
    const hr = fixtures.workbench.find((x) => x.role === 'hr')!;
    expect(
      workbenchSchema.safeParse({
        ...hr,
        todos: { status: 'not_connected', count: 0 },
      }).success,
    ).toBe(false);
  });
  it('requires a versioned, positioned reference and valid ranges', () => {
    expect(sourceReferenceSchema.safeParse(source).success).toBe(true);
    for (const key of ['fragmentId', 'originalVersionId', 'location']) {
      const invalid = { ...source };
      delete invalid[key as keyof typeof invalid];
      expect(sourceReferenceSchema.safeParse(invalid).success).toBe(false);
    }
    const valid = [
      { kind: 'document', paragraph: 'p1' },
      { kind: 'document', page: 1, paragraph: 'p1' },
      { kind: 'spreadsheet', sheet: 'demo', cell: 'A1' },
      { kind: 'recording', startMs: 0, endMs: 100 },
    ];
    valid.forEach((x) =>
      expect(sourceLocationSchema.safeParse(x).success).toBe(true),
    );
    const invalid = [
      { kind: 'document', paragraph: '' },
      { kind: 'document', page: 0, paragraph: 'p1' },
      { kind: 'spreadsheet', sheet: 'demo', cell: '' },
      { kind: 'recording', startMs: 100, endMs: 100 },
      { kind: 'recording', startMs: -1, endMs: 100 },
      { kind: 'recording', startMs: 200, endMs: 100 },
    ];
    invalid.forEach((x) =>
      expect(sourceLocationSchema.safeParse(x).success).toBe(false),
    );
    expect(
      sourceReadInputSchema.safeParse({
        fragmentId: 'test-source-001',
        originalVersionId: 'test-version-001',
      }).success,
    ).toBe(true);
    expect(
      sourceReadInputSchema.safeParse({
        fragmentId: 'test-source-001',
        role: 'manager',
      }).success,
    ).toBe(false);
  });
  it('rejects blank source identifiers and inconsistent source types', () => {
    expect(
      sourceReadInputSchema.safeParse({
        fragmentId: '   ',
        originalVersionId: 'test-version-001',
      }).success,
    ).toBe(false);
    expect(
      sourceReferenceSchema.safeParse({
        ...source,
        location: { kind: 'document', paragraph: '   ' },
      }).success,
    ).toBe(false);
    expect(
      sourceReadResultSchema.safeParse({
        status: 'success',
        source: {
          ...source,
          sourceType: 'recording',
          demo: true,
          excerpt: 'test',
        },
      }).success,
    ).toBe(false);
  });
  it('rejects source payload leaks and P0 playback URLs', () => {
    const success = fixtures.sources[0];
    for (const extra of [
      { playbackUrl: 'https://example.test/audio' },
      { hiddenN: 1 },
      { originalText: 'other person' },
      { storageKey: 'key' },
    ]) {
      expect(
        sourceReadResultSchema.safeParse({
          ...success,
          source: { ...success.source, ...extra },
        }).success,
      ).toBe(false);
    }
    expect(
      sourceReadResultSchema.safeParse({
        status: 'forbidden',
        message: '无权',
        source,
      }).success,
    ).toBe(false);
  });
  it('omits, rather than nulls, every mentor restricted field', () => {
    const mentor = fixtures.person.find((x) => x.role === 'mentor')!;
    for (const key of [
      'referencePosition',
      'calibrationHistory',
      'versionsAndChanges',
      'managementObservations',
      'hiddenN',
      'totalScore',
      'confidence',
      'rank',
    ]) {
      expect(personSchema.safeParse({ ...mentor, [key]: null }).success).toBe(
        false,
      );
      expect(JSON.stringify(mentor)).not.toContain(`"${key}"`);
    }
    const quick = fixtures.people.find((x) => x.role === 'mentor')!.people[0];
    expect(
      quickViewSchema.safeParse({
        ...quick,
        referencePosition: { status: 'unknown' },
      }).success,
    ).toBe(false);
    expect(
      workbenchSchema.safeParse({ role: 'admin', people: [identity] }).success,
    ).toBe(false);
  });
  it('never turns AI suggestions, missing evidence, or unknown into scores', () => {
    expect(capabilityScoreSchema.safeParse(confirmedScore).success).toBe(true);
    for (const extra of [
      { status: 'suggested' },
      { value: 0 },
      { value: 6 },
      { sources: [] },
      { ruleVersionId: '' },
      { anchor: '' },
      { scoredBy: '' },
      { confidence: 0.9 },
    ]) {
      expect(
        capabilityScoreSchema.safeParse({ ...confirmedScore, ...extra })
          .success,
      ).toBe(false);
    }
    const person = fixtures.person[0];
    for (const block of [
      { status: 'unknown', data: [confirmedScore] },
      { status: 'insufficient_evidence', reason: '缺证', value: 0 },
      { status: 'ready', data: [] },
      { status: 'not_connected', data: [] },
    ]) {
      expect(
        personSchema.safeParse({ ...person, capabilityProfile: block }).success,
      ).toBe(false);
    }
    expect(
      referencePositionSchema.safeParse({
        status: 'ready',
        data: {
          kind: 'reference',
          quadrant: 'high_professional_high_potential',
        },
      }).success,
    ).toBe(true);
    expect(
      referencePositionSchema.safeParse({
        status: 'ready',
        data: { kind: 'formal', quadrant: 'high_professional_high_potential' },
      }).success,
    ).toBe(false);
    expect(
      referencePositionSchema.safeParse({
        status: 'ready',
        data: {
          kind: 'reference',
          quadrant: 'high_professional_high_potential',
          x: 0.8,
        },
      }).success,
    ).toBe(false);
  });
  it('accepts only known search filters, never client roles or score sorting', () => {
    expect(
      peopleInputSchema.parse({ query: ' demo ', teamId: 'test-team-001' }),
    ).toEqual({ query: 'demo', teamId: 'test-team-001' });
    for (const input of [
      { sort: 'score' },
      { role: 'manager' },
      { calibrationChanged: true },
      { query: 42 },
      { teamId: '' },
    ])
      expect(peopleInputSchema.safeParse(input).success).toBe(false);
  });
  it('checks visible list counts and unique IDs, leaves ordering to the query', () => {
    const list = fixtures.people[0];
    expect(peopleListSchema.safeParse({ ...list, total: 9 }).success).toBe(
      false,
    );
    expect(
      peopleListSchema.safeParse({
        ...list,
        people: [list.people[0], list.people[0]],
        total: 2,
      }).success,
    ).toBe(false);
    expect(peopleListSchema.safeParse({ ...list, hiddenN: 1 }).success).toBe(
      false,
    );
  });
  it('keeps not-connected blocks free of fabricated business values', () => {
    const manager = fixtures.workbench[0];
    for (const block of [
      { status: 'not_integrated' },
      { status: 'not_connected', count: 0 },
      { status: 'not_connected', data: [] },
      { status: 'empty' },
    ]) {
      expect(
        workbenchSchema.safeParse({ ...manager, myWatch: block }).success,
      ).toBe(false);
    }
    expect(
      personSchema.safeParse({
        ...fixtures.person[0],
        versionsAndChanges: { status: 'ready', data: [] },
      }).success,
    ).toBe(false);
  });
});
