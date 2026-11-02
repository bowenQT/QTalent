import { expect, it } from 'vitest';
import type { RecordingTranscript } from './recordings/types';
import { speakerReview } from './recordings/policy';
import {
  planSpeakerBinding,
  projectSpeakerBindings,
  speakerBindingCommandSchema,
  speakerBindingFingerprint,
  boundCandidateGaps,
  requireBindingCandidateFence,
  type SpeakerBindingSnapshot,
  type SpeakerBindingAuthority,
} from './speaker-binding';
function fixture() {
  const who = { evaluationNodeId: 'node-a', personId: 'demo-a' };
  const transcript: RecordingTranscript = {
    id: 'transcript-v1',
    recordingId: 'recording-a',
    originalVersionId: 'original-v1',
    providerTaskId: 'task-a',
    durationMs: 1000,
    fragments: [0, 1].map((n) => ({
      source: {
        fragmentId: 'fragment-' + n,
        originalVersionId: 'original-v1',
        location: { kind: 'recording', startMs: n * 100, endMs: n * 100 + 100 },
      },
      quote: '演示语段' + n,
      providerSentenceId: 'sentence-' + n,
      providerSpeakerId: n === 0 ? 'speaker-a' : null,
      reviewItemId: 'item-' + n,
    })),
  };
  const snapshot: SpeakerBindingSnapshot = {
    batchId: 'batch-a',
    materialId: 'material-a',
    evaluationNodeId: 'node-a',
    membershipRevision: 4,
    members: [who],
    sourceScopeComplete: true,
    sourceSubjects: [who],
    sourceKind: 'evaluation',
    requiredKinds: [],
    inventoryComplete: true,
    transcript,
    context: {
      recordingId: 'recording-a',
      jobId: 'job-a',
      attempt: 1,
      originalVersionId: 'original-v1',
      recordCollectionId: 'collection-a',
      bindingRevision: 1,
      canProcess: true,
      cancelRequested: false,
      resumeGrant: null,
    },
    bindings: {
      revision: 1,
      resolutions: transcript.fragments.map((f) => ({
        fragmentId: f.source.fragmentId,
        state: 'pending',
        candidates: [{ personId: 'outside', displayName: '演示·旧候选' }],
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
      people: [
        { id: 'demo-a', noReview: false },
        { id: 'outside', noReview: false },
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
        {
          personId: 'outside',
          cohortId: 'cohort-b',
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
        { id: 'node-b', kind: 'defense', cohortId: 'cohort-b' },
      ],
      evaluationNodeSubjects: [
        who,
        { evaluationNodeId: 'node-b', personId: 'outside' },
      ],
      evaluationRelations: [],
    },
    actor: { id: 'hr', name: '演示·HR' },
    directory: [
      { id: 'demo-a', displayName: '演示·林序' },
      { id: 'outside', displayName: '演示·范围外' },
    ],
    processing: {
      accountId: 'account-hr',
      recordCollectionId: 'collection-a',
      membershipRevision: 4,
      allowed: true,
    },
  };
  const command = speakerBindingCommandSchema.parse({
    kind: 'speaker',
    batchId: 'batch-a',
    itemId: 'item-0',
    expectedRevision: 1,
    operationId: 'op-a',
    resolution: { action: 'bind', personId: 'demo-a' },
  });
  return {
    snapshot,
    authority,
    command,
    now: '2031-04-05T06:07:08.000Z',
    accountId: 'account-hr',
  };
}
function next(
  f: ReturnType<typeof fixture>,
  plan: ReturnType<typeof planSpeakerBinding>,
) {
  f.snapshot.bindings = structuredClone(plan.bindings);
  f.snapshot.context.bindingRevision = plan.bindings.revision;
  f.snapshot.itemRevisions = structuredClone(plan.itemRevisions);
  f.snapshot.derived = {
    bindingRevision: plan.bindings.revision,
    draftIds: [],
    confirmedResultIds: [],
  };
}
it('读取按当前目录和节点授权过滤候选，保留null说话人的待核对状态', () => {
  const f = fixture(),
    view = projectSpeakerBindings(f.snapshot, f.authority, f.accountId);
  expect(view.items).toHaveLength(2);
  expect(view.items[1]!.providerSpeakerId).toBeNull();
  expect(view.items[1]!.item.state).toBe('pending');
  expect(view.items[1]!.item.speakerId).toBe('fragment-1');
  expect(view.items[0]!.item.candidates).toEqual([
    { personId: 'demo-a', displayName: '演示·林序' },
  ]);
  expect(JSON.stringify(view)).not.toContain('演示·范围外');
  expect(JSON.stringify(view)).not.toContain('演示·旧候选');
});
it('只有显式人工绑定才改变状态，未绑定null语段继续阻止恢复', () => {
  const f = fixture(),
    result = planSpeakerBinding(f);
  expect(result.bindings.resolutions[0]).toEqual({
    fragmentId: 'fragment-0',
    state: 'bound',
    personId: 'demo-a',
  });
  expect(result.bindings.resolutions[1]!.state).toBe('pending');
  expect(result.bindings.revision).toBe(2);
  expect(result.itemRevisions['item-0']).toBe(2);
  expect(result.resume).toBeNull();
  expect(result.receipt.remainingReviewItemIds).toEqual(['item-1']);
  expect(result.decisions[0]).toMatchObject({
    actorId: 'hr',
    actorName: '演示·HR',
    at: f.now,
    state: 'bound',
  });
});
it('人工核定全部语段后形成唯一859恢复计划，实际859过滤器认可完整绑定', () => {
  const f = fixture(),
    first = planSpeakerBinding(f);
  next(f, first);
  const second = planSpeakerBinding({
    ...f,
    command: { ...f.command, itemId: 'item-1', operationId: 'op-b' },
  });
  expect(second.resume?.grant).toEqual({
    recordingId: 'recording-a',
    transcriptVersionId: 'transcript-v1',
    bindingRevision: 3,
    operationId: 'op-b',
  });
  expect(second.resume?.work).toMatchObject({
    action: 'resume',
    jobId: 'job-a',
    attempt: 1,
  });
  expect(second.receipt.resume).toBeNull();
  expect(speakerReview(f.snapshot.transcript, second.bindings, 3)).toEqual([]);
  expect(speakerReview(f.snapshot.transcript, first.bindings, 2)).toHaveLength(
    1,
  );
});
it('同一非空provider编号的人工决策覆盖其组，null语段不互相猜为同一人', () => {
  const f = fixture();
  f.snapshot.transcript.fragments[1]!.providerSpeakerId = 'speaker-a';
  const grouped = planSpeakerBinding(f);
  expect(grouped.bindings.resolutions.every((v) => v.state === 'bound')).toBe(
    true,
  );
  expect(grouped.itemRevisions).toEqual({ 'item-0': 2, 'item-1': 2 });
  expect(grouped.resume).not.toBeNull();
  const unknown = fixture();
  unknown.snapshot.transcript.fragments[0]!.providerSpeakerId = null;
  const single = planSpeakerBinding(unknown);
  expect(single.bindings.resolutions[1]!.state).toBe('pending');
  expect(single.resume).toBeNull();
});
it('标为无关必须显式，稍后和撤销都不恢复', () => {
  const f = fixture();
  const defer = planSpeakerBinding({
    ...f,
    command: { ...f.command, resolution: { action: 'defer' } },
  });
  expect(defer.bindings.resolutions[0]!.state).toBe('deferred');
  expect(defer.bindings.revision).toBe(1);
  expect(defer.itemRevisions['item-0']).toBe(2);
  expect(defer.resume).toBeNull();
  const irrelevant = planSpeakerBinding({
    ...f,
    command: { ...f.command, resolution: { action: 'mark_irrelevant' } },
  });
  next(f, irrelevant);
  const undo = planSpeakerBinding({
    ...f,
    command: {
      ...f.command,
      expectedRevision: 2,
      resolution: { action: 'unbind' },
    },
  });
  expect(undo.bindings.resolutions[0]!.state).toBe('pending');
  expect(undo.bindings.revision).toBe(3);
  expect(undo.resume).toBeNull();
});
it('相同已绑定决策为业务幂等，不覆盖原人工签名或重复排队', () => {
  const f = fixture();
  next(f, planSpeakerBinding(f));
  const noop = planSpeakerBinding({
    ...f,
    command: { ...f.command, expectedRevision: 2, operationId: 'new-op' },
  });
  expect(noop.changed).toBe(false);
  expect(noop.decisions).toEqual([]);
  expect(noop.bindings.revision).toBe(2);
  expect(noop.resume).toBeNull();
});
it('改绑/撤销计划只失效旧待确认草稿，已确认结果必须交846显式修订', () => {
  const f = fixture();
  next(f, planSpeakerBinding(f));
  f.snapshot.derived!.draftIds = ['draft-a'];
  const undo = planSpeakerBinding({
    ...f,
    command: {
      ...f.command,
      expectedRevision: 2,
      resolution: { action: 'unbind' },
    },
  });
  expect(undo.invalidatedDraftIds).toEqual(['draft-a']);
  expect(undo.receipt.invalidatedDraftIds).toEqual([]);
  f.snapshot.derived!.confirmedResultIds = ['confirmed-a'];
  expect(() =>
    planSpeakerBinding({
      ...f,
      command: {
        ...f.command,
        expectedRevision: 2,
        resolution: { action: 'unbind' },
      },
    }),
  ).toThrow(/修订/);
});
it.each([
  'incomplete',
  'unknown_blockers',
  'missing_binding',
  'duplicate_fragment',
  'stale_item',
  'wrong_original',
  'wrong_binding',
  'unknown_derived',
] as const)('拒绝%s，不把未知当空集合', (mode) => {
  const f = fixture();
  if (mode === 'incomplete') f.snapshot.inventoryComplete = false;
  if (mode === 'unknown_blockers') f.snapshot.otherReviewItemIds = null;
  if (mode === 'missing_binding') f.snapshot.bindings.resolutions.pop();
  if (mode === 'duplicate_fragment')
    f.snapshot.transcript.fragments[1]!.source.fragmentId = 'fragment-0';
  if (mode === 'stale_item') f.command.expectedRevision = 9;
  if (mode === 'wrong_original')
    f.snapshot.transcript.originalVersionId = 'another-version';
  if (mode === 'wrong_binding') f.snapshot.context.bindingRevision = 8;
  if (mode === 'unknown_derived') f.snapshot.derived = null;
  expect(() => planSpeakerBinding(f)).toThrow(
    expect.objectContaining({ code: 'conflict' }),
  );
});
it('其他review种类仍阻塞；完整片段不意味着当前原件/处理许可成立', () => {
  const f = fixture();
  f.snapshot.transcript.fragments[1]!.providerSpeakerId = 'speaker-a';
  f.snapshot.otherReviewItemIds = ['image-review'];
  f.snapshot.otherBlockingReviewItemIds = ['image-review'];
  const result = planSpeakerBinding(f);
  expect(result.resume).toBeNull();
  expect(result.receipt.remainingReviewItemIds).toEqual(['image-review']);
  f.snapshot.otherReviewItemIds = [];
  f.snapshot.otherBlockingReviewItemIds = [];
  f.snapshot.context.canProcess = false;
  expect(planSpeakerBinding(f).resume).toBeNull();
});
it.each([
  'scope_unknown',
  'shared_outside',
  'revoked',
  'write_denied',
  'membership_changed',
  'wrong_account',
  'cancelled',
  'outside_candidate',
] as const)('当前%s时拒绝操作，不用读权限替写权限', (mode) => {
  const f = fixture();
  if (mode === 'scope_unknown') f.snapshot.sourceScopeComplete = false;
  if (mode === 'shared_outside')
    f.snapshot.sourceSubjects.push({
      evaluationNodeId: 'node-b',
      personId: 'outside',
    });
  if (mode === 'revoked')
    f.authority.context.grants[0]!.revokedAt = f.authority.context.now;
  if (mode === 'write_denied') f.authority.processing.allowed = false;
  if (mode === 'membership_changed')
    f.authority.processing.membershipRevision = 3;
  if (mode === 'wrong_account')
    f.authority.processing.accountId = 'other-account';
  if (mode === 'cancelled') f.snapshot.context.cancelRequested = true;
  if (mode === 'outside_candidate')
    f.command.resolution = { action: 'bind', personId: 'outside' };
  expect(() => planSpeakerBinding(f)).toThrow(/许可|范围|权限|候选/);
});
it('当前节点关系到期后评价人不能继续绑定；当前有效关系可处理', () => {
  const f = fixture();
  f.authority.context.account.personId = 'judge';
  f.authority.actor.id = 'judge';
  f.authority.context.grants = [];
  f.authority.context.evaluationRelations = [
    {
      id: 'relation-a',
      evaluationNodeId: 'node-a',
      personId: 'demo-a',
      evaluatorId: 'judge',
      kind: 'judge',
      validFrom: '2026-01-01',
      validTo: '2026-09-05',
      revokedAt: null,
    },
  ];
  expect(planSpeakerBinding(f).changed).toBe(true);
  f.authority.context.evaluationRelations[0]!.validTo = f.authority.context.now;
  expect(() => planSpeakerBinding(f)).toThrow();
});
it('冻结命令不允许客户端注入绑定revision、演员或恢复任务；其他kind不混入本卡', () => {
  const f = fixture();
  expect(
    speakerBindingCommandSchema.safeParse({
      ...f.command,
      bindingRevision: 100,
      actorId: 'fake',
    }).success,
  ).toBe(false);
  expect(
    speakerBindingCommandSchema.safeParse({
      ...f.command,
      kind: 'unknown_person',
    }).success,
  ).toBe(false);
  expect(speakerBindingFingerprint(f.command)).not.toBe(
    speakerBindingFingerprint({
      ...f.command,
      resolution: { action: 'defer' },
    }),
  );
});

it('同组另一语段的旧条目revision不能覆盖已提交绑定；已绑定不允许用稍后撤销', () => {
  const f = fixture();
  f.snapshot.transcript.fragments[1]!.providerSpeakerId = 'speaker-a';
  next(f, planSpeakerBinding(f));
  expect(() =>
    planSpeakerBinding({
      ...f,
      command: {
        ...f.command,
        itemId: 'item-1',
        operationId: 'other',
        resolution: { action: 'mark_irrelevant' },
      },
    }),
  ).toThrow(/版本/);
  expect(() =>
    planSpeakerBinding({
      ...f,
      command: {
        ...f.command,
        expectedRevision: 2,
        resolution: { action: 'defer' },
      },
    }),
  ).toThrow(/撤销/);
});
it('已绑定人员不再是当前候选时读取关闭，仍可显式撤销且不返回旧人员信息', () => {
  const f = fixture();
  f.snapshot.bindings.resolutions[0] = {
    fragmentId: 'fragment-0',
    state: 'bound',
    personId: 'outside',
  };
  expect(() =>
    projectSpeakerBindings(f.snapshot, f.authority, f.accountId),
  ).toThrow(/候选范围/);
  const undo = planSpeakerBinding({
    ...f,
    command: { ...f.command, resolution: { action: 'unbind' } },
  });
  expect(undo.decisions[0]!.personId).toBeNull();
  expect(undo.resume).toBeNull();
});

it('已有另一语段绑定已越出当前候选时，不得因最后一个合法绑定而恢复', () => {
  const f = fixture();
  f.snapshot.bindings.resolutions[0] = {
    fragmentId: 'fragment-0',
    state: 'bound',
    personId: 'outside',
  };
  const plan = planSpeakerBinding({
    ...f,
    command: { ...f.command, itemId: 'item-1' },
  });
  expect(plan.resume).toBeNull();
  expect(plan.bindings.resolutions[0]).toEqual(
    f.snapshot.bindings.resolutions[0],
  );
});

it('最终897回执带真实材料、接受的动作和本材料未解决阻塞项', () => {
  const f = fixture();
  const plan = planSpeakerBinding(f);
  expect(plan.receipt).toMatchObject({
    materialId: 'material-a',
    resolution: { action: 'bind', personId: 'demo-a' },
    remainingReviewItemIds: ['item-1'],
    blockingReviewItemIds: ['item-1'],
    resume: null,
  });
});
it('无关剩余项保留在回执但不扣住已全部核定的本材料', () => {
  const f = fixture();
  f.snapshot.transcript.fragments[1]!.providerSpeakerId = 'speaker-a';
  f.snapshot.otherReviewItemIds = ['unrelated-image-review'];
  const plan = planSpeakerBinding(f);
  expect(plan.receipt.remainingReviewItemIds).toEqual([
    'unrelated-image-review',
  ]);
  expect(plan.receipt.blockingReviewItemIds).toEqual([]);
  expect(plan.resume?.work.jobId).toBe('job-a');
});
it.each([null, undefined, ['not-remaining'], ['image-review', 'image-review']])(
  '本材料阻塞事实未知或不是剩余项的唯一子集时冲突：%j',
  (blockers) => {
    const f = fixture();
    f.snapshot.otherReviewItemIds = ['image-review'];
    Object.assign(f.snapshot, { otherBlockingReviewItemIds: blockers });
    expect(() => planSpeakerBinding(f)).toThrow(
      expect.objectContaining({ code: 'conflict' }),
    );
  },
);
it('完整来源的requiredKind也必须有当前读取许可，不能只核主kind', () => {
  const f = fixture();
  f.authority.context.account.personId = 'judge';
  f.authority.actor.id = 'judge';
  f.authority.context.grants = [];
  f.authority.context.evaluationRelations = [
    {
      id: 'relation-a',
      evaluationNodeId: 'node-a',
      personId: 'demo-a',
      evaluatorId: 'judge',
      kind: 'judge',
      validFrom: '2026-01-01',
      validTo: null,
      revokedAt: null,
    },
  ];
  expect(
    projectSpeakerBindings(f.snapshot, f.authority, f.accountId).items,
  ).toHaveLength(2);
  f.snapshot.requiredKinds = ['management-observation'];
  expect(() =>
    projectSpeakerBindings(f.snapshot, f.authority, f.accountId),
  ).toThrow(expect.objectContaining({ code: 'forbidden' }));
  expect(() => planSpeakerBinding(f)).toThrow(
    expect.objectContaining({ code: 'forbidden' }),
  );
});

function addReplacement(f: ReturnType<typeof fixture>) {
  const who = { personId: 'demo-b', evaluationNodeId: 'node-a' };
  f.snapshot.members.push(who);
  f.snapshot.sourceSubjects.push(who);
  f.authority.directory.push({ id: 'demo-b', displayName: '演示·夏禾' });
  f.authority.context.people.push({ id: 'demo-b', noReview: false });
  f.authority.context.enrollments.push({
    ...f.authority.context.enrollments[0]!,
    personId: 'demo-b',
  });
  f.authority.context.evaluationNodeSubjects.push(who);
}
function invalidMultiGroup(path: 'directory' | 'membership') {
  const f = fixture();
  addReplacement(f);
  next(f, planSpeakerBinding(f));
  next(
    f,
    planSpeakerBinding({
      ...f,
      command: { ...f.command, itemId: 'item-1', operationId: 'initial-1' },
    }),
  );
  expect(f.snapshot.bindings.resolutions.map((v) => v.state)).toEqual([
    'bound',
    'bound',
  ]);
  if (path === 'directory')
    f.authority.directory = f.authority.directory.filter(
      (p) => p.id !== 'demo-a',
    );
  else {
    f.snapshot.members = f.snapshot.members.filter(
      (p) => p.personId !== 'demo-a',
    );
    f.snapshot.membershipRevision++;
    f.authority.processing.membershipRevision = f.snapshot.membershipRevision;
  }
  return f;
}
it.each(['directory', 'membership'] as const)(
  '%s中的同人多组失效可逐组撤销、标无关或改绑，而不是锁死整份材料',
  (path) => {
    for (const action of ['unbind', 'mark_irrelevant', 'bind'] as const) {
      const f = invalidMultiGroup(path);
      const resolution =
        action === 'bind' ? { action, personId: 'demo-b' } : { action };
      expect(() =>
        projectSpeakerBindings(f.snapshot, f.authority, f.accountId),
      ).toThrow(/候选范围/);
      const first = planSpeakerBinding({
        ...f,
        command: { ...f.command, expectedRevision: 2, resolution },
      });
      expect(first.resume).toBeNull();
      expect(JSON.stringify(first.receipt)).not.toContain('demo-a');
      next(f, first);
      const last = planSpeakerBinding({
        ...f,
        command: {
          ...f.command,
          itemId: 'item-1',
          expectedRevision: 2,
          operationId: 'repair-1',
          resolution,
        },
      });
      next(f, last);
      expect(
        f.snapshot.bindings.resolutions.every(
          (v) => v.state !== 'bound' || v.personId === 'demo-b',
        ),
      ).toBe(true);
      expect(last.resume !== null).toBe(action !== 'unbind');
      if (action === 'unbind') {
        next(
          f,
          planSpeakerBinding({
            ...f,
            command: {
              ...f.command,
              expectedRevision: 3,
              operationId: 'resolve-0',
              resolution: { action: 'bind', personId: 'demo-b' },
            },
          }),
        );
        const final = planSpeakerBinding({
          ...f,
          command: {
            ...f.command,
            itemId: 'item-1',
            expectedRevision: 3,
            operationId: 'resolve-1',
            resolution: { action: 'bind', personId: 'demo-b' },
          },
        });
        expect(final.resume).not.toBeNull();
      }
    }
  },
);

it('失效集合按语段与人员成对核对，不能把同一个失效人员挪到另一语段', () => {
  const f = invalidMultiGroup('directory');
  const before = {
    revision: 3,
    resolutions: [f.snapshot.bindings.resolutions[0]!],
  };
  const allowed = boundCandidateGaps(before, [{ personId: 'demo-b' }]);
  expect(() =>
    requireBindingCandidateFence(
      {
        revision: 4,
        resolutions: [
          { fragmentId: 'fragment-1', state: 'bound', personId: 'demo-a' },
        ],
      },
      [{ personId: 'demo-b' }],
      allowed,
    ),
  ).toThrow(/候选范围/);
});
it.each(['write', 'source', 'confirmed'] as const)(
  '已有失效绑定也不能绕过当前%s保护',
  (mode) => {
    const f = invalidMultiGroup('directory');
    if (mode === 'write') f.authority.processing.allowed = false;
    if (mode === 'source') f.snapshot.sourceScopeComplete = false;
    if (mode === 'confirmed')
      f.snapshot.derived!.confirmedResultIds = ['confirmed-event'];
    expect(() =>
      planSpeakerBinding({
        ...f,
        command: {
          ...f.command,
          expectedRevision: 2,
          resolution: { action: 'unbind' },
        },
      }),
    ).toThrow(
      mode === 'confirmed'
        ? /已确认/
        : mode === 'write'
          ? /写许可/
          : /可处理范围/,
    );
  },
);
