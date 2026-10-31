import { expect, it } from 'vitest';
import type { EvaluationAuthzContext } from '../authz/evaluation-node';
import type { MaterialSourceReference } from '../../contracts/sources';
import type {
  NodeConclusionOperation,
  NodeConclusionVersion,
  NodeScoreAuthority,
  ResolvedNodeConclusionSource,
} from '../modules/programs/node-conclusion';
import {
  createNodeConclusionUsecase,
  type NodeConclusionAudit,
  type NodeConclusionDependencies,
} from './node-conclusion';

type State = {
  versions: NodeConclusionVersion[];
  operations: Map<string, NodeConclusionOperation>;
  audits: NodeConclusionAudit[];
};
function fixture() {
  const identity = { evaluationNodeId: 'defense-a', personId: 'demo-a' };
  const reference: MaterialSourceReference = {
    fragmentId: 'fragment-a',
    originalVersionId: 'original-v1',
    location: { kind: 'spreadsheet', sheet: '答辩评审（演示）', cell: 'B2' },
  };
  const context: EvaluationAuthzContext = {
    account: { id: 'account-hr', personId: 'hr', isSystemAdmin: false },
    now: '2026-09-04T00:00:00.000Z',
    people: [{ id: 'demo-a', noReview: false }],
    grants: [
      {
        accountId: 'account-hr',
        role: 'hr',
        scope: 'cohort',
        cohortId: 'cohort-a',
        validFrom: '2026-01-01',
        validTo: null,
        revokedAt: null,
      },
    ],
    enrollments: [
      {
        personId: 'demo-a',
        cohortId: 'cohort-a',
        confirmed: true,
        validFrom: '2026-01-01',
        validTo: null,
        revokedAt: null,
      },
    ],
    assignments: [],
    projects: [],
    members: [],
    evaluationNodes: [
      { id: 'defense-a', kind: 'defense', cohortId: 'cohort-a' },
    ],
    evaluationNodeSubjects: [identity],
    evaluationRelations: [],
  };
  const f = {
    identity,
    reference,
    context,
    sources: [
      {
        reference,
        subjects: [identity],
        kind: 'evaluation',
        requiredKinds: [],
      },
    ] as ResolvedNodeConclusionSource[] | null,
    scores: {
      ...identity,
      status: 'ready',
      revision: '846-confirmations-r1',
      confirmations: [
        {
          confirmationId: 'confirmation-a',
          evaluatorId: 'judge-a',
          version: 1,
          confirmedAt: '2026-09-03T12:00:00Z',
        },
      ],
    } as NodeScoreAuthority | null,
    state: { versions: [], operations: new Map(), audits: [] } as State,
    events: [] as string[],
    failAt: '' as '' | 'audit' | 'operation',
    revokeAfterLock: false,
    revokeDuringSources: false,
    spoofActor: false,
    wrongAccount: false,
    staleClock: false,
    txCount: 0,
    scoreReads: 0,
    nextId: 0,
  };
  let tail: Promise<unknown> = Promise.resolve();
  const key = (account: string, operation: string) =>
    JSON.stringify([account, operation]);
  const deps: NodeConclusionDependencies<State> = {
    environment: 'test',
    transaction: async (run) => {
      const task = tail.then(async () => {
        f.txCount++;
        const copy = structuredClone(f.state);
        const result = await run(copy);
        f.state = structuredClone(copy);
        return result;
      });
      tail = task.catch(() => undefined);
      return task;
    },
    lockOperation: async () => {
      f.events.push('operation-lock');
    },
    lockConclusion: async () => {
      f.events.push('conclusion-lock');
      if (f.revokeAfterLock)
        f.context.grants[0]!.revokedAt = '2026-09-04T00:00:00Z';
    },
    loadAuthorization: async (_tx, account, now) => {
      f.events.push('authorization');
      return {
        context: {
          ...structuredClone(f.context),
          account: {
            ...f.context.account,
            id: f.wrongAccount ? 'unrelated-account' : account,
          },
          now: f.staleClock ? '2026-09-03T00:00:00Z' : now,
        },
        actor: {
          id: f.spoofActor ? 'judge-a' : f.context.account.personId,
          name: '演示·服务端姓名',
        },
      };
    },
    readCurrent: async (tx, who) =>
      tx.versions
        .filter(
          (v) =>
            v.evaluationNodeId === who.evaluationNodeId &&
            v.personId === who.personId,
        )
        .at(-1) ?? null,
    readVersion: async (tx, who, version) =>
      tx.versions.find(
        (v) =>
          v.evaluationNodeId === who.evaluationNodeId &&
          v.personId === who.personId &&
          v.version === version,
      ) ?? null,
    readOperation: async (tx, account, operation) =>
      tx.operations.get(key(account, operation)) ?? null,
    readScoreConfirmations: async () => {
      f.scoreReads++;
      return structuredClone(f.scores);
    },
    resolveSources: async () => {
      if (f.revokeDuringSources)
        f.context.grants[0]!.revokedAt = '2026-09-04T00:00:00Z';
      return structuredClone(f.sources);
    },
    appendVersion: async (tx, record, expected) => {
      const previous = tx.versions
        .filter(
          (v) =>
            v.evaluationNodeId === record.evaluationNodeId &&
            v.personId === record.personId,
        )
        .at(-1);
      if (
        (previous?.version ?? 0) !== expected ||
        tx.versions.some(
          (v) => v.id === record.id && v.version === record.version,
        )
      )
        throw new Error('memory CAS violation');
      tx.versions.push(structuredClone(record));
      f.events.push('append-version');
    },
    appendAudit: async (tx, audit) => {
      if (f.failAt === 'audit') throw new Error('audit unavailable');
      tx.audits.push(structuredClone(audit));
    },
    saveOperation: async (tx, account, operation, value) => {
      if (f.failAt === 'operation') throw new Error('operation unavailable');
      tx.operations.set(key(account, operation), structuredClone(value));
    },
    newId: () => 'conclusion-' + ++f.nextId,
    wallNow: () => new Date('2031-04-05T06:07:08.000Z'),
  };
  const command = {
    ...identity,
    operationId: 'op-a',
    expectedVersion: 0,
    expectedScoreRevision: '846-confirmations-r1',
    conclusion: '演示：答辩通过，结论由HR确认。',
    basisReferences: [reference],
  };
  return { f, deps, command, service: createNodeConclusionUsecase(deps) };
}
it('锁后加载当前服务器身份，追加结论/审计/幂等回执同一事务，不制造关键事件', async () => {
  const { f, service, command } = fixture();
  const result = await service.confirm('account-hr', command);
  expect(result).toMatchObject({
    status: 'success',
    replayed: false,
    conclusion: {
      ...f.identity,
      version: 1,
      origin: 'human_conclusion',
      confirmedBy: { id: 'hr', name: '演示·服务端姓名' },
      confirmedAt: '2031-04-05T06:07:08.000Z',
    },
  });
  expect(f.events.slice(0, 3)).toEqual([
    'operation-lock',
    'conclusion-lock',
    'authorization',
  ]);
  expect(f.state.versions).toHaveLength(1);
  expect(f.state.audits).toHaveLength(1);
  expect(f.state.operations.size).toBe(1);
  expect(Object.keys(f.state).sort()).toEqual([
    'audits',
    'operations',
    'versions',
  ]);
  expect(JSON.stringify(f.state.versions)).not.toMatch(
    /eventId|records_statements|employmentStatus/,
  );
});
it('相同请求只确认一次，内容变化冲突；重放前仍检查当前权限与原件', async () => {
  const { f, service, command } = fixture();
  expect((await service.confirm('account-hr', command)).status).toBe('success');
  expect(await service.confirm('account-hr', command)).toMatchObject({
    status: 'success',
    replayed: true,
  });
  expect(f.scoreReads).toBe(1);
  expect(
    (
      await service.confirm('account-hr', {
        ...command,
        conclusion: '演示：不同结论',
      })
    ).status,
  ).toBe('conflict');
  f.sources = null;
  expect((await service.confirm('account-hr', command)).status).toBe(
    'forbidden',
  );
  f.context.grants[0]!.revokedAt = '2026-09-04T00:00:00Z';
  expect((await service.confirm('account-hr', command)).status).toBe(
    'forbidden',
  );
  expect(f.state.versions).toHaveLength(1);
  expect(f.state.audits).toHaveLength(1);
});
it('不同请求并发提交旧版本只成功一次，不能覆盖另一人的确认', async () => {
  const { f, service, command } = fixture();
  const results = await Promise.all([
    service.confirm('account-hr', command),
    service.confirm('account-hr', {
      ...command,
      operationId: 'op-b',
      conclusion: '演示：并发的另一结论',
    }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual(['conflict', 'success']);
  expect(f.state.versions).toHaveLength(1);
});
it('相同请求并发重放只产生一个版本与审计', async () => {
  const { f, service, command } = fixture();
  const results = await Promise.all([
    service.confirm('account-hr', command),
    service.confirm('account-hr', command),
  ]);
  expect(results.every((r) => r.status === 'success')).toBe(true);
  expect(f.state.versions).toHaveLength(1);
  expect(f.state.audits).toHaveLength(1);
});
it('后续确认追加版本，旧版本及其署名/出处仍可按版本读取', async () => {
  const { f, service, command } = fixture();
  await service.confirm('account-hr', command);
  const first = structuredClone(f.state.versions[0]!);
  expect(
    (
      await service.confirm('account-hr', {
        ...command,
        operationId: 'op-b',
        expectedVersion: 1,
        conclusion: '演示：第二版人工结论。',
      })
    ).status,
  ).toBe('success');
  expect(f.state.versions).toHaveLength(2);
  expect(f.state.versions[0]).toEqual(first);
  expect(
    await service.read('account-hr', { ...f.identity, version: 1 }),
  ).toMatchObject({ status: 'success', conclusion: first });
  expect(await service.read('account-hr', f.identity)).toMatchObject({
    status: 'success',
    conclusion: { version: 2 },
  });
  expect(
    (await service.read('account-hr', { ...f.identity, version: 99 })).status,
  ).toBe('not_found');
});
it.each(['audit', 'operation'] as const)(
  '%s失败时不留下半个版本或回执，基础设施异常不冒充业务成功',
  async (at) => {
    const { f, service, command } = fixture();
    f.failAt = at;
    await expect(service.confirm('account-hr', command)).rejects.toThrow(at);
    expect(f.state.versions).toEqual([]);
    expect(f.state.audits).toEqual([]);
    expect(f.state.operations.size).toBe(0);
  },
);
it.each(['pending', 'unavailable', 'missing'] as const)(
  '846权威状态%s时不确认，没有生产默认就绪',
  async (status) => {
    const { f, service, command } = fixture();
    f.scores = status === 'missing' ? null : { ...f.identity, status };
    expect((await service.confirm('account-hr', command)).status).toBe(
      'conflict',
    );
    expect(f.state.versions).toEqual([]);
    expect(f.state.audits).toEqual([]);
  },
);
it('等锁期间撤权按锁后的上下文拒绝', async () => {
  const { f, service, command } = fixture();
  f.revokeAfterLock = true;
  expect((await service.confirm('account-hr', command)).status).toBe(
    'forbidden',
  );
  expect(f.scoreReads).toBe(0);
  expect(f.state.versions).toEqual([]);
});
it.each(['spoofActor', 'staleClock', 'wrongAccount'] as const)(
  '服务器端口返回%s时拒绝，不能用不匹配的身份/缓存时钟签署',
  async (mode) => {
    const { f, service, command } = fixture();
    f[mode] = true;
    expect((await service.confirm('account-hr', command)).status).toBe(
      'forbidden',
    );
    expect(f.state.versions).toEqual([]);
  },
);
it('管理者能只读当前可见结论，不能确认；评委不给额外节点结论权限', async () => {
  const { f, service, command } = fixture();
  await service.confirm('account-hr', command);
  f.context.account = {
    ...f.context.account,
    id: 'account-manager',
    personId: 'manager',
  };
  f.context.grants = [
    {
      ...f.context.grants[0]!,
      accountId: 'account-manager',
      role: 'manager',
      scope: 'company',
      cohortId: null,
    },
  ];
  expect((await service.read('account-manager', f.identity)).status).toBe(
    'success',
  );
  expect(
    (
      await service.confirm('account-manager', {
        ...command,
        operationId: 'manager-op',
        expectedVersion: 1,
      })
    ).status,
  ).toBe('forbidden');
  f.context.grants = [];
  f.context.account.personId = 'judge-a';
  expect((await service.read('account-judge', f.identity)).status).toBe(
    'forbidden',
  );
});
it('读取和重放不会泄露已失权原件引用；定位变化不当作同一引用', async () => {
  const { f, service, command } = fixture();
  await service.confirm('account-hr', command);
  f.sources![0]!.reference.location = {
    kind: 'spreadsheet',
    sheet: '另一页',
    cell: 'C5',
  };
  expect((await service.read('account-hr', f.identity)).status).toBe(
    'conflict',
  );
  expect((await service.confirm('account-hr', command)).status).toBe(
    'conflict',
  );
});
it('伪造签名/时间/角色、空依据和非法版本在入库前拒绝', async () => {
  const { f, service, command } = fixture();
  for (const raw of [
    { ...command, confirmedBy: { id: 'judge-a', name: '伪造' } },
    { ...command, role: 'hr' },
    { ...command, confirmedAt: '2031-01-01T00:00:00Z' },
    { ...command, basisReferences: [] },
    { ...command, expectedVersion: -1 },
  ])
    expect((await service.confirm('account-hr', raw)).status).toBe(
      'validation_error',
    );
  expect(
    (await service.read('account-hr', { ...f.identity, version: 0 })).status,
  ).toBe('validation_error');
  expect(f.txCount).toBe(0);
});
it('缺少权威确认/真实来源/持久化端口时构造失败，不偷偷启用fake', () => {
  const { deps } = fixture();
  expect(() =>
    createNodeConclusionUsecase({
      ...deps,
      readScoreConfirmations: undefined,
    } as unknown as NodeConclusionDependencies<State>),
  ).toThrow(/readScoreConfirmations/);
});

it('读取端口返回另一版本或已损坏的幂等记录时拒绝，不外发错误历史', async () => {
  const { f, deps, service, command } = fixture();
  await service.confirm('account-hr', command);
  await service.confirm('account-hr', {
    ...command,
    operationId: 'op-b',
    expectedVersion: 1,
  });
  const wrongVersion = createNodeConclusionUsecase({
    ...deps,
    readVersion: async () => f.state.versions[1]!,
  });
  expect(
    (await wrongVersion.read('account-hr', { ...f.identity, version: 1 }))
      .status,
  ).toBe('conflict');
  const operation = f.state.operations.get(
    JSON.stringify(['account-hr', 'op-a']),
  )!;
  operation.conclusion.personId = 'other-person';
  expect((await service.confirm('account-hr', command)).status).toBe(
    'conflict',
  );
});

it('来源解析等待期间撤权，确认/读取/重放均使用解析后的当前权限', async () => {
  const first = fixture();
  first.f.revokeDuringSources = true;
  expect(
    (await first.service.confirm('account-hr', first.command)).status,
  ).toBe('forbidden');
  expect(first.f.state.versions).toEqual([]);
  for (const action of ['read', 'replay'] as const) {
    const next = fixture();
    await next.service.confirm('account-hr', next.command);
    next.f.revokeDuringSources = true;
    const result =
      action === 'read'
        ? await next.service.read('account-hr', next.f.identity)
        : await next.service.confirm('account-hr', next.command);
    expect(result.status).toBe('forbidden');
    expect(next.f.state.versions).toHaveLength(1);
  }
});
it('所据评分确认版本变化时不写入新结论', async () => {
  const { f, service, command } = fixture();
  expect(
    (
      await service.confirm('account-hr', {
        ...command,
        expectedScoreRevision: 'old-revision',
      })
    ).status,
  ).toBe('conflict');
  expect(f.state.versions).toEqual([]);
});
