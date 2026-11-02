import { expect, it } from 'vitest';
import type {
  SpeakerBindingSnapshot,
  SpeakerBindingAuthority,
  SpeakerBindingPlan,
} from '../modules/records/speaker-binding';
import { speakerBindingCommandSchema } from '../modules/records/speaker-binding';
import {
  createSpeakerBindingUsecase,
  type SpeakerBindingDependencies,
  type SpeakerBindingOperation,
} from './speaker-binding';
type State = {
  snapshot: SpeakerBindingSnapshot;
  operations: Map<string, SpeakerBindingOperation>;
  decisions: SpeakerBindingPlan['decisions'];
  audits: number;
  resumed: string[];
  invalidated: string[];
};
function fixture() {
  const subject = { evaluationNodeId: 'node-a', personId: 'demo-a' };
  const snapshot: SpeakerBindingSnapshot = {
    batchId: 'batch-a',
    materialId: 'material-a',
    evaluationNodeId: 'node-a',
    membershipRevision: 2,
    members: [subject],
    sourceScopeComplete: true,
    sourceSubjects: [subject],
    sourceKind: 'evaluation',
    requiredKinds: [],
    inventoryComplete: true,
    transcript: {
      id: 'transcript-a',
      recordingId: 'recording-a',
      originalVersionId: 'original-a',
      providerTaskId: 'provider-task',
      durationMs: 1000,
      fragments: [0, 1].map((i) => ({
        source: {
          fragmentId: 'fragment-' + i,
          originalVersionId: 'original-a',
          location: {
            kind: 'recording',
            startMs: i * 100,
            endMs: i * 100 + 100,
          },
        },
        reviewItemId: 'item-' + i,
        providerSentenceId: 'sentence-' + i,
        providerSpeakerId: i === 0 ? 'speaker-a' : null,
        quote: '演示原句' + i,
      })),
    },
    context: {
      recordingId: 'recording-a',
      jobId: 'job-a',
      attempt: 1,
      originalVersionId: 'original-a',
      recordCollectionId: 'collection-a',
      bindingRevision: 1,
      canProcess: true,
      cancelRequested: false,
      resumeGrant: null,
    },
    bindings: {
      revision: 1,
      resolutions: [0, 1].map((i) => ({
        fragmentId: 'fragment-' + i,
        state: 'pending',
        candidates: [],
      })),
    },
    itemRevisions: { 'item-0': 1, 'item-1': 1 },
    otherReviewItemIds: [],
    otherBlockingReviewItemIds: [],
    derived: { bindingRevision: 1, draftIds: [], confirmedResultIds: [] },
  };
  const authority: SpeakerBindingAuthority = {
    context: {
      account: { id: 'account-hr', personId: 'hr', isSystemAdmin: false },
      now: '2026-09-04T00:00:00.000Z',
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
      people: [{ id: 'demo-a', noReview: false }],
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
        { id: 'node-a', kind: 'defense', cohortId: 'cohort-a' },
      ],
      evaluationNodeSubjects: [subject],
      evaluationRelations: [],
    },
    actor: { id: 'hr', name: '演示·HR' },
    directory: [{ id: 'demo-a', displayName: '演示·林序' }],
    processing: {
      accountId: 'account-hr',
      recordCollectionId: 'collection-a',
      membershipRevision: 2,
      allowed: true,
    },
  };
  const f = {
    authority,
    state: {
      snapshot,
      operations: new Map(),
      decisions: [],
      audits: 0,
      resumed: [],
      invalidated: [],
    } as State,
    events: [] as string[],
    failAt: '' as '' | 'audit' | 'resume' | 'save',
    revokeAfterResume: false,
    changedAfterResume: false,
    fakeResume: false,
    malformedInvalidation: false,
  };
  const key = (account: string, operation: string) =>
    JSON.stringify([account, operation]);
  let tail: Promise<unknown> = Promise.resolve();
  const deps: SpeakerBindingDependencies<State> = {
    environment: 'test',
    wallNow: () => new Date('2031-04-05T06:07:08.000Z'),
    transaction: async (run) => {
      const job = tail.then(async () => {
        const tx = structuredClone(f.state);
        const result = await run(tx);
        f.state = structuredClone(tx);
        return result;
      });
      tail = job.catch(() => undefined);
      return job;
    },
    lockOperation: async () => {
      f.events.push('operation-lock');
    },
    locate: async (_tx, batch, item) =>
      batch === 'batch-a' && ['item-0', 'item-1'].includes(item)
        ? { recordingId: 'recording-a' }
        : null,
    lockRecording: async () => {
      f.events.push('recording-lock');
    },
    loadSnapshot: async (tx) => tx.snapshot,
    loadAuthority: async (_tx, _account, _snapshot, now) => {
      f.events.push('authority');
      return {
        ...structuredClone(f.authority),
        context: { ...structuredClone(f.authority.context), now },
      };
    },
    readOperation: async (tx, account, operation) =>
      tx.operations.get(key(account, operation)) ?? null,
    commitChange: async (tx, before, plan) => {
      if (
        tx.snapshot.bindings.revision !== plan.expectedBindingRevision ||
        tx.snapshot.itemRevisions[plan.receipt.itemId] !==
          plan.expectedItemRevision
      )
        throw new Error('memory CAS violation');
      expect(before.transcript.id).toBe('transcript-a');
      tx.snapshot.bindings = structuredClone(plan.bindings);
      tx.snapshot.context.bindingRevision = plan.bindings.revision;
      tx.snapshot.itemRevisions = structuredClone(plan.itemRevisions);
      tx.decisions.push(...structuredClone(plan.decisions));
      if (plan.bindingChanged) tx.snapshot.context.resumeGrant = null;
    },
    invalidateDrafts: async (tx, _before, plan) => {
      if (f.malformedInvalidation) return [];
      tx.invalidated.push(...plan.invalidatedDraftIds);
      tx.snapshot.derived = {
        bindingRevision: plan.bindings.revision,
        draftIds: [],
        confirmedResultIds: [],
      };
      return [...plan.invalidatedDraftIds];
    },
    commitResume: async (tx, input) => {
      if (f.failAt === 'resume') throw new Error('resume failed');
      if (!f.fakeResume) {
        tx.snapshot.context.resumeGrant = structuredClone(input.grant);
        if (!tx.resumed.includes(input.operationKey))
          tx.resumed.push(input.operationKey);
      }
      if (f.revokeAfterResume)
        f.authority.context.grants[0]!.revokedAt = '2026-09-04T00:00:00Z';
      if (f.changedAfterResume)
        tx.snapshot.transcript.id = 'changed-transcript';
      return { jobId: input.work.jobId };
    },
    appendAudit: async (tx) => {
      if (f.failAt === 'audit') throw new Error('audit failed');
      tx.audits++;
    },
    saveOperation: async (tx, account, operation, value) => {
      if (f.failAt === 'save') throw new Error('save failed');
      tx.operations.set(key(account, operation), structuredClone(value));
    },
  };
  const command = speakerBindingCommandSchema.parse({
    kind: 'speaker',
    batchId: 'batch-a',
    itemId: 'item-0',
    operationId: 'op-a',
    expectedRevision: 1,
    resolution: { action: 'bind', personId: 'demo-a' },
  });
  return { f, deps, command, service: createSpeakerBindingUsecase(deps) };
}
it('绑定与恢复使用同事务/真实ledger，null语段仍需显式人工决策', async () => {
  const { f, service, command } = fixture();
  expect(await service.apply('account-hr', command)).toMatchObject({
    status: 'success',
    replayed: false,
    result: { revision: 2, remainingReviewItemIds: ['item-1'], resume: null },
  });
  expect(f.state.resumed).toEqual([]);
  expect(f.events.slice(0, 3)).toEqual([
    'operation-lock',
    'recording-lock',
    'authority',
  ]);
  const last = { ...command, itemId: 'item-1', operationId: 'op-b' };
  expect(await service.apply('account-hr', last)).toMatchObject({
    status: 'success',
    result: {
      remainingReviewItemIds: [],
      resume: { stage: 'organizing', jobId: 'job-a' },
    },
  });
  expect(f.state.snapshot.context.resumeGrant).toEqual({
    recordingId: 'recording-a',
    transcriptVersionId: 'transcript-a',
    bindingRevision: 3,
    operationId: 'op-b',
  });
  expect(f.state.resumed).toHaveLength(1);
  expect(f.state.decisions).toHaveLength(2);
});
it('同键重放不重复决定/恢复，同键异内容冲突；重放前仍查当前写权', async () => {
  const { f, service, command } = fixture();
  await service.apply('account-hr', command);
  expect(await service.apply('account-hr', command)).toMatchObject({
    status: 'success',
    replayed: true,
  });
  expect(
    (
      await service.apply('account-hr', {
        ...command,
        resolution: { action: 'mark_irrelevant' },
      })
    ).status,
  ).toBe('conflict');
  f.authority.processing.allowed = false;
  expect((await service.apply('account-hr', command)).status).toBe('forbidden');
  expect(f.state.decisions).toHaveLength(1);
  expect(f.state.audits).toBe(1);
});
it('稍后无恢复；撤销追加人工变更而不删除已有ledger', async () => {
  const { f, service, command } = fixture();
  await service.apply('account-hr', {
    ...command,
    resolution: { action: 'defer' },
  });
  expect(f.state.snapshot.bindings.revision).toBe(1);
  expect(f.state.resumed).toEqual([]);
  await service.apply('account-hr', {
    ...command,
    operationId: 'bind',
    expectedRevision: 2,
  });
  const prior = structuredClone(f.state.decisions);
  await service.apply('account-hr', {
    ...command,
    operationId: 'unbind',
    expectedRevision: 3,
    resolution: { action: 'unbind' },
  });
  expect(f.state.decisions.slice(0, prior.length)).toEqual(prior);
  expect(f.state.snapshot.bindings.resolutions[0]!.state).toBe('pending');
});
it('两个不同请求竞争同一条目只成功一次', async () => {
  const { f, service, command } = fixture();
  const result = await Promise.all([
    service.apply('account-hr', command),
    service.apply('account-hr', {
      ...command,
      operationId: 'op-b',
      resolution: { action: 'mark_irrelevant' },
    }),
  ]);
  expect(result.map((v) => v.status).sort()).toEqual(['conflict', 'success']);
  expect(f.state.audits).toBe(1);
});
it.each(['audit', 'save'] as const)(
  '%s失败不留下半个绑定、审计或幂等回执',
  async (step) => {
    const { f, service, command } = fixture();
    f.failAt = step;
    await expect(service.apply('account-hr', command)).rejects.toThrow(step);
    expect(f.state.snapshot.bindings.resolutions[0]!.state).toBe('pending');
    expect(f.state.decisions).toEqual([]);
    expect(f.state.operations.size).toBe(0);
  },
);
it.each(['resume', 'fake_resume', 'revoked', 'changed_transcript'] as const)(
  '最后绑定时%s不产生半次恢复',
  async (mode) => {
    const { f, service, command } = fixture();
    await service.apply('account-hr', command);
    if (mode === 'resume') f.failAt = 'resume';
    if (mode === 'fake_resume') f.fakeResume = true;
    if (mode === 'revoked') f.revokeAfterResume = true;
    if (mode === 'changed_transcript') f.changedAfterResume = true;
    const last = { ...command, itemId: 'item-1', operationId: 'op-last' };
    if (mode === 'resume')
      await expect(service.apply('account-hr', last)).rejects.toThrow('resume');
    else
      expect((await service.apply('account-hr', last)).status).toBe(
        mode === 'revoked' ? 'forbidden' : 'conflict',
      );
    expect(f.state.snapshot.bindings.resolutions[1]!.state).toBe('pending');
    expect(f.state.resumed).toEqual([]);
    expect(f.state.operations.size).toBe(1);
  },
);
it('846失效必须返回实际全部草稿ID，确认结果不能静默撤销', async () => {
  const { f, service, command } = fixture();
  f.state.snapshot.derived!.draftIds = ['draft-a'];
  f.malformedInvalidation = true;
  expect((await service.apply('account-hr', command)).status).toBe('conflict');
  expect(f.state.snapshot.bindings.resolutions[0]!.state).toBe('pending');
  f.malformedInvalidation = false;
  f.state.snapshot.derived!.confirmedResultIds = ['confirmed-a'];
  expect((await service.apply('account-hr', command)).status).toBe('conflict');
  expect(f.state.invalidated).toEqual([]);
});
it('读取与动作都拒绝不完整原件范围，不由片段清单反推可见', async () => {
  const { f, service, command } = fixture();
  f.state.snapshot.sourceScopeComplete = false;
  expect(
    await service.read('account-hr', { batchId: 'batch-a', itemId: 'item-0' }),
  ).toMatchObject({ status: 'forbidden' });
  expect((await service.apply('account-hr', command)).status).toBe('forbidden');
  expect(f.state.operations.size).toBe(0);
});
it('非法/其他kind命令不调用绑定流程，未知条目与材料不透露正文', async () => {
  const { service, command } = fixture();
  expect(
    (
      await service.apply('account-hr', {
        ...command,
        kind: 'unknown_interviewer',
      })
    ).status,
  ).toBe('validation_error');
  expect(
    (await service.apply('account-hr', { ...command, actorId: 'fake' })).status,
  ).toBe('validation_error');
  expect(
    (await service.apply('account-hr', { ...command, itemId: 'missing' }))
      .status,
  ).toBe('not_found');
});
it('缺真实恢复或持久方法时构造失败，不启用fake默认', () => {
  const { deps } = fixture();
  expect(() =>
    createSpeakerBindingUsecase({
      ...deps,
      commitResume: undefined,
    } as unknown as SpeakerBindingDependencies<State>),
  ).toThrow(/commitResume/);
});

