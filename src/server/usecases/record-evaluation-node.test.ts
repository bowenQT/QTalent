import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/client';
import type { ArrangeActor } from './record-arrange-context';
import { exampleSnapshot } from '../modules/records/arrange/examples';
import { ForbiddenError } from './project-context';
import {
  createRecordEvaluationNodeResolver,
  resolveRecordEvaluationNode,
} from './record-evaluation-node';
const mocks = vi.hoisted(() => ({ load: vi.fn(), database: vi.fn() }));
vi.mock('./record-arrange-context', async (original) => ({
  ...(await original<typeof import('./record-arrange-context')>()),
  loadArrangeActor: mocks.load,
}));
vi.mock('../db/client', () => ({ getDatabase: mocks.database }));
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
        photo: null,
        hue: 220,
        demo: true,
      })),
      organizations: [{ id: 'demo-org', name: '演示组织', shortName: '演示' }],
    },
    staffing: { projects: [], members: [] },
  };
}

function setup() {
  const a = actor();
  const tx = {};
  const transaction = vi.fn(async (work: (tx: unknown) => Promise<unknown>) =>
    work(tx),
  );
  const db = { transaction } as unknown as Database;
  mocks.load.mockResolvedValue(a);
  mocks.database.mockReturnValue(db);
  return {
    a,
    tx,
    transaction,
    resolve: createRecordEvaluationNodeResolver({
      db,
      businessNow: () => a.context.now,
    }),
  };
}
const input = { personIds: ['demo-lin'], projectId: null };
beforeEach(() => vi.resetAllMocks());
describe('server-side record node resolution', () => {
  it('uses one current read-only repeatable snapshot and the native policy', async () => {
    const f = setup();
    await expect(f.resolve('demo-account', input)).resolves.toEqual({
      status: 'unique',
      evaluationNodeId: 'demo-node',
    });
    expect(mocks.load).toHaveBeenCalledWith(
      f.tx,
      'demo-account',
      f.a.context.now,
    );
    expect(f.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    });
  });
  it('exposes the actual default database entry without a model or queue', async () => {
    setup();
    await expect(
      resolveRecordEvaluationNode('demo-account', input),
    ).resolves.toEqual({ status: 'unique', evaluationNodeId: 'demo-node' });
    expect(mocks.database).toHaveBeenCalledOnce();
  });
  it('does not pick the first of two valid nodes or disclose their identities', async () => {
    const f = setup();
    f.a.context.evaluationNodes.push({
      ...f.a.context.evaluationNodes[0]!,
      id: 'second',
    });
    f.a.context.evaluationNodeSubjects.push({
      evaluationNodeId: 'second',
      personId: 'demo-lin',
    });
    f.a.context.evaluationRelations.push({
      ...f.a.context.evaluationRelations[0]!,
      id: 'second-relation',
      evaluationNodeId: 'second',
    });
    await expect(f.resolve('demo-account', input)).resolves.toEqual({
      status: 'multiple',
    });
  });
  it('requires every selected person in the same writable node', async () => {
    const f = setup();
    f.a.context.evaluationRelations = f.a.context.evaluationRelations.filter(
      (r) => r.personId === 'demo-lin',
    );
    await expect(
      f.resolve('demo-account', {
        ...input,
        personIds: ['demo-lin', 'demo-xu'],
      }),
    ).resolves.toEqual({ status: 'none' });
  });
  it('deduplicates nodes rather than counting current relations', async () => {
    const f = setup();
    f.a.context.evaluationRelations.push({
      ...f.a.context.evaluationRelations[0]!,
      id: 'duplicate',
    });
    await expect(f.resolve('demo-account', input)).resolves.toMatchObject({
      status: 'unique',
    });
  });
  it.each([
    'revoked',
    'expired',
    'future',
    'unbound',
    'no-review',
    'unknown-node',
    'system-admin',
  ] as const)('rejects %s through existing policy', async (mode) => {
    const f = setup();
    const r = f.a.context.evaluationRelations[0]!;
    if (mode === 'revoked') r.revokedAt = '2026-01-01T00:00:00Z';
    if (mode === 'expired') r.validTo = f.a.context.now;
    if (mode === 'future') r.validFrom = '2099-01-01T00:00:00Z';
    if (mode === 'unbound') f.a.context.account.personId = 'other';
    if (mode === 'no-review') f.a.context.people[0]!.noReview = true;
    if (mode === 'unknown-node') f.a.context.evaluationNodes = [];
    if (mode === 'system-admin') f.a.context.account.isSystemAdmin = true;
    await expect(f.resolve('demo-account', input)).resolves.toEqual({
      status: 'none',
    });
  });
  it('does not use unknown project IDs as permission', async () => {
    const f = setup();
    await expect(
      f.resolve('demo-account', { ...input, projectId: 'hidden' }),
    ).resolves.toEqual({ status: 'none' });
  });
  it.each([
    null,
    {},
    { personIds: [], projectId: null },
    { personIds: ['demo-lin', 'demo-lin'], projectId: null },
    { personIds: [' '], projectId: null },
    { ...input, evaluationNodeId: 'forged' },
    { ...input, projectId: undefined },
  ])(
    'rejects invalid or empty selection without reading identities: %j',
    async (value) => {
      const f = setup();
      await expect(f.resolve('demo-account', value)).resolves.toEqual({
        status: 'none',
      });
      expect(mocks.load).not.toHaveBeenCalled();
    },
  );
  it('rejects a blank account before loading', async () => {
    const f = setup();
    await expect(f.resolve(' ', input)).resolves.toEqual({ status: 'none' });
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it('maps absent native identity to none', async () => {
    const f = setup();
    mocks.load.mockRejectedValue(new ForbiddenError());
    await expect(f.resolve('missing', input)).resolves.toEqual({
      status: 'none',
    });
  });
  it('sanitizes dependency failures rather than misreporting absence', async () => {
    const f = setup();
    mocks.load.mockRejectedValue(new Error('synthetic-private-connection'));
    const error = await f.resolve('demo-account', input).catch((e) => e);
    expect(error).toMatchObject({
      name: 'RecordNodeResolutionUnavailable',
      message: 'unavailable',
    });
    expect(error).not.toHaveProperty('cause');
    expect(JSON.stringify(error)).not.toContain('private');
  });
  it('rejects an invalid business clock before reading', async () => {
    const f = setup();
    f.a.context.now = 'invalid';
    await expect(f.resolve('demo-account', input)).rejects.toMatchObject({
      message: 'unavailable',
    });
    expect(mocks.load).not.toHaveBeenCalled();
  });
});

it('sanitizes production database initialization failures', async () => {
  mocks.database.mockImplementation(() => {
    throw new Error('synthetic-private-dsn');
  });
  await expect(
    resolveRecordEvaluationNode('demo-account', input),
  ).rejects.toMatchObject({
    name: 'RecordNodeResolutionUnavailable',
    message: 'unavailable',
  });
});
