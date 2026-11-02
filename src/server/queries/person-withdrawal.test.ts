import { expect, it } from 'vitest';
import { nodeFixture } from './person-test-helpers';
import { personFromData } from './person-projection';
import { quickViewFromData, peopleFromData } from './people';
import { sourceFromData } from './sources';
import { talentSources } from './person-data';

it('removes withdrawn events and their active-looking scores from every current projection without deleting provenance', async () => {
  const data = nodeFixture();
  data.context.grants = [
    {
      accountId: 'account',
      role: 'manager',
      scope: 'company',
      cohortId: null,
      validFrom: '2026-01-01',
      validTo: null,
      revokedAt: null,
    },
  ];
  const before = await personFromData(data, 'one');
  expect(before?.timeline.status).toBe('ready');
  for (const event of data.events)
    Object.assign(event, { withdrawnAt: new Date('2026-07-01T00:00:00Z') });
  expect(data.confirmations.every((row) => row.active)).toBe(true);
  const after = await personFromData(data, 'one');
  expect(after?.timeline).toEqual({ status: 'empty' });
  expect(after?.capabilityProfile.status).toBe('insufficient_evidence');
  expect((await quickViewFromData(data, 'one'))?.recentFacts).toEqual({
    status: 'empty',
  });
  const list = await peopleFromData(data, {});
  expect(
    list.people.find((row) => row.person.id === 'one')?.recentFacts,
  ).toEqual({ status: 'empty' });
  expect(data.events).toHaveLength(2);
  expect(talentSources(data)[0]!.subjects).toContainEqual({
    personId: 'one',
    cohortId: 'cohort',
    evaluationNodeId: 'node-current',
  });
  expect(
    (
      await sourceFromData(data, {
        fragmentId: 'fragment-0',
        originalVersionId: 'version',
      })
    ).status,
  ).toBe('success');
});

it('does not count statements from withdrawn events as self reports, AI inferences or human conclusions', async () => {
  const data = nodeFixture();
  data.context.grants = [
    {
      accountId: 'account',
      role: 'manager',
      scope: 'company',
      cohortId: null,
      validFrom: '2026-01-01',
      validTo: null,
      revokedAt: null,
    },
  ];
  const reference = { fragmentId: 'fragment-0', originalVersionId: 'version' };
  for (const kind of [
    'self_report',
    'ai_inference',
    'human_conclusion',
  ] as const)
    data.statements.push({
      id: kind,
      eventId: 'event-0',
      kind,
      text: 'Synthetic withdrawn statement',
      authorId: kind === 'ai_inference' ? null : 'actor',
      modelVersion: kind === 'ai_inference' ? 'synthetic-model' : null,
      uncertainty: null,
      ...reference,
    });
  Object.assign(data.events[0]!, {
    withdrawnAt: new Date('2026-07-01T00:00:00Z'),
  });
  const person = await personFromData(data, 'one');
  expect(person?.timeline.status).toBe('ready');
  if (person?.timeline.status === 'ready')
    expect(person.timeline.data.map((row) => row.id)).toEqual(['event-1']);
  expect(person?.aiInferences).toEqual({ status: 'empty' });
  expect(person?.summary).toEqual({ status: 'empty' });
});

it('keeps every withdrawn shared subject in the source guard instead of laundering a visible event', async () => {
  const data = nodeFixture();
  data.events[1]!.personId = 'two';
  Object.assign(data.events[1]!, {
    withdrawnAt: new Date('2026-07-01T00:00:00Z'),
  });
  data.eventSources[1]!.fragmentId = 'fragment-0';
  const sources = talentSources(data);
  expect(sources[0]!.subjects.map((row) => row.personId)).toContain('two');
  expect(
    (
      await sourceFromData(
        data,
        { fragmentId: 'fragment-0', originalVersionId: 'version' },
        sources,
      )
    ).status,
  ).toBe('not_found');
  expect((await personFromData(data, 'one', sources))?.timeline).toEqual({
    status: 'empty',
  });
});