it('成功读取保留全部语段且使用当前目录；读取不授予处理写权', async () => {
  const { f, service, command } = fixture();
  f.authority.processing.allowed = false;
  const result = await service.read('account-hr', {
    batchId: 'batch-a',
    itemId: 'item-0',
  });
  expect(result).toMatchObject({
    status: 'success',
    result: {
      recordingId: 'recording-a',
      bindingRevision: 1,
      inventoryComplete: true,
      items: [
        {
          item: {
            state: 'pending',
            candidates: [{ personId: 'demo-a', displayName: '演示·林序' }],
          },
        },
        { item: { state: 'pending' }, providerSpeakerId: null },
      ],
    },
  });
  expect((await service.apply('account-hr', command)).status).toBe('forbidden');
  expect(
    await service.read('account-hr', { batchId: 'batch-a' }),
  ).toMatchObject({ status: 'validation_error' });
  expect(
    await service.read('account-hr', { batchId: 'missing', itemId: 'item-0' }),
  ).toMatchObject({ status: 'not_found' });
});
it('相同操作键也不能越过集合成员版本变化；回执不触发第二次决定', async () => {
  const { f, service, command } = fixture();
  await service.apply('account-hr', command);
  f.state.snapshot.membershipRevision++;
  f.authority.processing.membershipRevision++;
  expect((await service.apply('account-hr', command)).status).toBe('conflict');
  expect(f.state.decisions).toHaveLength(1);
});
it('提交端口未真正写绑定版本时回滚，不能仅凭成功返回值出回执', async () => {
  const { f, deps, command } = fixture();
  deps.commitChange = async () => undefined;
  const service = createSpeakerBindingUsecase(deps);
  expect((await service.apply('account-hr', command)).status).toBe('conflict');
  expect(f.state.decisions).toEqual([]);
  expect(f.state.operations.size).toBe(0);
});
it('审计后保存端口期间失权仍回滚；署名时间用墙钟，权限判断用业务时钟', async () => {
  const { f, deps, command } = fixture();
  const original = deps.saveOperation;
  deps.saveOperation = async (...args) => {
    await original(...args);
    f.authority.processing.allowed = false;
  };
  const service = createSpeakerBindingUsecase(deps);
  expect((await service.apply('account-hr', command)).status).toBe('forbidden');
  expect(f.state.operations.size).toBe(0);
  expect(f.state.audits).toBe(0);
  const good = fixture();
  await good.service.apply('account-hr', good.command);
  expect(good.f.state.decisions[0]!.at).toBe('2031-04-05T06:07:08.000Z');
});

