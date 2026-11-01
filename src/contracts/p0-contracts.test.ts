import { describe, expect, it } from 'vitest';
import {
  sourceLocationSchema,
  sourceReferenceSchema,
  sourceReadInputSchema,
  sourceReadResultSchema,
  toSourceReadInput,
} from './sources';
import {
  personSchema,
  personIdentitySchema,
  personAvatarSchema,
  capabilityScoreSchema,
  eventScoreSchema,
  referencePositionSchema,
  referencePositionBriefSchema,
} from './person';
import { peopleInputSchema, peopleListSchema, quickViewSchema } from './people';
import { workbenchSchema } from './workbench';
import {
  peoplePageSchema,
  personPageSchema,
  workbenchPageSchema,
} from './page-result';
import {
  fixtures,
  source,
  source2,
  identity,
  identityNoBatch,
  identityWithPhoto,
  confirmedScore,
  eventConfirmedScore,
  conflictScore,
  conflictEvent,
  directoryList,
  expectDirectoryOrder,
  serializedHasNoKeys,
  asOf,
  windowFrom,
} from '../../tests/fixtures/p0-contracts';

type Json = Record<string, unknown>;
const person = (role: 'manager' | 'hr' | 'mentor'): Json =>
  structuredClone(
    fixtures.person.find((x) => x.role === role) ??
      (role === 'hr' ? fixtures.person[2] : fixtures.person[0]),
  ) as unknown as Json;
const manager = () => person('manager');
const mentor = () => person('mentor');
const timelineOf = (p: Json) =>
  (p.timeline as { data: Json[] }).data as Array<Json & { scores?: Json[] }>;
const ok = (
  schema: { safeParse: (x: unknown) => { success: boolean } },
  x: unknown,
) => schema.safeParse(x).success;

describe('P0 contracts: strict authorized response boundaries', () => {
  it('accepts synthetic role fixtures and all documented block states', () => {
    fixtures.people.forEach((x) => expect(ok(peopleListSchema, x)).toBe(true));
    fixtures.people.forEach((x) =>
      x.people.forEach((p) => expect(ok(quickViewSchema, p)).toBe(true)),
    );
    fixtures.person.forEach((x) => expect(ok(personSchema, x)).toBe(true));
    fixtures.workbench.forEach((x) =>
      expect(ok(workbenchSchema, x)).toBe(true),
    );
    fixtures.sources.forEach((x) =>
      expect(ok(sourceReadResultSchema, x)).toBe(true),
    );
  });
  it('validates every data block state without disguising failures', () => {
    const base = mentor();
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
        expect(ok(personSchema, { ...base, [key]: block })).toBe(true);
      }
      for (const block of [
        { status: 'loading' },
        { status: 'forbidden' },
        { status: 'not_connected' },
        { status: 'empty', data: [] },
        { status: 'unknown' },
        { status: 'insufficient_evidence', reason: '', value: 0 },
      ]) {
        expect(ok(personSchema, { ...base, [key]: block })).toBe(false);
      }
    }
    const list = fixtures.people[0];
    expect(
      ok(peopleListSchema, {
        ...list,
        people: list.people.map((p) => ({ ...p, role: 'hr' })),
      }),
    ).toBe(false);
    const hr = fixtures.workbench.find((x) => x.role === 'hr')!;
    expect(
      ok(workbenchSchema, {
        ...hr,
        todos: { status: 'not_connected', count: 0 },
      }),
    ).toBe(false);
  });
  it('requires a Chinese, user-readable reason for gaps and unknowns', () => {
    const base = mentor();
    for (const status of ['insufficient_evidence', 'unknown'])
      for (const reason of ['no evidence', 'ERR_42', '123'])
        expect(ok(personSchema, { ...base, summary: { status, reason } })).toBe(
          false,
        );
    expect(
      ok(personSchema, {
        ...base,
        summary: {
          status: 'insufficient_evidence',
          reason: '专业度缺 1 条事件',
        },
      }),
    ).toBe(true);
  });
});

describe('page results', () => {
  it('accepts ok and forbidden, and rejects messages or names on refusals', () => {
    expect(
      ok(peoplePageSchema, { status: 'ok', data: fixtures.people[0] }),
    ).toBe(true);
    expect(
      ok(workbenchPageSchema, { status: 'ok', data: fixtures.workbench[0] }),
    ).toBe(true);
    for (const schema of [
      peoplePageSchema,
      workbenchPageSchema,
      personPageSchema,
    ]) {
      expect(ok(schema, { status: 'forbidden' })).toBe(true);
      expect(ok(schema, { status: 'forbidden', message: '无权' })).toBe(false);
      expect(ok(schema, { status: 'forbidden', name: '演示测试甲' })).toBe(
        false,
      );
      expect(ok(schema, { status: 'maybe' })).toBe(false);
    }
  });
  it('gives only the person page a not_found that carries nothing else', () => {
    expect(ok(personPageSchema, { status: 'not_found' })).toBe(true);
    expect(
      ok(personPageSchema, { status: 'not_found', id: 'test-person-001' }),
    ).toBe(false);
    expect(
      ok(personPageSchema, { status: 'ok', data: fixtures.person[0] }),
    ).toBe(true);
    expect(ok(peoplePageSchema, { status: 'not_found' })).toBe(false);
    expect(ok(workbenchPageSchema, { status: 'not_found' })).toBe(false);
  });
});

