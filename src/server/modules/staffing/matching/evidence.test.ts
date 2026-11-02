import { expect, it } from 'vitest';
import { z } from 'zod';
import { matchingFixture } from '../../../../../tests/fixtures/staffing-matching';
import {
  assembleMatchingEvidence,
  type MatchingEvidenceMaterial,
} from './evidence';
import { createStaffingMatchUsecase } from '../../../usecases/staffing-match';

function fixture() {
  const f = matchingFixture();
  const fields = (id: string) =>
    Object.fromEntries(
      f.records
        .find((record) => record.id === id)!
        .fields.map((field) => [field.name, field.value]),
    );
  const material: MatchingEvidenceMaterial = {
    context: structuredClone(f.context),
    directory: {
      people: [
        ...f.context.people.map((person) => ({
          id: person.id,
          name: z.string().parse(fields('person-' + person.id).name),
          organizationId: 'demo-org',
        })),
        { id: 'hr', name: '演示·HR', organizationId: 'demo-org' },
      ],
      organizations: [{ id: 'demo-org', name: '演示组' }],
    },
    projects: [],
    events: f.facts.map((fact) => ({
      id: fact.recordId,
      personId: fact.personId,
      projectId: null,
      evaluationNodeId:
        f.records.find((r) => r.id === fact.recordId)!.subject
          .evaluationNodeId ?? null,
      situation: z.string().parse(fields(fact.recordId).situation),
      behavior: z.string().parse(fields(fact.recordId).behavior),
      impact: z.string().parse(fields(fact.recordId).impact),
    })),
    eventSources: f.facts.map((fact) => ({
      eventId: fact.recordId,
      fragmentId: 'fragment-' + fact.personId,
      originalVersionId: 'version-' + fact.personId,
    })),
    confirmations: structuredClone(f.facts),
    sources: structuredClone(f.rawSources),
    sourceDetails: structuredClone(f.sources),
  };
  material.context.people.push({ id: 'hr', noReview: true });
  const service = createStaffingMatchUsecase({
    ...f.dependencies,
    loadEvidence: async (_account, today) =>
      assembleMatchingEvidence({
        ...material,
        context: { ...material.context, now: today },
      }),
  });
  return { ...f, material, service };
}
it('assembles raw domain data through the existing model authorization entry without inventing actor or sources', async () => {
  const f = fixture();
  const result = z
    .object({ status: z.literal('success'), runId: z.string() })
    .parse(
      await f.service.start('account-hr', {
        operationId: 'material',
        demandId: 'demand-a',
        expectedRevision: 2,
      }),
    );
  await f.service.execute(result.runId, 1);
  expect(f.decide).toHaveBeenCalledTimes(4);
  expect(JSON.stringify(f.decide.mock.calls)).not.toContain('fragment-hidden');
  const assembled = assembleMatchingEvidence(f.material);
  expect(assembled.actor).toEqual({ id: 'hr', name: '演示·HR' });
  expect(assembled.snapshot.sources).toBe(f.material.sources);
  expect(assembled.sources).toBe(f.material.sourceDetails);
});
it('requires active event confirmation facts and keeps complete co-subject provenance even for excluded events', async () => {
  const f = fixture();
  f.material.confirmations[0]!.state = 'draft';
  f.material.confirmations[1]!.active = false;
  const result = z.object({ runId: z.string() }).parse(
    await f.service.start('account-hr', {
      operationId: 'unconfirmed',
      demandId: 'demand-a',
      expectedRevision: 2,
    }),
  );
  await f.service.execute(result.runId, 1);
  expect(f.decide).toHaveBeenCalledTimes(2);
  expect(assembleMatchingEvidence(f.material).snapshot.sources).toHaveLength(
    f.rawSources.length,
  );
});
it('fails closed on missing real actor, organization or ambiguous confirmation nature', () => {
  const f = fixture();
  const missingActor = structuredClone(f.material);
  missingActor.directory.people = missingActor.directory.people.filter(
    (person) => person.id !== 'hr',
  );
  expect(() => assembleMatchingEvidence(missingActor)).toThrow('forbidden');
  const missingOrg = structuredClone(f.material);
  missingOrg.directory.organizations = [];
  expect(() => assembleMatchingEvidence(missingOrg)).toThrow('conflict');
  const ambiguous = structuredClone(f.material);
  ambiguous.confirmations.push({
    ...ambiguous.confirmations[0]!,
    nature: 'self_report',
  });
  expect(() => assembleMatchingEvidence(ambiguous)).toThrow('conflict');
});
it('keeps actual project period and fact nature while rejecting an unresolved project relation', async () => {
  const f = fixture();
  f.material.projects.push({ id: 'project-a', cohortId: 'cohort-a' });
  f.material.events[0]!.projectId = 'project-a';
  f.material.confirmations[0]!.nature = 'original_fact';
  expect(
    assembleMatchingEvidence(f.material).snapshot.records.find(
      (record) => record.id === 'event-demo-a',
    ),
  ).toMatchObject({ subject: { cohortId: 'cohort-a' }, kind: 'evaluation' });
  const result = z.object({ runId: z.string() }).parse(
    await f.service.start('account-hr', {
      operationId: 'period',
      demandId: 'demand-a',
      expectedRevision: 2,
    }),
  );
  await f.service.execute(result.runId, 1);
  expect(f.decide.mock.calls[0]![0].evidence[0]!.text).toContain(
    'original_fact',
  );
  f.material.events[0]!.projectId = 'unresolved';
  expect(() => assembleMatchingEvidence(f.material)).toThrow('conflict');
});
it('does not choose between contradictory identities supplied by a trusted data adapter', async () => {
  const f = fixture();
  f.material.directory.people.push({
    ...f.material.directory.people[0]!,
    name: '演示·身份未核对',
  });
  expect(
    await f.service.start('account-hr', {
      operationId: 'identity',
      demandId: 'demand-a',
      expectedRevision: 2,
    }),
  ).toMatchObject({ status: 'conflict' });
  expect(f.decide).not.toHaveBeenCalled();
});

