import { describe, expect, it } from 'vitest';
import type { StaffingCandidate, StaffingDemand } from '@/contracts/staffing';
import { staffingFixture } from '@/contracts/staffing.fixtures';
import {
  arrangeCandidates,
  citableSources,
  toCandidateView,
  toRow,
} from './view';

const { demand, candidates } = staffingFixture();
const [supported, waiting] = candidates[0].requirements;
const source = supported.aiJudgment!.sources[0];
const requirement = demand.requirements[0];
const judge = {
  id: 'demo-hr',
  name: '演示审核人',
};

type Match = StaffingCandidate['requirements'][number];
const concluded = (
  requirementId: string,
  conclusion: 'supported' | 'not_supported' | 'insufficient' | 'conflict',
): Match => ({
  requirementId,
  progress: 'completed',
  aiJudgment: {
    conclusion,
    rationale: `演示：${requirementId} ${conclusion}`,
    sources: conclusion === 'insufficient' ? [] : [source],
  },
  humanJudgment: null,
});
const person = (id: string, matches: Match[]): StaffingCandidate => ({
  person: { id, name: `演示${id}`, orgName: '演示部门' },
  demandRevision: 1,
  requirements: matches,
});
const threeRequired: StaffingDemand = {
  ...demand,
  requirements: [
    { id: 'a', text: '要求 A', priority: 'required' },
    { id: 'b', text: '要求 B', priority: 'required' },
    { id: 'c', text: '要求 C', priority: 'required' },
    { id: 'd', text: '加分 D', priority: 'bonus' },
  ],
};

describe('toRow', () => {
  it('maps each conclusion to one of the four states with its sources', () => {
    expect(toRow(requirement, supported)).toEqual({
      requirement,
      kind: 'concluded',
      state: 'yes',
      rationale: '演示：存在对应交付材料',
      sources: [source],
      by: { kind: 'ai' },
    });
    expect(toRow(requirement, concluded('x', 'not_supported')).kind).toBe(
      'concluded',
    );
    for (const [conclusion, state] of [
      ['not_supported', 'no'],
      ['insufficient', 'unknown'],
      ['conflict', 'conflict'],
    ] as const) {
      const row = toRow(requirement, concluded('x', conclusion));
      expect(row.kind === 'concluded' && row.state).toBe(state);
    }
  });

  it('keeps progress apart from the four states, failure included', () => {
    for (const [progress, state] of [
      ['queued', 'queued'],
      ['judging', 'judging'],
      ['awaiting_manual', 'review'],
      ['failed', 'failed'],
    ] as const)
      expect(toRow(requirement, { ...waiting, progress })).toEqual({
        requirement,
        kind: 'progress',
        state,
      });
  });

  it('shows the signed human conclusion instead of the model one', () => {
    const row = toRow(requirement, {
      ...supported,
      humanJudgment: {
        conclusion: 'conflict',
        rationale: '演示：两处记录不一致',
        sources: [source],
        judgedBy: judge,
        judgedAt: '2026-09-04T02:00:00Z',
      },
    });
    expect(row).toMatchObject({
      state: 'conflict',
      rationale: '演示：两处记录不一致',
      by: { kind: 'human', name: '演示审核人', at: '2026-09-04T02:00:00Z' },
    });
  });

  it('refuses a completed match without any judgment', () => {
    expect(() =>
      toRow(requirement, { ...waiting, progress: 'completed' }),
    ).toThrow('Completed match without a judgment');
  });
});

describe('toCandidateView', () => {
  it('lists rows in demand order and skips requirements without a match', () => {
    const view = toCandidateView(
      threeRequired,
      person('1', [
        concluded('c', 'supported'),
        concluded('a', 'insufficient'),
      ]),
    );
    expect(view.rows.map((row) => row.requirement.id)).toEqual(['a', 'c']);
  });
});

describe('arrangeCandidates', () => {
  it('orders by supported required items only and keeps ties in read order', () => {
    const { listed, pending } = arrangeCandidates(threeRequired, [
      person('one', [concluded('a', 'supported'), concluded('d', 'supported')]),
      person('two', [concluded('a', 'supported'), concluded('b', 'supported')]),
      person('tie', [
        concluded('b', 'supported'),
        concluded('c', 'not_supported'),
      ]),
    ]);
    expect(listed.map((view) => view.person.id)).toEqual(['two', 'one', 'tie']);
    expect(pending).toEqual([]);
  });

  it('moves people with two required items short of evidence and none supported to the waiting list', () => {
    const { listed, pending } = arrangeCandidates(threeRequired, [
      person('short', [
        concluded('a', 'insufficient'),
        concluded('b', 'insufficient'),
        concluded('c', 'not_supported'),
        concluded('d', 'insufficient'),
      ]),
      person('one-gap', [
        concluded('a', 'insufficient'),
        concluded('b', 'not_supported'),
      ]),
      person('has-support', [
        concluded('a', 'insufficient'),
        concluded('b', 'insufficient'),
        concluded('c', 'supported'),
      ]),
      person('in-progress', [
        { ...waiting, requirementId: 'a', progress: 'judging' },
        { ...waiting, requirementId: 'b', progress: 'queued' },
      ]),
    ]);
    expect(listed.map((view) => view.person.id)).toEqual([
      'has-support',
      'one-gap',
      'in-progress',
    ]);
    expect(pending).toEqual([
      {
        person: { id: 'short', name: '演示short', orgName: '演示部门' },
        missing: ['要求 A', '要求 B'],
      },
    ]);
  });
});

describe('citableSources', () => {
  it('collects the sources of concluded rows once each', () => {
    const other = { ...source, fragmentId: 'demo-fragment-2' };
    const view = toCandidateView(
      threeRequired,
      person('1', [
        concluded('a', 'supported'),
        {
          ...concluded('b', 'conflict'),
          aiJudgment: {
            conclusion: 'conflict',
            rationale: '演示',
            sources: [source, other],
          },
        },
        { ...waiting, requirementId: 'c' },
      ]),
    );
    expect(citableSources(view)).toEqual([source, other]);
  });
});