describe('dates and the business day', () => {
  it('requires asOf on every person and workbench variant, as a plain date', () => {
    for (const variant of [manager(), mentor(), person('hr')]) {
      expect(ok(personSchema, variant)).toBe(true);
      for (const bad of [
        undefined,
        '2026-09-04T00:00:00Z',
        '09-04',
        '2026-13-01',
      ])
        expect(ok(personSchema, { ...variant, asOf: bad })).toBe(false);
    }
    for (const w of fixtures.workbench) {
      expect(w.asOf).toBe(asOf);
      for (const bad of [undefined, '2026-09-04T08:00:00Z', 'today'])
        expect(ok(workbenchSchema, { ...w, asOf: bad })).toBe(false);
    }
  });
  it('rejects date-times and blanks in event, fact, project and conclusion dates', () => {
    const withEntry = (patch: Json) => {
      const p = mentor();
      timelineOf(p)[0] = { ...timelineOf(p)[0], ...patch };
      return p;
    };
    for (const bad of ['2026-08-28T00:00:00Z', '', undefined, '28/08/2026'])
      expect(ok(personSchema, withEntry({ occurredOn: bad }))).toBe(false);
    // the old field name is gone
    expect(
      ok(personSchema, withEntry({ occurredAt: '2026-08-28T00:00:00Z' })),
    ).toBe(false);
    const projectDates = (patch: Json) => {
      const p = mentor();
      const data = (p.projects as { data: Json[] }).data;
      data[0] = { ...data[0], ...patch };
      return p;
    };
    for (const bad of ['2026-07-01T00:00:00Z', '']) {
      expect(ok(personSchema, projectDates({ from: bad }))).toBe(false);
      expect(ok(personSchema, projectDates({ to: bad }))).toBe(false);
    }
    expect(ok(personSchema, projectDates({ to: null }))).toBe(true);
    expect(ok(personSchema, projectDates({ to: undefined }))).toBe(false);
    const concl = mentor();
    (concl.summary as { data: Json[] }).data[0]!.at = '2026-08-30T00:00:00Z';
    expect(ok(personSchema, concl)).toBe(false);
  });
});

describe('person identity', () => {
  it('accepts the full identity, the photo identity and the no-batch identity', () => {
    for (const x of [identity, identityWithPhoto, identityNoBatch])
      expect(ok(personIdentitySchema, x)).toBe(true);
    expect(identityNoBatch).toMatchObject({
      batch: null,
      level: null,
      tenureLabel: null,
    });
  });
  it('bounds hue, keeps photos as resource keys and requires the team path', () => {
    for (const hue of [-1, 361, 1.5, '220'])
      expect(ok(personIdentitySchema, { ...identity, hue })).toBe(false);
    for (const hue of [0, 360])
      expect(ok(personIdentitySchema, { ...identity, hue })).toBe(true);
    for (const photo of [
      'a/b',
      '../x',
      'Upper',
      '/a.jpg',
      'https://x.test/a',
      '',
      'a b',
    ])
      expect(ok(personIdentitySchema, { ...identity, photo })).toBe(false);
    const { teamPath: _drop, ...noPath } = identity;
    void _drop;
    expect(ok(personIdentitySchema, noPath)).toBe(false);
    expect(ok(personIdentitySchema, { ...identity, teamPath: '' })).toBe(false);
  });
  it('allows null for level, tenureLabel and batch but never an empty string', () => {
    for (const key of ['level', 'tenureLabel']) {
      expect(ok(personIdentitySchema, { ...identity, [key]: null })).toBe(true);
      expect(ok(personIdentitySchema, { ...identity, [key]: '' })).toBe(false);
      const { [key]: _gone, ...without } = identity as Record<string, unknown>;
      void _gone;
      expect(ok(personIdentitySchema, without)).toBe(false);
    }
    expect(ok(personIdentitySchema, { ...identity, batch: null })).toBe(true);
    expect(
      ok(personIdentitySchema, { ...identity, batch: { id: 'b', name: '' } }),
    ).toBe(false);
    // `kind` is not part of a batch: one cohort type exists.
    expect(
      ok(personIdentitySchema, {
        ...identity,
        batch: { id: 'b', name: 'n', kind: 'landing' },
      }),
    ).toBe(false);
  });
  it('gives workbench trainees only the four avatar facts', () => {
    expect(
      ok(personAvatarSchema, { id: 'a', name: 'n', hue: 10, photo: null }),
    ).toBe(true);
    for (const extra of [{ teamName: 't' }, { jobTitle: 'j' }, { level: null }])
      expect(
        ok(personAvatarSchema, {
          id: 'a',
          name: 'n',
          hue: 10,
          photo: null,
          ...extra,
        }),
      ).toBe(false);
  });
  it('keeps landing details separate and nullable at the profile top', () => {
    const p = mentor();
    expect(ok(personSchema, { ...p, landing: null })).toBe(true);
    expect(
      ok(personSchema, {
        ...p,
        landing: { topicName: null, mentorNames: [] },
      }),
    ).toBe(true);
    expect(
      ok(personSchema, { ...p, landing: { topicName: '', mentorNames: [] } }),
    ).toBe(false);
    const { landing: _gone, ...without } = p;
    void _gone;
    expect(ok(personSchema, without)).toBe(false);
  });
});

