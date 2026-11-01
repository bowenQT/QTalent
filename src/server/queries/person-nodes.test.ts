import { describe, expect, it } from 'vitest';
import { nodeFixture as currentNode } from './person-test-helpers';
import { eventSubject, talentSources } from './person-data';
import { personFromData } from './person-projection';
import { sourceFromData } from './sources';
import { buildAuthorizedModelInput, type TalentRecord } from '../authz/talent';

const reference = { fragmentId: 'fragment-0', originalVersionId: 'version' };
function model(data: ReturnType<typeof currentNode>, ref = reference) {
  const record: TalentRecord = {
    id: 'derived',
    subject: {
      personId: 'one',
      cohortId: 'cohort',
      evaluationNodeId: 'node-current',
    },
    kind: 'evaluation',
    fields: [
      {
        name: 'text',
        kind: 'evaluation',
        value: '演示：当前节点事实',
        subjects: [],
        sources: [ref],
      },
    ],
  };
  return buildAuthorizedModelInput(async () => ({
    context: data.context,
    records: [record],
    sources: talentSources(data),
  }));
}

describe('BOW-899 actual person/source/model node propagation', () => {
  it('propagates the explicit node of a project-less event into every source subject', async () => {
    const data = currentNode();
    expect(data.events[0].projectId).toBeNull();
    expect(eventSubject(data, data.events[0])).toMatchObject({
      evaluationNodeId: 'node-current',
    });
    expect(talentSources(data)[0].subjects).toEqual([
      { personId: 'one', cohortId: 'cohort', evaluationNodeId: 'node-current' },
    ]);
    expect(await sourceFromData(data, reference)).toHaveProperty(
      'status',
      'success',
    );
    expect(await personFromData(data, 'one')).toHaveProperty(
      'capabilityProfile.data.scores.length',
      4,
    );
    expect(await model(data)).toHaveProperty('items.length', 1);
  });
  it('projects a current node evaluator through the mentor response without requiring an old cohort role preset', async () => {
    const data = currentNode();
    data.context.grants = [];
    expect(await sourceFromData(data, reference)).toHaveProperty(
      'status',
      'success',
    );
    expect(await personFromData(data, 'one')).toHaveProperty('role', 'mentor');
  });
  it('rejects a shared source as a whole when another contributing event belongs to a different node', async () => {
    const data = currentNode();
    data.events[1].evaluationNodeId = 'node-other';
    data.eventSources.push({ eventId: 'event-1', ...reference });
    expect(await sourceFromData(data, reference)).toHaveProperty(
      'status',
      'not_found',
    );
    expect(await model(data)).toEqual({ items: [] });
    const profile = await personFromData(data, 'one');
    expect(JSON.stringify(profile)).not.toContain('fragment-0');
  });
  it('keeps an unknown legacy event closed even while the old cohort teaching assignment is current', async () => {
    const data = currentNode();
    data.events[0].evaluationNodeId = null;
    expect(data.context.assignments).toHaveLength(1);
    expect(await sourceFromData(data, reference)).toHaveProperty(
      'status',
      'not_found',
    );
    expect(await model(data)).toEqual({ items: [] });
    const profile = await personFromData(data, 'one');
    expect(JSON.stringify(profile)).not.toContain('fragment-0');
  });
  it('uses the full instant at relation expiry rather than a truncated business date', async () => {
    const data = currentNode();
    const relation = data.context.evaluationRelations![0];
    relation.validTo = '2026-07-01T12:00:00.000Z';
    data.context.now = '2026-07-01T11:59:59.999Z';
    expect(await sourceFromData(data, reference)).toHaveProperty(
      'status',
      'success',
    );
    expect(await personFromData(data, 'one')).toHaveProperty(
      'asOf',
      '2026-07-01',
    );
    data.context.now = relation.validTo;
    expect(await sourceFromData(data, reference)).toHaveProperty(
      'status',
      'not_found',
    );
    expect(await model(data)).toEqual({ items: [] });
    expect(await personFromData(data, 'one')).toBeNull();
  });
  it('allows an explicitly attributed restricted review only through its own current review relation', async () => {
    const data = currentNode();
    data.fragments.push({
      parseVersionId: null,
      sourceCategory: null,
      evaluationKind: null,
      demo: null,
      id: 'review-fragment',
      originalVersionId: 'version',
      excerpt: '演示：节点评审原量表',
      location: { kind: 'snapshot_field', fieldPath: 'review.scale' },
    });
    const history = {
      id: 'review',
      sourceRecordId: 'review',
      personId: 'one',
      recorderId: 'actor',
      occurredOn: '2026-06-01',
      kind: '结营评审',
      period: null,
      scale: [['评审', '演示：保留原量表']] as [string, string][],
      ruleVersionId: null,
      sourceCategory: 'prototype_baseline' as const,
      fragmentId: 'review-fragment',
      originalVersionId: 'version',
      evaluationNodeId: 'node-other',
    };
    data.historical.push(history);
    data.historicalParticipants.push({
      evaluationId: history.id,
      personId: 'one',
    });
    const ref = {
      fragmentId: history.fragmentId,
      originalVersionId: history.originalVersionId,
    };
    expect(await sourceFromData(data, ref)).toHaveProperty(
      'status',
      'not_found',
    );
    data.context.evaluationRelations!.push({
      id: 'explicit-review',
      evaluationNodeId: 'node-other',
      personId: 'one',
      evaluatorId: 'actor',
      kind: 'judge',
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: null,
      revokedAt: null,
    });
    expect(await sourceFromData(data, ref)).toHaveProperty('status', 'success');
    const profile = await personFromData(data, 'one');
    expect(
      profile?.timeline.status === 'ready' &&
        profile.timeline.data.find((row) => row.id === 'review'),
    ).toMatchObject({
      category: 'restricted-evaluation',
      scale: history.scale,
    });
    data.context.evaluationRelations![1].revokedAt = '2026-07-01T00:00:00.000Z';
    expect(await sourceFromData(data, ref)).toHaveProperty(
      'status',
      'not_found',
    );
  });
});