it('整批已有绑定失去当前候选资格时，新增绑定与原操作重放均关闭', async () => {
  const { f, service, command } = fixture();
  await service.apply('account-hr', command);
  // Remove the actual current directory candidate, retaining immutable history.
  f.authority.directory = [];
  expect(
    (
      await service.apply('account-hr', {
        ...command,
        itemId: 'item-1',
        operationId: 'last',
      })
    ).status,
  ).toBe('forbidden');
  expect((await service.apply('account-hr', command)).status).toBe('forbidden');
  expect(f.state.resumed).toEqual([]);
  expect(f.state.operations.size).toBe(1);
});

it('最终897材料级恢复不被无关项扣住，并以同一回执重放', async () => {
  const { f, service, command } = fixture();
  f.state.snapshot.otherReviewItemIds = ['unrelated-image-review'];
  await service.apply('account-hr', command);
  const last = { ...command, itemId: 'item-1', operationId: 'last' };
  const result = await service.apply('account-hr', last);
  expect(result).toMatchObject({
    status: 'success',
    replayed: false,
    result: {
      materialId: 'material-a',
      resolution: last.resolution,
      remainingReviewItemIds: ['unrelated-image-review'],
      blockingReviewItemIds: [],
      resume: { stage: 'organizing', jobId: 'job-a' },
    },
  });
  expect(await service.apply('account-hr', last)).toMatchObject({
    status: 'success',
    replayed: true,
    result: result.status === 'success' ? result.result : null,
  });
  expect(f.state.resumed).toHaveLength(1);
});
it('本材料或受影响目标仍有其他种类阻塞时只绑定，不恢复', async () => {
  const { f, service, command } = fixture();
  f.state.snapshot.otherReviewItemIds = [
    'related-image-review',
    'unrelated-review',
  ];
  f.state.snapshot.otherBlockingReviewItemIds = ['related-image-review'];
  await service.apply('account-hr', command);
  expect(
    await service.apply('account-hr', {
      ...command,
      itemId: 'item-1',
      operationId: 'last',
    }),
  ).toMatchObject({
    status: 'success',
    result: {
      remainingReviewItemIds: ['related-image-review', 'unrelated-review'],
      blockingReviewItemIds: ['related-image-review'],
      resume: null,
    },
  });
  expect(f.state.resumed).toEqual([]);
});
it('恢复端口之后目标阻塞集合变化须整笔回滚', async () => {
  const { f, deps, service, command } = fixture();
  f.state.snapshot.otherReviewItemIds = ['image-review'];
  await service.apply('account-hr', command);
  const original = deps.commitResume;
  deps.commitResume = async (tx, input) => {
    const result = await original(tx, input);
    tx.snapshot.otherBlockingReviewItemIds = ['image-review'];
    return result;
  };
  expect(
    await service.apply('account-hr', {
      ...command,
      itemId: 'item-1',
      operationId: 'last',
    }),
  ).toMatchObject({ status: 'conflict' });
  expect(f.state.snapshot.bindings.resolutions[1]!.state).toBe('pending');
  expect(f.state.snapshot.otherBlockingReviewItemIds).toEqual([]);
  expect(f.state.resumed).toEqual([]);
  expect(f.state.operations.size).toBe(1);
});
it('真实grant已提交但返回另一个job也须回滚', async () => {
  const { f, deps, service, command } = fixture();
  await service.apply('account-hr', command);
  const original = deps.commitResume;
  deps.commitResume = async (tx, input) => {
    await original(tx, input);
    return { jobId: 'another-job' };
  };
  expect(
    await service.apply('account-hr', {
      ...command,
      itemId: 'item-1',
      operationId: 'last',
    }),
  ).toMatchObject({ status: 'conflict' });
  expect(f.state.snapshot.bindings.resolutions[1]!.state).toBe('pending');
  expect(f.state.resumed).toEqual([]);
});
it('草稿全部失效但端口返回的ID错误仍须回滚', async () => {
  const { f, deps, service, command } = fixture();
  f.state.snapshot.derived!.draftIds = ['draft-a'];
  const original = deps.invalidateDrafts;
  deps.invalidateDrafts = async (...args) => {
    await original(...args);
    return ['wrong-draft'];
  };
  expect(await service.apply('account-hr', command)).toMatchObject({
    status: 'conflict',
  });
  expect(f.state.snapshot.derived!.draftIds).toEqual(['draft-a']);
  expect(f.state.invalidated).toEqual([]);
  expect(f.state.operations.size).toBe(0);
});
it.each(['material', 'resolution'] as const)(
  '重放不得返回与已接受命令不一致的%s回执',
  async (mode) => {
    const { f, service, command } = fixture();
    await service.apply('account-hr', command);
    const op = f.state.operations.get(
      JSON.stringify(['account-hr', command.operationId]),
    )!;
    if (mode === 'material') op.result.materialId = 'other-material';
    else op.result.resolution = { action: 'mark_irrelevant' };
    expect(await service.apply('account-hr', command)).toMatchObject({
      status: 'conflict',
    });
    expect(f.state.decisions).toHaveLength(1);
  },
);

