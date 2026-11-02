import { describe, expect, it } from 'vitest';
import {
  canWriteArrange,
  buildRecordPageContext,
  defaultIntakeNode,
  textSubjects,
  type ArrangeActor,
} from './record-arrange-context';
import { exampleSnapshot } from '../modules/records/arrange/examples';
function actor(): ArrangeActor {
  const base = exampleSnapshot().authorization.context;
  const evaluationNodes = [
    {
      id: 'demo-node',
      name: '演示节点',
      kind: 'program_cohort' as const,
      cohortId: 'cohort-demo',
    },
  ];
  const evaluationNodeSubjects = base.people.map((person) => ({
    evaluationNodeId: 'demo-node',
    personId: person.id,
  }));
  const evaluationRelations = base.people.map((person, index) => ({
    id: 'demo-relation-' + index,
    evaluationNodeId: 'demo-node',
    personId: person.id,
    evaluatorId: base.account.personId,
    kind: 'evaluator' as const,
    validFrom: '2026-01-01T00:00:00.000Z',
    validTo: null,
    revokedAt: null,
    legacyAssignmentId: null,
  }));
  const facts = {
    evaluationNodes,
    evaluationNodeSubjects,
    evaluationRelations,
  };
  const context = { ...base, ...facts, hrCandidateGrants: [] };
  return {
    context,
    facts,
    directory: {
      account: context.account,
      grants: context.grants.map((g, i) => ({ ...g, id: 'grant-' + i })),
      people: context.people.map((p, i) => ({
        ...p,
        name: ['林舟', '许禾', '周岚'][i]!,
        organizationId: 'demo-org',
        jobTitle: null,
        jobLevel: null,
        photo: null,
        hue: 220,
        demo: true,
      })),
      organizations: [
        {
          id: 'demo-org',
          name: '演示组织',
          shortName: '演示',
          parentId: null,
          hierarchyKnown: false,
          isGroup: false,
        },
      ],
    },
    staffing: { projects: [], members: [] },
  };
}
describe('actual arrange write policy assembly', () => {
  it('allows current HR targets and rejects an unavailable person', () => {
    const a = actor();
    expect(canWriteArrange(a, ['demo-lin'], null)).toBe(true);
    expect(canWriteArrange(a, ['hidden'], null)).toBe(false);
  });
  it('does not convert manager read access into evaluation writes', () => {
    const a = actor();
    a.context.grants[0] = {
      ...a.context.grants[0]!,
      role: 'manager',
      scope: 'company',
      cohortId: null,
    };
    a.context.evaluationRelations = [];
    expect(canWriteArrange(a, ['demo-lin'], null)).toBe(false);
    expect(canWriteArrange(a, [], null)).toBe(false);
  });
  it('uses actual current node relations, never cohort mentoring as a replacement', () => {
    const a = actor();
    a.context.grants[0]!.role = 'mentor';
    a.context.evaluationRelations = a.context.evaluationRelations.filter(
      (relation) => relation.personId === 'demo-lin',
    );
    a.context.assignments = [
      {
        personId: 'demo-rater',
        studentId: 'demo-lin',
        cohortId: 'cohort-demo',
        kind: 'mentor',
        validFrom: '2026-01-01',
        validTo: null,
        revokedAt: null,
      },
    ];
    expect(canWriteArrange(a, ['demo-lin'], null)).toBe(true);
    expect(canWriteArrange(a, ['demo-xu'], null)).toBe(false);
    a.context.evaluationRelations = [];
    expect(canWriteArrange(a, ['demo-lin'], null)).toBe(false);
  });
  it('denies an inaccessible project and a no-review person', () => {
    const a = actor();
    expect(canWriteArrange(a, ['demo-lin'], 'hidden-project')).toBe(false);
    a.context.people[0]!.noReview = true;
    expect(canWriteArrange(a, ['demo-lin'], null)).toBe(false);
  });
  it('keeps privacy subjects mentioned in text separate from the selected actor', () => {
    const a = actor();
    expect(
      textSubjects(a, '林舟与许禾一起复盘', ['demo-lin'], 'demo-node').map(
        (s) => s.personId,
      ),
    ).toEqual(['demo-lin', 'demo-xu']);
  });
  it('provides only current writable people and the requested authorized initial context', () => {
    const a = actor();
    a.context.people[1]!.noReview = true;
    expect(
      buildRecordPageContext(a, { personId: 'demo-lin', projectId: null }),
    ).toMatchObject({
      accountId: 'demo-account',
      people: [
        { id: 'demo-lin', label: '林舟' },
        { id: 'demo-zhou', label: '周岚' },
      ],
      projects: [],
      selectedPersonId: 'demo-lin',
      selectedProjectId: null,
    });
    expect(
      buildRecordPageContext(a, { personId: 'demo-xu', projectId: null }),
    ).toBeNull();
    expect(
      buildRecordPageContext(a, { personId: null, projectId: 'hidden' }),
    ).toBeNull();
    a.context.grants = [];
    a.context.evaluationRelations = [];
    expect(
      buildRecordPageContext(a, { personId: null, projectId: null }),
    ).toBeNull();
  });
});

