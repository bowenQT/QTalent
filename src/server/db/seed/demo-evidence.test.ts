import { describe, expect, it } from 'vitest';
import { mapPrototypeSeed, readPrototypeSeed } from './index';
import { mapEvidenceSeed } from './evidence';
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const synthetic = () => ({
  DIMS: [
    { id: 'test-dim', name: 'Synthetic dimension', axis: 'pot', core: true },
  ],
  ANCHORS: {
    prof: ['p1', 'p2', 'p3', 'p4', 'p5'],
    pot: ['a1', 'a2', 'a3', 'a4', 'a5'],
  },
  EVENTS: [
    {
      id: 'test-event',
      date: '2026-07-24',
      kind: 'obs',
      people: ['test-person'],
      recorder: 'test-evaluator',
      title: 'Synthetic event',
      bg: 'Synthetic context',
      act: 'Synthetic behavior',
      res: 'Synthetic result',
      week: 'W1',
      sum: '正常发挥',
      srcs: [
        {
          type: 'doc',
          label: 'Synthetic source',
          loc: '原表位置说明',
          quote: 'Synthetic observation',
        },
      ],
      scores: [
        {
          p: 'test-person',
          d: 'test-dim',
          v: 3,
          st: 'confirmed',
          by: 'test-evaluator',
          note: 'Synthetic observation…',
        },
      ],
    },
  ],
});
describe('approved baseline evidence mapping', () => {
  it('maps the pinned baseline counts without quarantining determined anchors or references', () => {
    const seed = mapPrototypeSeed(readPrototypeSeed(process.cwd()));
    const evidence = seed.evidence;
    expect(evidence.snapshots).toHaveLength(398);
    expect(evidence.events).toHaveLength(277);
    expect(
      evidence.confirmations.filter((s) => s.status === 'scored'),
    ).toHaveLength(558);
    expect(
      evidence.confirmations.filter((s) => s.status === 'unknown'),
    ).toHaveLength(1);
    expect(evidence.aiSuggestions).toHaveLength(4);
    expect(evidence.historicalEvaluations).toHaveLength(363);
    expect(
      evidence.historicalEvaluations.filter(
        (r) => r.ruleVersionId === 'xe-weekly-v1',
      ),
    ).toHaveLength(242);
    expect(
      evidence.historicalEvaluations.filter((r) => r.ruleVersionId === null),
    ).toHaveLength(121);
    const originalQuotes = { srcs: 0, act: 0 };
    for (const event of seed.raw.EVENTS)
      for (const score of event.scores) {
        if (score.st !== 'confirmed' && score.st !== 'ai') continue;
        const rows =
          score.st === 'ai' ? evidence.aiSuggestions : evidence.confirmations;
        const row = rows.find(
          (r) => r.eventId === event.id && r.dimensionId === score.d,
        )!;
        const f = evidence.fragments.find((f) => f.id === row.fragmentId)!;
        expect(f.location.kind).toBe('snapshot_field');
        if (f.location.kind === 'snapshot_field') {
          if (f.location.fieldPath.endsWith('.act')) originalQuotes.act++;
          else originalQuotes.srcs++;
        }
      }
    expect(originalQuotes).toEqual({ srcs: 442, act: 116 });
    const empty = seed.raw.EVENTS.filter(
      (e) => e.kind === 'obs' && e.act === '',
    );
    expect(empty).toHaveLength(10);
    expect(empty.filter((e) => e.scores.length)).toHaveLength(9);
    expect(empty.reduce((n, e) => n + e.scores.length, 0)).toBe(13);
    const withoutQuote = seed.raw.EVENTS.filter(
      (e) => e.kind === 'hist',
    ).flatMap((e) =>
      e.srcs
        .filter((s) => !s.quote)
        .map((s) => ({ event: e, src: s, index: e.srcs.indexOf(s) })),
    );
    expect(withoutQuote).toHaveLength(93);
    for (const { event, src, index } of withoutQuote)
      expect(
        evidence.fragments.find(
          (f) =>
            f.location.kind === 'snapshot_field' &&
            f.location.fieldPath ===
              'events[' + event.id + '].srcs[' + index + ']',
        )?.excerpt,
      ).toBe(JSON.stringify(src));
    expect(evidence.gaps).toHaveLength(21);
    expect(
      evidence.gaps.every(
        (g) => g.missing.join(',') === 'individualContribution',
      ),
    ).toBe(true);
    expect(evidence).toMatchObject({
      originals: expect.arrayContaining([
        expect.objectContaining({
          kind: 'prototype_snapshot',
          displayNotice: '原型基线 2e51b50，评语按原意压缩',
        }),
      ]),
      originalVersions: expect.arrayContaining([
        expect.objectContaining({
          sourceBlob: '54b8c41229fa220a79e20eef48afafa71af81c79',
          sourcePath: 'prototype/y/app/js/data-xe6.js',
        }),
        expect.objectContaining({
          sourceBlob: '48cacc14105d496159e633dd392128629f03e3f9',
          sourcePath: 'prototype/y/app/js/data.js',
        }),
      ]),
      historicalEvaluations: expect.any(Array),
    });
    expect(mapPrototypeSeed(readPrototypeSeed(process.cwd()))).toEqual(seed);
  });
  it('keeps empty demo behavior and never falls back to the result or title', () => {
    const e = synthetic();
    e.EVENTS[0].act = '';
    const mapped = mapEvidenceSeed(e);
    expect(mapped.events[0]).toMatchObject({
      behavior: '',
      demo: true,
      ruleVersionId: 'rubric-v1',
    });
  });
  it('creates baseline confirmations with precise source and empty confirmation metadata', () => {
    const mapped = mapEvidenceSeed(synthetic());
    expect(mapped.confirmations).toEqual([
      expect.objectContaining({
        eventId: 'test-event',
        evaluatorId: 'test-evaluator',
        value: 3,
        sourceCategory: 'prototype_baseline',
        ruleVersionId: 'rubric-v1',
        confirmedAt: null,
        modifiedBy: null,
        revision: 1,
        active: true,
      }),
    ]);
    expect(mapped.fragments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          location: {
            kind: 'snapshot_field',
            fieldPath: 'events[test-event].srcs[0]',
            originalLocation: '原表位置说明',
          },
          excerpt: 'Synthetic observation',
        }),
      ]),
    );
  });
  it('fails ambiguous or missing ordinary quotations with only locatable IDs in the error', () => {
    const missing = synthetic();
    missing.EVENTS[0].scores[0].note = 'No matching passage';
    expect(() => mapEvidenceSeed(missing)).toThrow(/test-event.*uniqueQuote/);
    const ambiguous = synthetic();
    ambiguous.EVENTS[0].srcs.push({ ...ambiguous.EVENTS[0].srcs[0] });
    expect(() => mapEvidenceSeed(ambiguous)).toThrow(/test-event.*uniqueQuote/);
  });
  it('uses an explicit unique source quote before the act fallback when both contain the excerpt', () => {
    const input = synthetic();
    input.EVENTS[0].act = 'Synthetic observation';
    const mapped = mapEvidenceSeed(input);
    const reference = mapped.fragments.find(
      (f) => f.id === mapped.confirmations[0].fragmentId,
    )!;
    expect(reference.location).toMatchObject({
      fieldPath: 'events[test-event].srcs[0]',
    });
  });
  it('reads the prototype quotation wrapper and removes only a trailing ellipsis from its quote', () => {
    const input = synthetic();
    input.EVENTS[0].scores[0].note = '引用「Synthetic observation…」';
    expect(mapEvidenceSeed(input).confirmations).toHaveLength(1);
  });
  it('keeps rater conflicts, unknowns and original AI values separate with exact score-field references', () => {
    const input = synthetic();
    Object.assign(input.EVENTS[0], {
      scores: [
        {
          p: 'test-person',
          d: 'test-dim',
          st: 'conflict',
          ai: 3,
          raters: [
            { by: 'test-rater-a', v: 2 },
            { by: 'test-rater-b', v: 4 },
          ],
        },
      ],
    });
    const mapped = mapEvidenceSeed(input);
    expect(mapped.confirmations.map((s) => [s.evaluatorId, s.value])).toEqual([
      ['test-rater-a', 2],
      ['test-rater-b', 4],
    ]);
    for (const s of mapped.confirmations)
      expect(
        mapped.fragments.find((f) => f.id === s.fragmentId)?.location,
      ).toMatchObject({
        kind: 'snapshot_field',
        fieldPath: expect.stringMatching(/scores\[0\]\.raters\[[01]\]$/),
      });
    expect(mapped.aiSuggestions[0]).toMatchObject({
      modelVersion: '原型基线',
      value: 3,
    });
    Object.assign(input.EVENTS[0], {
      scores: [
        { p: 'test-person', d: 'test-dim', st: 'not_demonstrated', v: null },
      ],
    });
    expect(mapEvidenceSeed(input).confirmations[0]).toMatchObject({
      status: 'not_demonstrated',
      evaluatorId: null,
      value: null,
      anchorId: null,
    });
  });
  it('retains group historical scales once and reports missing personal contribution without copying scores', () => {
    const input = synthetic();
    Object.assign(input.EVENTS[0], {
      kind: 'hist',
      people: ['test-person', 'test-other'],
      histType: 'Synthetic review',
      scale: [['Original grade', 'B']],
      scores: [],
      srcs: [{ type: 'doc', label: 'Synthetic source' }],
    });
    const mapped = mapEvidenceSeed(input);
    expect(mapped.events).toHaveLength(0);
    expect(mapped.confirmations).toHaveLength(0);
    expect(mapped.historicalEvaluations).toMatchObject([
      { personId: null, ruleVersionId: null, scale: [['Original grade', 'B']] },
    ]);
    expect(mapped.historicalParticipants.map((r) => r.personId)).toEqual([
      'test-person',
      'test-other',
    ]);
    expect(mapped.gaps).toEqual([
      { recordId: 'test-event', missing: ['individualContribution'] },
    ]);
    Object.assign(input.EVENTS[0], { kind: 'obs' });
    expect(mapEvidenceSeed(input).events).toHaveLength(0);
  });
  it.each([
    { st: 'confirmed', by: undefined },
    { st: 'conflict', raters: [] },
    { st: 'ai', v: null, ai: undefined },
    { st: 'unknown', v: 3 },
    { p: 'other-person' },
    { d: 'missing-dimension' },
  ])(
    'rejects a locatable invalid score rather than inventing evidence',
    (patch) => {
      const input = synthetic();
      Object.assign(input.EVENTS[0].scores[0], patch);
      expect(() => mapEvidenceSeed(input)).toThrow(
        /events\[test-event\].scores\[0\]/,
      );
    },
  );
  it('rejects duplicate identities, participants, active score keys, missing anchors and missing SBI', () => {
    const input = synthetic();
    input.EVENTS.push(input.EVENTS[0]);
    expect(() => mapEvidenceSeed(input)).toThrow(/duplicateIdentity/);
    const participants = synthetic();
    participants.EVENTS[0].people.push('test-person');
    expect(() => mapEvidenceSeed(participants)).toThrow(/duplicateParticipant/);
    const duplicate = synthetic();
    duplicate.EVENTS[0].scores.push(duplicate.EVENTS[0].scores[0]);
    expect(() => mapEvidenceSeed(duplicate)).toThrow(/activeConfirmationKey/);
    const missing = synthetic();
    Object.assign(missing, { ANCHORS: undefined });
    expect(() => mapEvidenceSeed(missing)).toThrow(/anchors/);
    Object.assign(missing, { DIMS: [] });
    expect(() => mapEvidenceSeed(missing)).toThrow(/ruleVersionId/);
    const sbi = synthetic();
    Object.assign(sbi.EVENTS[0], { act: undefined });
    expect(() => mapEvidenceSeed(sbi)).toThrow(/SBI/);
  });
  it('rejects invented historical dimension scores and missing historical scales', () => {
    const input = synthetic();
    Object.assign(input.EVENTS[0], { kind: 'hist' });
    expect(() => mapEvidenceSeed(input)).toThrow(/historicalScale/);
    Object.assign(input.EVENTS[0], {
      histType: 'Synthetic history',
      scale: [],
    });
    expect(() => mapEvidenceSeed(input)).toThrow(/historicalDimensionScore/);
  });
  it('does not evaluate store.js or import its derived profiles and quadrants', () => {
    const root = mkdtempSync(join(tmpdir(), 'qtalent-no-store-'));
    try {
      const directory = join(
        root,
        '.reference-cache/evidence/prototype/y/app/js',
      );
      mkdirSync(directory, { recursive: true });
      for (const file of ['data-xe6.js', 'data.js'])
        cpSync(
          join(
            process.cwd(),
            '.reference-cache/evidence/prototype/y/app/js',
            file,
          ),
          join(directory, file),
        );
      cpSync(
        join(process.cwd(), 'prototype-reference.json'),
        join(root, 'prototype-reference.json'),
      );
      writeFileSync(
        join(directory, 'store.js'),
        'throw new Error("store must not execute")',
      );
      const mapped = mapPrototypeSeed(readPrototypeSeed(root));
      expect(mapped.evidence.snapshots).toHaveLength(398);
      expect(mapped.raw).not.toHaveProperty('H1_OVERRIDE');
      expect(mapped).not.toHaveProperty('profileVersions');
      expect(mapped).not.toHaveProperty('quadrants');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