async function invalidMultiGroup(path: 'directory' | 'membership') {
  const f = fixture();
  const who = { personId: 'demo-b', evaluationNodeId: 'node-a' };
  f.f.state.snapshot.members.push(who);
  f.f.state.snapshot.sourceSubjects.push(who);
  f.f.authority.directory.push({ id: 'demo-b', displayName: '演示·夏禾' });
  f.f.authority.context.people.push({ id: 'demo-b', noReview: false });
  f.f.authority.context.enrollments.push({
    ...f.f.authority.context.enrollments[0]!,
    personId: 'demo-b',
  });
  f.f.authority.context.evaluationNodeSubjects.push(who);
  expect((await f.service.apply('account-hr', f.command)).status).toBe(
    'success',
  );
  expect(
    (
      await f.service.apply('account-hr', {
        ...f.command,
        itemId: 'item-1',
        operationId: 'initial-1',
      })
    ).status,
  ).toBe('success');
  if (path === 'directory')
    f.f.authority.directory = f.f.authority.directory.filter(
      (p) => p.id !== 'demo-a',
    );
  else {
    f.f.state.snapshot.members = f.f.state.snapshot.members.filter(
      (p) => p.personId !== 'demo-a',
    );
    f.f.state.snapshot.membershipRevision++;
    f.f.authority.processing.membershipRevision =
      f.f.state.snapshot.membershipRevision;
  }
  return f;
}
it.each(['directory', 'membership'] as const)(
  '%s失效后多组可逐个修复及幂等重放；没有完整有效绑定不恢复',
  async (path) => {
    for (const action of ['unbind', 'mark_irrelevant', 'bind'] as const) {
      const { f, service, command } = await invalidMultiGroup(path);
      const resolution =
        action === 'bind' ? { action, personId: 'demo-b' } : { action };
      const repair = {
        ...command,
        operationId: 'repair-0',
        expectedRevision: 2,
        resolution,
      };
      const oldDecisions = structuredClone(f.state.decisions);
      const first = await service.apply('account-hr', repair);
      expect(first).toMatchObject({
        status: 'success',
        replayed: false,
        result: { resume: null },
      });
      expect(JSON.stringify(first)).not.toContain('demo-a');
      expect(f.state.snapshot.context.resumeGrant).toBeNull();
      expect(f.state.resumed).toHaveLength(1); // Only the earlier, now invalidated processing revision.
      expect(f.state.decisions.slice(0, oldDecisions.length)).toEqual(
        oldDecisions,
      );
      expect(await service.apply('account-hr', repair)).toMatchObject({
        status: 'success',
        replayed: true,
        result: first.status === 'success' ? first.result : null,
      });
      expect(f.state.decisions).toHaveLength(oldDecisions.length + 1);
      expect(f.state.audits).toBe(3);
      expect(
        await service.read('account-hr', {
          batchId: 'batch-a',
          itemId: 'item-1',
        }),
      ).toMatchObject({ status: 'forbidden' });
      expect((await service.apply('account-hr', command)).status).toBe(
        'forbidden',
      );
      const last = await service.apply('account-hr', {
        ...repair,
        itemId: 'item-1',
        operationId: 'repair-1',
      });
      expect(last.status).toBe('success');
      expect(
        f.state.snapshot.bindings.resolutions.every(
          (v) => v.state !== 'bound' || v.personId === 'demo-b',
        ),
      ).toBe(true);
      expect(f.state.resumed).toHaveLength(action === 'unbind' ? 1 : 2);
    }
  },
);