it('does not guess a node or combine two nodes to authorize one intake', () => {
  const a = actor();
  expect(canWriteArrange(a, ['demo-lin'], null, 'missing-node')).toBe(false);
  a.context.evaluationNodes.push({
    id: 'other-node',
    kind: 'defense',
    cohortId: null,
  });
  a.context.evaluationNodeSubjects = a.context.evaluationNodeSubjects.filter(
    (row) => row.personId !== 'demo-xu',
  );
  a.context.evaluationNodeSubjects.push({
    evaluationNodeId: 'other-node',
    personId: 'demo-xu',
  });
  a.context.evaluationRelations = a.context.evaluationRelations.map((row) =>
    row.personId === 'demo-xu'
      ? { ...row, evaluationNodeId: 'other-node' }
      : row,
  );
  expect(canWriteArrange(a, ['demo-lin', 'demo-xu'], null)).toBe(false);
  expect(canWriteArrange(a, ['demo-lin'], null, 'demo-node')).toBe(true);
  expect(canWriteArrange(a, ['demo-xu'], null, 'other-node')).toBe(true);
});

describe('default intake node', () => {
  function withSecondNode(validFrom: string): ArrangeActor {
    const base = actor();
    const person = base.context.people[0]!;
    const facts = {
      evaluationNodes: [
        ...base.facts.evaluationNodes,
        {
          id: 'demo-node-2',
          name: '演示节点二',
          kind: 'program_cohort' as const,
          cohortId: 'cohort-demo',
        },
      ],
      evaluationNodeSubjects: [
        ...base.facts.evaluationNodeSubjects,
        { evaluationNodeId: 'demo-node-2', personId: person.id },
      ],
      evaluationRelations: [
        ...base.facts.evaluationRelations,
        {
          ...base.facts.evaluationRelations[0]!,
          id: 'demo-relation-node-2',
          evaluationNodeId: 'demo-node-2',
          validFrom,
        },
      ],
    };
    return { ...base, facts, context: { ...base.context, ...facts } };
  }
  it('takes the only node the submitter can currently write on', () => {
    expect(defaultIntakeNode(actor())).toEqual({
      status: 'resolved',
      evaluationNodeId: 'demo-node',
    });
  });
  it('takes the node whose current relations started most recently', () => {
    expect(defaultIntakeNode(withSecondNode('2026-03-01T00:00:00.000Z'))).toEqual(
      { status: 'resolved', evaluationNodeId: 'demo-node-2' },
    );
  });
  it('refuses to pick between nodes that started together', () => {
    expect(defaultIntakeNode(withSecondNode('2026-01-01T00:00:00.000Z'))).toEqual(
      { status: 'ambiguous' },
    );
  });
  it('reports no node once every relation is revoked', () => {
    const base = actor();
    const evaluationRelations = base.facts.evaluationRelations.map(
      (relation) => ({ ...relation, revokedAt: '2026-02-01T00:00:00.000Z' }),
    );
    expect(
      defaultIntakeNode({
        ...base,
        facts: { ...base.facts, evaluationRelations },
        context: { ...base.context, evaluationRelations },
      }),
    ).toEqual({ status: 'missing' });
  });
});