it('旧事件的管理观察确认不会被装配为匹配证据，也不调用模型', async () => {
  const f = fixture();
  f.material.confirmations.forEach((fact) => {
    fact.nature = 'management_observation';
  });
  const assembled = assembleMatchingEvidence(f.material);
  expect(
    assembled.snapshot.records.every((record) => record.kind === 'person'),
  ).toBe(true);
  const { runId } = z.object({ runId: z.string() }).parse(
    await f.service.start('account-hr', {
      operationId: 'observations',
      demandId: 'demand-a',
      expectedRevision: 2,
    }),
  );
  await f.service.execute(runId, 1);
  expect(f.decide).not.toHaveBeenCalled();
});

it('同一人员有多个节点时保留事件真实节点，不取第一个可关联节点', () => {
  const f = fixture(),
    event = f.material.events[0]!;
  const target = 'explicit-event-node';
  f.material.context.evaluationNodes.push({
    id: target,
    kind: 'defense',
    cohortId: 'cohort-a',
  });
  f.material.context.evaluationNodeSubjects.push({
    evaluationNodeId: target,
    personId: event.personId,
  });
  event.evaluationNodeId = target;
  for (const source of f.material.sources)
    for (const subject of source.subjects)
      if (subject.personId === event.personId)
        subject.evaluationNodeId = target;
  const actual = assembleMatchingEvidence(f.material).snapshot.records.find(
    (record) => record.id === event.id,
  );
  expect(actual?.subject).toEqual({
    personId: event.personId,
    evaluationNodeId: target,
    cohortId: 'cohort-a',
  });
});
it('事件的实际节点不在完整事实中时不改挂该人的其他节点', () => {
  const f = fixture(),
    event = f.material.events[0]!;
  event.evaluationNodeId = 'unknown-event-node';
  expect(
    f.material.context.evaluationNodeSubjects.some(
      (s) => s.personId === event.personId,
    ),
  ).toBe(true);
  expect(
    assembleMatchingEvidence(f.material).snapshot.records.some(
      (record) => record.id === event.id,
    ),
  ).toBe(false);
});