it('修复提交后原有效的另一组人员失效，不能被最初失效集合的宽松规则放过', async () => {
  const { f, deps, service, command } = await invalidMultiGroup('directory');
  expect(
    (
      await service.apply('account-hr', {
        ...command,
        expectedRevision: 2,
        operationId: 'repair-0',
        resolution: { action: 'bind', personId: 'demo-b' },
      })
    ).status,
  ).toBe('success');
  // Exercise the partial-write verify path, independently of strict resume validation.
  f.state.snapshot.context.canProcess = false;
  const before = structuredClone(f.state);
  const save = deps.saveOperation;
  deps.saveOperation = async (...args) => {
    await save(...args);
    f.authority.directory = f.authority.directory.filter(
      (p) => p.id !== 'demo-b',
    );
  };
  const result = await createSpeakerBindingUsecase(deps).apply('account-hr', {
    ...command,
    itemId: 'item-1',
    expectedRevision: 2,
    operationId: 'repair-1',
    resolution: { action: 'mark_irrelevant' },
  });
  expect(result.status).toBe('forbidden');
  expect(f.state).toEqual(before);
});
it('无恢复的修复重放在第二次权限加载后仍拒绝新产生的失效绑定，不追加副作用', async () => {
  const { f, deps, service, command } = await invalidMultiGroup('directory');
  const repair = {
    ...command,
    expectedRevision: 2,
    operationId: 'repair-0',
    resolution: { action: 'unbind' as const },
  };
  expect((await service.apply('account-hr', repair)).status).toBe('success');
  f.authority.directory.push({ id: 'demo-a', displayName: '演示·林序' });
  const before = structuredClone(f.state);
  let calls = 0;
  const load = deps.loadAuthority;
  deps.loadAuthority = async (...args) => {
    if (++calls === 2)
      f.authority.directory = f.authority.directory.filter(
        (p) => p.id !== 'demo-a',
      );
    return load(...args);
  };
  const result = await createSpeakerBindingUsecase(deps).apply(
    'account-hr',
    repair,
  );
  expect(result.status).toBe('forbidden');
  expect(calls).toBe(2);
  expect(f.state).toEqual(before);
  expect(JSON.stringify(result)).not.toContain('demo-a');
});
it('修复也须在最后一次权限加载保有当前处理写许可', async () => {
  const { f, deps, command } = await invalidMultiGroup('directory');
  const before = structuredClone(f.state);
  const save = deps.saveOperation;
  deps.saveOperation = async (...args) => {
    await save(...args);
    f.authority.processing.allowed = false;
  };
  const result = await createSpeakerBindingUsecase(deps).apply('account-hr', {
    ...command,
    expectedRevision: 2,
    operationId: 'repair-0',
    resolution: { action: 'unbind' },
  });
  expect(result.status).toBe('forbidden');
  expect(f.state).toEqual(before);
});

it('带恢复的历史回执在其他已绑定人员失效后也不能重放为可整理', async () => {
  const { f, service, command } = await invalidMultiGroup('directory');
  expect(
    (
      await service.apply('account-hr', {
        ...command,
        expectedRevision: 2,
        operationId: 'repair-0',
        resolution: { action: 'bind', personId: 'demo-b' },
      })
    ).status,
  ).toBe('success');
  const last = {
    ...command,
    itemId: 'item-1',
    expectedRevision: 2,
    operationId: 'repair-1',
    resolution: { action: 'mark_irrelevant' as const },
  };
  expect(await service.apply('account-hr', last)).toMatchObject({
    status: 'success',
    result: { resume: { stage: 'organizing', jobId: 'job-a' } },
  });
  f.authority.directory = f.authority.directory.filter(
    (p) => p.id !== 'demo-b',
  );
  const before = structuredClone(f.state);
  expect((await service.apply('account-hr', last)).status).toBe('forbidden');
  expect(f.state).toEqual(before);
});
