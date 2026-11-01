import { describe, expect, it } from 'vitest';
import { fixture } from './person-test-helpers';
import { buildAuthorizedModelInput } from '../authz/talent';
import { talentSources } from './person-data';
import { personFromData } from './person-projection';
import { sourceFromData } from './sources';
import { historicalEvaluationRequiredKind } from './historical-evaluation-policy';

const restrictedText = '演示：受限结营结论与留用建议';
const reference = { fragmentId: 'fragment-0', originalVersionId: 'version' };
function historical(role: 'manager' | 'hr' | 'mentor', kind = '结营评审') {
  const data = fixture(role);
  data.fragments[0].excerpt = restrictedText;
  data.historical.push({
    id: 'demo-graduation',
    sourceRecordId: 'demo-graduation',
    evaluationNodeId: null,
    personId: 'one',
    recorderId: 'actor',
    occurredOn: '2026-06-01',
    kind,
    period: null,
    scale: [['结营结论', restrictedText]],
    ruleVersionId: null,
    sourceCategory: 'prototype_baseline',
    ...reference,
  });
  data.historicalParticipants.push({
    evaluationId: 'demo-graduation',
    personId: 'one',
  });
  return data;
}

describe('BOW-837 restricted graduation source access on main', () => {
  it('does not grant a restricted graduation source through a current cohort mentor assignment', async () => {
    const data = historical('mentor');
    // The existing snapshot has cohort mentoring only, with no trusted review-node relation.
    expect(data.context.assignments).toHaveLength(1);
    expect(await sourceFromData(data, reference)).toMatchObject({
      status: 'not_found',
    });
  });
  it('filters every derived field citing the restricted fragment, while retaining unrelated evidence', async () => {
    const data = historical('mentor');
    const confirmations = structuredClone(data.confirmations);
    const profile = await personFromData(data, 'one');
    expect(profile).not.toBeNull();
    expect(profile?.timeline).toMatchObject({
      status: 'ready',
      data: [{ id: 'event-1', kind: 'key_event' }],
    });
    expect(profile?.capabilityProfile).toMatchObject({
      status: 'ready',
      data: { scores: [{ id: 'event-1-prof' }, { id: 'event-1-grit' }] },
    });
    expect(JSON.stringify(profile)).not.toContain('fragment-0');
    expect(JSON.stringify(profile)).not.toContain(restrictedText);
    expect(data.confirmations).toEqual(confirmations);
  });
  it.each(['manager', 'hr'] as const)(
    'keeps the authorized %s source and unmodified historical value',
    async (role) => {
      const data = historical(role);
      const result = await sourceFromData(data, reference);
      expect(result).toMatchObject({
        status: 'success',
        source: { excerpt: restrictedText },
      });
      const profile = await personFromData(data, 'one');
      expect(profile?.timeline).toMatchObject({
        status: 'ready',
        data: [
          {
            id: 'demo-graduation',
            kind: 'history',
            category: 'restricted-evaluation',
            scale: [['结营结论', restrictedText]],
          },
          { id: 'event-0', kind: 'key_event' },
          { id: 'event-1', kind: 'key_event' },
        ],
      });
      expect(data.historical[0].scale).toEqual([['结营结论', restrictedText]]);
    },
  );
  it.each(['manager', 'hr', 'mentor'] as const)(
    '%s model input uses graduation text only when its source is currently readable',
    async (role) => {
      const data = historical(role);
      const input = await buildAuthorizedModelInput(async () => ({
        context: data.context,
        sources: talentSources(data),
        records: [
          {
            id: 'demo-graduation-text',
            subject: { personId: 'one', cohortId: null },
            kind: 'evaluation',
            fields: [
              {
                name: 'text',
                kind: 'evaluation',
                value: restrictedText,
                subjects: [],
                sources: [reference],
              },
            ],
          },
        ],
      }));
      if (role === 'mentor') expect(input).toEqual({ items: [] });
      else {
        expect(input.items[0]?.fields).toEqual({ text: restrictedText });
        expect(input.items[0]?.sources[0]).toMatchObject(reference);
      }
      expect(data.historical[0].scale).toEqual([['结营结论', restrictedText]]);
    },
  );
  it('retains an ordinary known weekly source for the currently assigned mentor', async () => {
    expect(
      await sourceFromData(historical('mentor', '训练营周评'), reference),
    ).toMatchObject({ status: 'success' });
  });
  it.each(['Unknown history', '面评-未确认类型'])(
    'does not open the unknown historical type %s',
    async (kind) => {
      expect(
        await sourceFromData(historical('manager', kind), reference),
      ).toMatchObject({ status: 'not_found' });
    },
  );
  it.each([
    ['start included', '2026-07-01T00:00:00.000Z', null, true],
    ['before start', '2026-06-30T23:59:59.999Z', null, false],
    ['just before end', '2026-07-31T23:59:59.999Z', null, true],
    ['end excluded', '2026-08-01T00:00:00.000Z', null, false],
    [
      'revocation excluded',
      '2026-07-15T12:00:00.000Z',
      '2026-07-15T12:00:00.000Z',
      false,
    ],
  ] as const)(
    'checks current relationship boundaries for ordinary evidence: %s',
    async (_label, now, revokedAt, visible) => {
      const data = historical('mentor', '训练营周评');
      data.context.now = now;
      Object.assign(data.context.assignments[0], {
        validFrom: '2026-07-01T00:00:00.000Z',
        validTo: '2026-08-01T00:00:00.000Z',
        revokedAt,
      });
      expect((await sourceFromData(data, reference)).status).toBe(
        visible ? 'success' : 'not_found',
      );
    },
  );
});

describe('closed historical sensitivity classification', () => {
  it.each([
    ['训练营周评', 'evaluation'],
    ['MS 路演评审', 'evaluation'],
    ['奖项答辩', 'evaluation'],
    ['结营评审', 'restricted-evaluation'],
  ] as const)('classifies only the approved baseline %s', (kind, expected) => {
    expect(
      historicalEvaluationRequiredKind({
        kind,
        sourceCategory: 'prototype_baseline',
      }),
    ).toBe(expected);
  });
  it.each([
    ['结营评审', 'original'],
    ['训练营周评', 'unknown'],
    ['constructor', 'prototype_baseline'],
    ['unclassified', 'prototype_baseline'],
  ])('does not infer access for %s / %s', (kind, sourceCategory) => {
    expect(
      historicalEvaluationRequiredKind({ kind, sourceCategory }),
    ).toBeNull();
  });
});