describe('quick view and people list', () => {
  const quick = () => structuredClone(fixtures.managerQuick) as unknown as Json;
  it('rejects the fields the list must not carry, including score metadata', () => {
    for (const extra of [
      { summary: { status: 'empty' } },
      { capabilityProfile: { status: 'empty' } },
      { projects: { status: 'empty' } },
      { scoredBy: 'x' },
      { scoredByName: 'x' },
      { ruleVersionId: 'x' },
      { total: 3 },
      { hiddenN: 1 },
    ])
      expect(ok(quickViewSchema, { ...quick(), ...extra })).toBe(false);
  });
  it('checks project load and the recent-facts window', () => {
    expect(
      ok(quickViewSchema, { ...quick(), projectLoad: { current: 0, ever: 0 } }),
    ).toBe(true);
    expect(
      ok(quickViewSchema, { ...quick(), projectLoad: { current: 3, ever: 2 } }),
    ).toBe(false);
    expect(
      ok(quickViewSchema, {
        ...quick(),
        projectLoad: { current: -1, ever: 2 },
      }),
    ).toBe(false);
    const fact = (fixtures.managerQuick.recentFacts as { data: Json[] })
      .data[0]!;
    const facts = (n: number) => ({
      status: 'ready',
      data: Array.from({ length: n }, (_, i) => ({
        ...fact,
        eventId: `e${i}`,
      })),
    });
    expect(ok(quickViewSchema, { ...quick(), recentFacts: facts(0) })).toBe(
      false,
    );
    expect(ok(quickViewSchema, { ...quick(), recentFacts: facts(3) })).toBe(
      true,
    );
    expect(ok(quickViewSchema, { ...quick(), recentFacts: facts(4) })).toBe(
      false,
    );
    expect(
      ok(quickViewSchema, {
        ...quick(),
        recentFacts: { status: 'ready', data: [{ ...fact, sources: [] }] },
      }),
    ).toBe(false);
    // an unreadable project is omitted, never a placeholder; the key may be absent
    const { projectName: _gone, ...noProject } = fact as Json;
    void _gone;
    expect(
      ok(quickViewSchema, {
        ...quick(),
        recentFacts: { status: 'ready', data: [noProject] },
      }),
    ).toBe(true);
    expect(
      ok(quickViewSchema, {
        ...quick(),
        recentFacts: {
          status: 'ready',
          data: [{ ...fact, occurredOn: '2026-08-28T00:00:00Z' }],
        },
      }),
    ).toBe(false);
  });
  it('keeps capability lines to counts and anchor text', () => {
    const line = {
      dimensionId: 'd',
      dimensionLabel: '维',
      eventCount: 1,
      topAnchor: '锚点',
    };
    const lines = (l: Json[]) => ({
      status: 'ready',
      data: { lines: l, uncoveredCount: 0 },
    });
    expect(
      ok(quickViewSchema, { ...quick(), capabilityLines: lines([line]) }),
    ).toBe(true);
    for (const extra of [
      { value: 4 },
      { mean: 3.5 },
      { rank: 1 },
      { score: 4 },
      { percent: 80 },
    ])
      expect(
        ok(quickViewSchema, {
          ...quick(),
          capabilityLines: lines([{ ...line, ...extra }]),
        }),
      ).toBe(false);
    expect(
      ok(quickViewSchema, { ...quick(), capabilityLines: lines([]) }),
    ).toBe(false);
    expect(
      ok(quickViewSchema, {
        ...quick(),
        capabilityLines: lines([{ ...line, eventCount: 0 }]),
      }),
    ).toBe(false);
    expect(
      ok(quickViewSchema, { ...quick(), capabilityLines: lines([line, line]) }),
    ).toBe(false);
    expect(
      serializedHasNoKeys(fixtures.people, [
        'value',
        'mean',
        'rank',
        'percent',
        'scoredByName',
        'scoredBy',
        'ruleVersionId',
        'summary',
      ]),
    ).toBe(true);
  });
  it('lets only the manager and HR variants carry a reference position, without coordinates', () => {
    expect(
      ok(quickViewSchema, {
        ...fixtures.mentorQuick,
        referencePosition: { status: 'unknown', reason: '合成未知' },
      }),
    ).toBe(false);
    expect(
      ok(referencePositionBriefSchema, {
        status: 'ready',
        data: {
          kind: 'reference',
          quadrant: 'high_professional_high_potential',
        },
      }),
    ).toBe(true);
    expect(
      ok(referencePositionBriefSchema, {
        status: 'ready',
        data: {
          kind: 'reference',
          quadrant: 'high_professional_high_potential',
          bonus: true,
        },
      }),
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
      expect(ok(peopleInputSchema, input)).toBe(false);
  });
  it('checks visible list counts and unique IDs, leaves ordering to the query', () => {
    const list = fixtures.people[0];
    expect(ok(peopleListSchema, { ...list, total: 9 })).toBe(false);
    expect(
      ok(peopleListSchema, {
        ...list,
        people: [list.people[0], list.people[0]],
        total: 2,
      }),
    ).toBe(false);
    expect(ok(peopleListSchema, { ...list, hiddenN: 1 })).toBe(false);
    // a list in the wrong order still parses: ordering is asserted with expectDirectoryOrder
    const reversed = [...directoryList].reverse();
    expect(
      ok(peopleListSchema, {
        role: 'manager',
        people: reversed,
        total: reversed.length,
      }),
    ).toBe(true);
    expect(() => expectDirectoryOrder(reversed)).toThrow();
  });
  it('provides a directory fixture in team, name, id order', () => {
    expectDirectoryOrder(directoryList);
    expect(
      new Set(directoryList.map((x) => x.person.teamName)).size,
    ).toBeGreaterThanOrEqual(3);
    const names = directoryList.map((x) => x.person.name);
    expect(new Set(names).size).toBeLessThan(names.length);
  });
});

describe('mentor guards and the display label / category split', () => {
  it('limits every mentor block to server-authorized evaluation categories', () => {
    for (const category of [
      'management-observation',
      'performance',
      'quadrant',
    ]) {
      const entry = mentor();
      timelineOf(entry)[0] = { ...timelineOf(entry)[0], category };
      expect(ok(personSchema, entry)).toBe(false);
      const concl = mentor();
      (concl.summary as { data: Json[] }).data[0]!.category = category;
      expect(ok(personSchema, concl)).toBe(false);
      const ai = mentor();
      ai.aiInferences = {
        status: 'ready',
        data: [
          {
            id: 'i',
            text: '推断',
            nature: 'ai_inference',
            category,
            sources: [source],
          },
        ],
      };
      expect(ok(personSchema, ai)).toBe(false);
    }
  });
  it('accepts every category for managers and HR', () => {
    for (const category of [
      'evaluation',
      'management-observation',
      'restricted-evaluation',
      'performance',
      'quadrant',
    ]) {
      const m = manager();
      timelineOf(m)[0] = { ...timelineOf(m)[0], category };
      expect(ok(personSchema, m)).toBe(true);
    }
    expect(
      ok(personSchema, {
        ...manager(),
        timeline: {
          status: 'ready',
          data: [{ ...timelineOf(manager())[0], category: 'secret' }],
        },
      }),
    ).toBe(false);
  });
  it('rejects every restricted key on the mentor variant, nulled or not', () => {
    for (const key of [
      'referencePosition',
      'calibrationHistory',
      'versionsAndChanges',
      'managementObservations',
      'hiddenN',
      'restricted',
      'totalScore',
      'confidence',
      'rank',
    ]) {
      const m = mentor();
      expect(ok(personSchema, { ...m, [key]: null })).toBe(false);
      expect(
        ok(personSchema, { ...m, [key]: { status: 'not_connected' } }),
      ).toBe(false);
      expect(JSON.stringify(m)).not.toContain(`"${key}"`);
    }
    expect(
      ok(personSchema, {
        ...manager(),
        managementObservations: { status: 'empty' },
      }),
    ).toBe(false);
  });
  it('lets a key event be labelled as observation while staying evaluation for a mentor', () => {
    const m = mentor();
    const first = timelineOf(m)[0]!;
    expect(first.label).toBe('observation');
    expect(first.category).toBe('evaluation');
    expect(ok(personSchema, m)).toBe(true);
    for (const label of ['management', 'obs', '', undefined])
      expect(
        ok(personSchema, {
          ...m,
          timeline: { status: 'ready', data: [{ ...first, label }] },
        }),
      ).toBe(false);
  });
  it('keeps performance and management content visible only in the manager fixture', () => {
    const categories = (p: Json) =>
      timelineOf(p).map((e) => e.category as string);
    expect(categories(manager())).toEqual(
      expect.arrayContaining(['management-observation', 'performance']),
    );
    expect(new Set(categories(mentor()))).toEqual(new Set(['evaluation']));
  });
});

describe('event scores and conflicts', () => {
  it('requires every confirmed score to be traceable to a person, rule and source', () => {
    expect(ok(eventScoreSchema, eventConfirmedScore)).toBe(true);
    for (const key of [
      'anchor',
      'scoredByName',
      'ruleVersionId',
      'sources',
      'scoreId',
      'sourceCategory',
    ])
      expect(
        ok(eventScoreSchema, { ...eventConfirmedScore, [key]: undefined }),
      ).toBe(false);
    for (const extra of [
      { value: 0 },
      { value: 6 },
      { sources: [] },
      { scoredByName: '' },
      { confidence: 0.9 },
      { aiOriginal: 3 },
      { scoredBy: 'id' },
    ])
      expect(ok(eventScoreSchema, { ...eventConfirmedScore, ...extra })).toBe(
        false,
      );
  });
  it('gives insufficient and absent states no number, confidence or AI field', () => {
    for (const state of ['insufficient', 'absent']) {
      const base = { state, dimensionId: 'd', dimensionLabel: '维' };
      expect(ok(eventScoreSchema, base)).toBe(true);
      for (const extra of [
        { value: 0 },
        { value: 2 },
        { confidence: 0.4 },
        { aiOriginal: 3 },
        { anchor: 'x' },
      ])
        expect(ok(eventScoreSchema, { ...base, ...extra })).toBe(false);
    }
    expect(
      ok(eventScoreSchema, {
        state: 'suggested',
        dimensionId: 'd',
        dimensionLabel: '维',
        value: 3,
      }),
    ).toBe(false);
  });
  it('shapes a conflict like the prototype e-x11-3 case: two raters, 4 against 2', () => {
    expect(ok(eventScoreSchema, conflictScore)).toBe(true);
    expect(conflictScore.ratings.map((r) => r.value)).toEqual([4, 2]);
    const [a, b] = conflictScore.ratings;
    expect(ok(eventScoreSchema, { ...conflictScore, ratings: [a] })).toBe(
      false,
    );
    for (const key of ['scoreId', 'ruleVersionId', 'sources'])
      expect(
        ok(eventScoreSchema, {
          ...conflictScore,
          ratings: [{ ...a, [key]: undefined }, b],
        }),
      ).toBe(false);
    expect(ok(eventScoreSchema, { ...conflictScore, confidence: 0.1 })).toBe(
      false,
    );
    expect(
      ok(eventScoreSchema, {
        ...conflictScore,
        ratings: [{ ...a, aiOriginal: 3 }, b],
      }),
    ).toBe(false);
  });
  it('treats a spread of 2 or more as a conflict and a spread below 2 as separate scores', () => {
    const [a, b] = conflictScore.ratings;
    const near = { ...conflictScore, ratings: [a, { ...b!, value: 3 }] };
    expect(ok(eventScoreSchema, near)).toBe(false);
    expect(
      ok(eventScoreSchema, {
        ...conflictScore,
        ratings: [
          { ...a!, value: 3 },
          { ...b!, value: 1 },
          { ...b!, scoreId: 's3', value: 2 },
        ],
      }),
    ).toBe(true);
    // a spread of 1 is two ordinary confirmed scores on the same dimension
    const one = { ...eventConfirmedScore, scoreId: 'test-score-011', value: 2 };
    const two = { ...eventConfirmedScore, scoreId: 'test-score-012', value: 3 };
    const p = mentor();
    timelineOf(p)[0] = { ...timelineOf(p)[0], scores: [one, two] };
    expect(ok(personSchema, p)).toBe(true);
    // but a spread of 2 reported as two confirmed scores must be a conflict
    timelineOf(p)[0] = {
      ...timelineOf(p)[0],
      scores: [one, { ...two, value: 4 }],
    };
    expect(ok(personSchema, p)).toBe(false);
  });
  it('counts pending confirmations only as a number', () => {
    const p = mentor();
    const event = conflictEvent();
    expect(event.pendingScoreCount).toBe(1);
    for (const bad of [-1, 1.5, '1', { count: 1 }])
      expect(
        ok(personSchema, {
          ...p,
          timeline: {
            status: 'ready',
            data: [{ ...event, pendingScoreCount: bad }],
          },
        }),
      ).toBe(false);
    expect(
      ok(personSchema, {
        ...p,
        timeline: { status: 'ready', data: [{ ...event, suggestedScore: 3 }] },
      }),
    ).toBe(false);
  });
});

describe('timeline entries', () => {
  it('accepts key events, self reports and history, each with its own source list', () => {
    const kinds = timelineOf(manager()).map((e) => e.kind);
    expect(new Set(kinds)).toEqual(
      new Set(['key_event', 'self_report', 'history']),
    );
    const p = mentor();
    for (const bad of [
      { sources: [] },
      { sourceCount: 2 },
      { title: '' },
      { situation: '' },
      { restricted: true },
      { groupProjectName: 'x' },
      { tags: ['a'] },
    ])
      expect(
        ok(personSchema, {
          ...p,
          timeline: {
            status: 'ready',
            data: [{ ...timelineOf(p)[0], ...bad }],
          },
        }),
      ).toBe(false);
  });
  it('requires at least two participants when present and nullable behavior and impact', () => {
    const p = mentor();
    const event = timelineOf(p)[0]!;
    expect(
      ok(personSchema, {
        ...p,
        timeline: {
          status: 'ready',
          data: [{ ...event, participants: [{ name: '甲' }] }],
        },
      }),
    ).toBe(false);
    expect(
      ok(personSchema, {
        ...p,
        timeline: {
          status: 'ready',
          data: [{ ...event, behavior: null, impact: null }],
        },
      }),
    ).toBe(true);
    expect(
      ok(personSchema, {
        ...p,
        timeline: {
          status: 'ready',
          data: [{ ...event, behavior: undefined }],
        },
      }),
    ).toBe(false);
  });
  it('keeps the original scale of a history review', () => {
    const p = manager();
    const h = timelineOf(p).find((e) => e.kind === 'history')!;
    expect(
      ok(personSchema, {
        ...p,
        timeline: { status: 'ready', data: [{ ...h, scale: [] }] },
      }),
    ).toBe(false);
    expect(
      ok(personSchema, {
        ...p,
        timeline: { status: 'ready', data: [{ ...h, scale: [['综合', 4]] }] },
      }),
    ).toBe(false);
  });
});

describe('cross-block consistency', () => {
  const tweak = (patch: Json) => {
    const p = mentor();
    const profile = p.capabilityProfile as { data: { scores: Json[] } };
    profile.data.scores[0] = { ...profile.data.scores[0], ...patch };
    return p;
  };
  it('accepts the fixtures where each confirmed score matches its spectrum twin', () => {
    for (const x of fixtures.person) expect(ok(personSchema, x)).toBe(true);
  });
  it('fails when a shared scoreId differs in value, dimension, rule, category or sources', () => {
    expect(ok(personSchema, tweak({ value: 4 }))).toBe(false);
    expect(ok(personSchema, tweak({ ruleVersionId: 'other-rule' }))).toBe(
      false,
    );
    expect(
      ok(personSchema, tweak({ sourceCategory: 'prototype_baseline' })),
    ).toBe(false);
    expect(ok(personSchema, tweak({ sources: [source2] }))).toBe(false);
    expect(ok(personSchema, tweak({ eventId: 'test-event-999' }))).toBe(false);
    const dimension = tweak({ dimensionId: 'test-dimension-002' });
    expect(ok(personSchema, dimension)).toBe(false);
  });
  it('fails on a repeated scoreId inside one set, but allows event-only scores outside the window', () => {
    const p = mentor();
    const events = timelineOf(p);
    events[1] = {
      ...events[1],
      scores: [
        {
          ...eventConfirmedScore,
          dimensionId: 'test-dimension-009',
          dimensionLabel: '另一维度',
        },
      ],
    };
    expect(ok(personSchema, p)).toBe(false);
    const outside = mentor();
    timelineOf(outside)[1] = {
      ...timelineOf(outside)[1],
      scores: [{ ...eventConfirmedScore, scoreId: 'test-score-900', value: 5 }],
    };
    expect(ok(personSchema, outside)).toBe(true);
    const profile = mentor();
    const data = (profile.capabilityProfile as { data: { scores: Json[] } })
      .data;
    data.scores.push({ ...data.scores[0], occurredOn: '2026-08-01' });
    expect(ok(personSchema, profile)).toBe(false);
  });
  it('keeps conflicting ratings out of the ability spectrum', () => {
    const p = mentor();
    const data = (p.capabilityProfile as { data: { scores: Json[] } }).data;
    data.scores.push({
      ...data.scores[0],
      id: 'test-score-401',
      dimensionId: 'test-dimension-004',
      eventId: 'test-event-002',
    });
    expect(ok(personSchema, p)).toBe(false);
  });
});

describe('cross-block review regressions', () => {
  const profileScores = (p: Json) =>
    (p.capabilityProfile as { data: { scores: Json[] } }).data.scores;
  it('excludes a conflicted event dimension as a whole', () => {
    const base = mentor();
    // a confirmed score next to a conflict on the same dimension and event
    const mixed = mentor();
    const event = timelineOf(mixed)[1]!;
    event.scores = [
      ...(event.scores ?? []),
      {
        ...eventConfirmedScore,
        scoreId: 'test-score-410',
        dimensionId: 'test-dimension-004',
        dimensionLabel: '演示冲突维度',
      },
    ];
    expect(ok(personSchema, mixed)).toBe(false);
    // and a spectrum score taken from that conflicted event dimension
    profileScores(base).push({
      ...confirmedScore,
      id: 'test-score-410',
      dimensionId: 'test-dimension-004',
      eventId: 'test-event-002',
      eventTitle: '合成冲突事件',
      occurredOn: '2026-07-20',
    });
    (
      base.capabilityProfile as { data: { dimensions: Json[] } }
    ).data.dimensions.push({
      id: 'test-dimension-004',
      label: '演示冲突维度',
      group: 'potential_core',
      state: 'scored',
    });
    expect(ok(personSchema, base)).toBe(false);
  });
  it('checks the spread of spectrum scores on its own, even without a ready timeline', () => {
    const p = mentor();
    p.timeline = { status: 'unknown', reason: '合成未知' };
    expect(ok(personSchema, p)).toBe(true);
    profileScores(p).push({
      ...confirmedScore,
      id: 'test-score-411',
      value: 5,
    });
    expect(ok(personSchema, p)).toBe(false);
    profileScores(p)[1]!.value = 4;
    expect(ok(personSchema, p)).toBe(true);
  });
  it('compares shared sources as a set, not by array position', () => {
    const p = mentor();
    timelineOf(p)[0]!.scores![0] = {
      ...eventConfirmedScore,
      sources: [source, source2],
    };
    profileScores(p)[0]!.sources = [source2, source];
    expect(ok(personSchema, p)).toBe(true);
    profileScores(p)[0]!.sources = [source2];
    expect(ok(personSchema, p)).toBe(false);
  });
  it('requires a shared score to carry its event date and title', () => {
    const date = mentor();
    profileScores(date)[0]!.occurredOn = '2026-08-27';
    expect(ok(personSchema, date)).toBe(false);
    const title = mentor();
    profileScores(title)[0]!.eventTitle = '另一件事';
    expect(ok(personSchema, title)).toBe(false);
  });
});

describe('ability spectrum', () => {
  const profileOf = (p: Json) =>
    (
      p.capabilityProfile as {
        data: { windowFrom: string; dimensions: Json[]; scores: Json[] };
      }
    ).data;
  it('puts the window at asOf minus 365 days, boundary included', () => {
    expect(
      Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${windowFrom}T00:00:00Z`),
    ).toBe(365 * 86_400_000);
    expect(profileOf(mentor()).windowFrom).toBe(windowFrom);
    const wrong = mentor();
    profileOf(wrong).windowFrom = '2025-09-05';
    expect(ok(personSchema, wrong)).toBe(false);
    const missing = mentor();
    delete (profileOf(missing) as Record<string, unknown>).windowFrom;
    expect(ok(personSchema, missing)).toBe(false);
    const before = mentor();
    profileOf(before).scores[0]!.occurredOn = '2025-09-03';
    expect(ok(personSchema, before)).toBe(false);
    // the same boundary day on both the event card and the spectrum score
    const boundary = mentor();
    profileOf(boundary).scores[0]!.occurredOn = windowFrom;
    timelineOf(boundary)[0]!.occurredOn = windowFrom;
    expect(ok(personSchema, boundary)).toBe(true);
    // an event older than the window cannot be shown as a recent spectrum score
    const stale = mentor();
    timelineOf(stale)[0]!.occurredOn = '2025-09-03';
    expect(ok(personSchema, stale)).toBe(false);
  });
  it('ties each dimension state to the scores inside the window', () => {
    const noScore = mentor();
    profileOf(noScore).dimensions[0]!.state = 'insufficient';
    expect(ok(personSchema, noScore)).toBe(false);
    const scoredWithout = mentor();
    profileOf(scoredWithout).dimensions[1]!.state = 'scored';
    expect(ok(personSchema, scoredWithout)).toBe(false);
    const noMissing = mentor();
    delete profileOf(noMissing).dimensions[1]!.missing;
    expect(ok(personSchema, noMissing)).toBe(false);
    const insufficientWithScore = mentor();
    profileOf(insufficientWithScore).dimensions[0]!.state = 'insufficient';
    profileOf(insufficientWithScore).dimensions[0]!.missing = '缺';
    expect(ok(personSchema, insufficientWithScore)).toBe(false);
    const unknownDimension = mentor();
    profileOf(unknownDimension).scores[0]!.dimensionId = 'nope';
    expect(ok(personSchema, unknownDimension)).toBe(false);
    const badGroup = mentor();
    profileOf(badGroup).dimensions[0]!.group = 'overall';
    expect(ok(personSchema, badGroup)).toBe(false);
  });
  it('names the scorer, never the scorer id, and holds no cross-dimension total', () => {
    expect(ok(capabilityScoreSchema, confirmedScore)).toBe(true);
    for (const extra of [
      { scoredBy: 'rater-id' },
      { status: 'suggested' },
      { value: 0 },
      { value: 6 },
      { sources: [] },
      { ruleVersionId: '' },
      { anchor: '' },
      { scoredByName: '' },
      { confidence: 0.9 },
    ])
      expect(ok(capabilityScoreSchema, { ...confirmedScore, ...extra })).toBe(
        false,
      );
    expect(
      ok(capabilityScoreSchema, {
        ...confirmedScore,
        sourceCategory: undefined,
      }),
    ).toBe(false);
    for (const key of ['eventId', 'eventTitle', 'occurredOn'])
      expect(
        ok(capabilityScoreSchema, { ...confirmedScore, [key]: undefined }),
      ).toBe(false);
    expect(
      serializedHasNoKeys(fixtures.person, [
        'total',
        'totalScore',
        'percent',
        'rank',
        'overall',
        'confidence',
        'hiddenN',
        'scoredBy',
      ]),
    ).toBe(true);
  });
  it('keeps baseline demo scores acceptable on the profile', () => {
    const location = {
      kind: 'snapshot_field',
      fieldPath: 'events[test-event-001].srcs[0]',
      originalLocation: '原表第 1 周表现栏',
    };
    expect(
      ok(capabilityScoreSchema, {
        ...confirmedScore,
        sourceCategory: 'prototype_baseline',
        sources: [{ ...source, location }],
      }),
    ).toBe(true);
  });
});

describe('reference position', () => {
  it('adds the bonus flag only on the profile and never coordinates', () => {
    const ready = {
      kind: 'reference',
      quadrant: 'high_professional_high_potential',
    };
    expect(
      ok(referencePositionSchema, {
        status: 'ready',
        data: { ...ready, bonus: false },
      }),
    ).toBe(true);
    expect(ok(referencePositionSchema, { status: 'ready', data: ready })).toBe(
      false,
    );
    expect(
      ok(referencePositionSchema, {
        status: 'ready',
        data: { ...ready, bonus: 'yes' },
      }),
    ).toBe(false);
    expect(
      ok(referencePositionSchema, {
        status: 'ready',
        data: { ...ready, bonus: true, x: 0.8 },
      }),
    ).toBe(false);
    expect(
      ok(referencePositionSchema, {
        status: 'ready',
        data: { kind: 'formal', quadrant: ready.quadrant, bonus: true },
      }),
    ).toBe(false);
    expect(ok(referencePositionSchema, { status: 'empty' })).toBe(false);
  });
});

describe('summary and AI inferences', () => {
  it('requires a signed, dated, categorized conclusion and no nature tag', () => {
    const p = mentor();
    const entry = (p.summary as { data: Json[] }).data[0]!;
    for (const key of ['authorName', 'at', 'category'])
      expect(
        ok(personSchema, {
          ...p,
          summary: { status: 'ready', data: [{ ...entry, [key]: undefined }] },
        }),
      ).toBe(false);
    for (const nature of [
      'original_fact',
      'self_report',
      'human_conclusion',
      'ai_inference',
    ])
      expect(
        ok(personSchema, {
          ...p,
          summary: { status: 'ready', data: [{ ...entry, nature }] },
        }),
      ).toBe(false);
  });
  it('does not let an AI inference stand in as a conclusion', () => {
    const m = manager();
    const inference = (m.aiInferences as { data: Json[] }).data[0]!;
    expect(
      ok(personSchema, {
        ...m,
        summary: { status: 'ready', data: [inference] },
      }),
    ).toBe(false);
    expect(
      ok(personSchema, {
        ...m,
        aiInferences: {
          status: 'ready',
          data: [{ ...inference, nature: 'human_conclusion' }],
        },
      }),
    ).toBe(false);
  });
});

describe('projects', () => {
  it('requires role, mode and start, accepts an open end and drops participation', () => {
    const projectsOf = (patch: Json | null) => {
      const p = mentor();
      const data = (p.projects as { data: Json[] }).data;
      data[0] = patch === null ? data[0]! : { ...data[0], ...patch };
      return p;
    };
    expect(ok(personSchema, projectsOf(null))).toBe(true);
    for (const key of ['role', 'mode', 'from'])
      expect(ok(personSchema, projectsOf({ [key]: undefined }))).toBe(false);
    expect(ok(personSchema, projectsOf({ participation: 'owner' }))).toBe(
      false,
    );
    expect(ok(personSchema, projectsOf({ to: null }))).toBe(true);
  });
});

describe('workbench', () => {
  const wb = (role: string) =>
    structuredClone(
      fixtures.workbench.find((x) => x.role === role)!,
    ) as unknown as Json;
  it('uses entries as the only source of authorized actions', () => {
    for (const bad of [['people'], ['projects'], ['record', 'record']])
      expect(ok(workbenchSchema, { ...wb('hr'), entries: bad })).toBe(false);
    expect(
      ok(workbenchSchema, { ...wb('hr'), entries: ['record', 'find_people'] }),
    ).toBe(true);
    expect(ok(workbenchSchema, { ...wb('hr'), entries: [] })).toBe(true);
    expect(ok(workbenchSchema, { ...wb('manager'), entries: ['record'] })).toBe(
      true,
    );
    expect(
      ok(workbenchSchema, {
        ...wb('manager'),
        entries: ['record', 'find_people'],
      }),
    ).toBe(true);
    expect(
      ok(workbenchSchema, { ...wb('mentor'), entries: ['find_people'] }),
    ).toBe(false);
    expect(ok(workbenchSchema, { ...wb('mentor'), entries: ['record'] })).toBe(
      true,
    );
    expect(
      ok(workbenchSchema, {
        ...wb('manager'),
        findPeople: { status: 'ready', action: 'find_people' },
      }),
    ).toBe(false);
    expect(fixtures.workbench.map((x) => x.entries)).toEqual([
      ['record', 'find_people'],
      ['record', 'find_people'],
      ['record'],
    ]);
  });
  it('keeps not-connected blocks free of fabricated business values', () => {
    const manager = wb('manager');
    for (const block of [
      { status: 'not_integrated' },
      { status: 'not_connected', count: 0 },
      { status: 'not_connected', data: [] },
      { status: 'empty' },
    ])
      expect(ok(workbenchSchema, { ...manager, myWatch: block })).toBe(false);
    expect(
      ok(personSchema, {
        ...fixtures.person[0],
        versionsAndChanges: { status: 'ready', data: [] },
      }),
    ).toBe(false);
  });
  it('limits trainees to avatar facts, a topic and an activity state', () => {
    const base = wb('mentor');
    const trainee = (base.trainees as { data: Json[] }).data[0]!;
    const withTrainee = (t: Json) => ({
      ...base,
      trainees: { status: 'ready', data: [t] },
    });
    expect(ok(workbenchSchema, withTrainee(trainee))).toBe(true);
    for (const extra of [
      { summary: { status: 'empty' } },
      { capabilityProfile: { status: 'empty' } },
      { projects: { status: 'empty' } },
      { scoredBy: 'x' },
      { referencePosition: { status: 'unknown', reason: '合成未知' } },
    ])
      expect(ok(workbenchSchema, withTrainee({ ...trainee, ...extra }))).toBe(
        false,
      );
    expect(
      ok(
        workbenchSchema,
        withTrainee({
          ...trainee,
          person: { ...(trainee.person as Json), teamName: 't' },
        }),
      ),
    ).toBe(false);
    expect(
      ok(
        workbenchSchema,
        withTrainee({
          ...trainee,
          person: { ...(trainee.person as Json), jobTitle: 'j' },
        }),
      ),
    ).toBe(false);
    const duplicate = {
      ...base,
      trainees: { status: 'ready', data: [trainee, trainee] },
    };
    expect(ok(workbenchSchema, duplicate)).toBe(false);
  });
  it('distinguishes a known zero from an unknown activity and never turns unknown into 0', () => {
    const base = wb('mentor');
    const trainee = (base.trainees as { data: Json[] }).data[0]!;
    const withActivity = (activity: unknown) => ({
      ...base,
      trainees: { status: 'ready', data: [{ ...trainee, activity }] },
    });
    expect(
      ok(
        workbenchSchema,
        withActivity({
          status: 'ready',
          data: { recordedThisWeek: 0, lastRecordedOn: null },
        }),
      ),
    ).toBe(true);
    expect(
      ok(
        workbenchSchema,
        withActivity({
          status: 'ready',
          data: { recordedThisWeek: -1, lastRecordedOn: null },
        }),
      ),
    ).toBe(false);
    expect(
      ok(
        workbenchSchema,
        withActivity({
          status: 'ready',
          data: { recordedThisWeek: 1, lastRecordedOn: '2026-09-03T00:00:00Z' },
        }),
      ),
    ).toBe(false);
    expect(
      ok(
        workbenchSchema,
        withActivity({ status: 'unknown', reason: '合成未知' }),
      ),
    ).toBe(true);
    expect(
      ok(
        workbenchSchema,
        withActivity({
          status: 'unknown',
          reason: '合成未知',
          data: { recordedThisWeek: 0 },
        }),
      ),
    ).toBe(false);
    for (const status of ['insufficient_evidence', 'empty'])
      expect(
        ok(workbenchSchema, withActivity({ status, reason: '合成缺口' })),
      ).toBe(false);
    const topics = (base.trainees as { data: Json[] }).data.map((t) => t.topic);
    expect(topics).toContain(null);
    const activities = (base.trainees as { data: Json[] }).data.map(
      (t) => (t.activity as Json).status,
    );
    expect(activities).toEqual(expect.arrayContaining(['ready', 'unknown']));
  });
  it('rejects an administrator or unknown role', () => {
    expect(ok(workbenchSchema, { role: 'admin', people: [identity] })).toBe(
      false,
    );
  });
});

describe('sources', () => {
  it('requires a versioned, positioned reference and valid ranges', () => {
    expect(ok(sourceReferenceSchema, source)).toBe(true);
    for (const key of ['fragmentId', 'originalVersionId', 'location']) {
      const invalid = { ...source };
      delete invalid[key as keyof typeof invalid];
      expect(ok(sourceReferenceSchema, invalid)).toBe(false);
    }
    const valid = [
      { kind: 'document', paragraph: 'p1' },
      { kind: 'document', page: 1, paragraph: 'p1' },
      { kind: 'spreadsheet', sheet: 'demo', cell: 'A1' },
      { kind: 'recording', startMs: 0, endMs: 100 },
    ];
    valid.forEach((x) => expect(ok(sourceLocationSchema, x)).toBe(true));
    const invalid = [
      { kind: 'document', paragraph: '' },
      { kind: 'document', page: 0, paragraph: 'p1' },
      { kind: 'spreadsheet', sheet: 'demo', cell: '' },
      { kind: 'recording', startMs: 100, endMs: 100 },
      { kind: 'recording', startMs: -1, endMs: 100 },
      { kind: 'recording', startMs: 200, endMs: 100 },
    ];
    invalid.forEach((x) => expect(ok(sourceLocationSchema, x)).toBe(false));
    expect(
      ok(sourceReadInputSchema, {
        fragmentId: 'test-source-001',
        originalVersionId: 'test-version-001',
      }),
    ).toBe(true);
    expect(
      ok(sourceReadInputSchema, {
        fragmentId: 'test-source-001',
        role: 'manager',
      }),
    ).toBe(false);
  });
  it('knows exactly four location kinds, so authorization can map all of them', () => {
    const kinds = ['document', 'spreadsheet', 'recording', 'snapshot_field'];
    const accepted = [
      { kind: 'document', paragraph: 'p' },
      { kind: 'spreadsheet', sheet: 's', cell: 'A1' },
      { kind: 'recording', startMs: 0, endMs: 1 },
      { kind: 'snapshot_field', fieldPath: 'a.b' },
    ];
    expect(accepted.map((x) => x.kind)).toEqual(kinds);
    accepted.forEach((x) => expect(ok(sourceLocationSchema, x)).toBe(true));
    expect(ok(sourceLocationSchema, { kind: 'slide', page: 1 })).toBe(false);
  });
  it('turns a reference into a read request with the two identifiers only', () => {
    const input = toSourceReadInput(source);
    expect(input).toEqual({
      fragmentId: source.fragmentId,
      originalVersionId: source.originalVersionId,
    });
    expect(Object.keys(input)).toEqual(['fragmentId', 'originalVersionId']);
    expect(ok(sourceReadInputSchema, input)).toBe(true);
    expect(
      ok(sourceReadInputSchema, { ...input, location: source.location }),
    ).toBe(false);
  });
  it('requires an original title and allows an unknown recorder only as null', () => {
    const success = fixtures.sources[0] as { status: string; source: Json };
    for (const fixture of fixtures.sources.slice(0, 3)) {
      const f = fixture as { status: string; source: Json };
      const { originalTitle: _t, ...noTitle } = f.source;
      void _t;
      expect(ok(sourceReadResultSchema, { ...f, source: noTitle })).toBe(false);
      expect(
        ok(sourceReadResultSchema, {
          ...f,
          source: { ...f.source, originalTitle: '' },
        }),
      ).toBe(false);
      const { recordedByName: _r, ...noRecorder } = f.source;
      void _r;
      expect(ok(sourceReadResultSchema, { ...f, source: noRecorder })).toBe(
        false,
      );
      expect(
        ok(sourceReadResultSchema, {
          ...f,
          source: { ...f.source, recordedByName: null },
        }),
      ).toBe(true);
      expect(
        ok(sourceReadResultSchema, {
          ...f,
          source: { ...f.source, recordedByName: '' },
        }),
      ).toBe(false);
    }
    expect(success.source.recordedByName).toBe('演示记录人');
  });
  it('rejects blank source identifiers and inconsistent source types', () => {
    expect(
      ok(sourceReadInputSchema, {
        fragmentId: '   ',
        originalVersionId: 'test-version-001',
      }),
    ).toBe(false);
    expect(
      ok(sourceReferenceSchema, {
        ...source,
        location: { kind: 'document', paragraph: '   ' },
      }),
    ).toBe(false);
    const good = (fixtures.sources[0] as { source: Json }).source;
    expect(
      ok(sourceReadResultSchema, {
        status: 'success',
        source: { ...good, sourceType: 'recording' },
      }),
    ).toBe(false);
  });
  it('keeps prototype baseline provenance distinct from original evidence', () => {
    const location = {
      kind: 'snapshot_field',
      fieldPath: 'events[test-event-001].srcs[0]',
      originalLocation: '原表第 1 周表现栏',
    };
    expect(ok(sourceLocationSchema, location)).toBe(true);
    expect(ok(sourceLocationSchema, { ...location, fieldPath: '   ' })).toBe(
      false,
    );
    expect(ok(sourceLocationSchema, { ...location, cell: 'A1' })).toBe(false);
    const baseline = {
      ...(fixtures.sources[2] as { source: Json }).source,
      location,
    };
    expect(
      ok(sourceReadResultSchema, { status: 'success', source: baseline }),
    ).toBe(true);
    for (const extra of [
      { demo: false },
      { location: source.location },
      { sourceCategory: 'original' },
      { sourceType: 'spreadsheet' },
      { displayNotice: '' },
      { displayNotice: undefined },
    ])
      expect(
        ok(sourceReadResultSchema, {
          status: 'success',
          source: { ...baseline, ...extra },
        }),
      ).toBe(false);
  });
  it('rejects source payload leaks and P0 playback URLs', () => {
    const success = fixtures.sources[0] as { source: Json };
    for (const extra of [
      { playbackUrl: 'https://example.test/audio' },
      { hiddenN: 1 },
      { originalText: 'other person' },
      { storageKey: 'key' },
    ])
      expect(
        ok(sourceReadResultSchema, {
          ...success,
          source: { ...success.source, ...extra },
        }),
      ).toBe(false);
    expect(
      ok(sourceReadResultSchema, {
        status: 'forbidden',
        message: '无权',
        source,
      }),
    ).toBe(false);
  });
});

describe('global product invariants', () => {
  it('never serializes totals, rankings, confidence or hidden counts anywhere', () => {
    const banned = [
      'totalScore',
      'overall',
      'percent',
      'rank',
      'confidence',
      'hiddenN',
      'aiOriginal',
    ];
    for (const group of [
      fixtures.people,
      fixtures.person,
      fixtures.workbench,
      fixtures.sources,
    ])
      expect(serializedHasNoKeys(group, banned)).toBe(true);
  });
  it('keeps shared fixtures valid against every page result', () => {
    fixtures.people.forEach((d) =>
      expect(ok(peoplePageSchema, { status: 'ok', data: d })).toBe(true),
    );
    fixtures.person.forEach((d) =>
      expect(ok(personPageSchema, { status: 'ok', data: d })).toBe(true),
    );
    fixtures.workbench.forEach((d) =>
      expect(ok(workbenchPageSchema, { status: 'ok', data: d })).toBe(true),
    );
  });
  it('serializes no refusal with a name or message', () => {
    const refusals = [{ status: 'forbidden' }, { status: 'not_found' }];
    expect(serializedHasNoKeys(refusals, ['message', 'name', 'id'])).toBe(true);
  });
});
