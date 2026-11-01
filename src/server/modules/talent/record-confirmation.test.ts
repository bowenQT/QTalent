import { describe, expect, it } from 'vitest';
import {
  recordBatchDraftSetFixture,
  materialReferencesFixture,
} from '../../../contracts/materials.fixtures';
import type {
  RecordSaveInput,
  RecordUndoInput,
} from '../../../contracts/record';
import {
  evaluationContextFixture,
  reassignmentNow,
} from '../programs/reassignment.fixtures';
import {
  confirmationFingerprint,
  planRecordConfirmation,
  type ConfirmationCommand,
  type ConfirmationFact,
  type ConfirmationPlan,
  type ConfirmationRules,
  type ConfirmationSourceFact,
  type ConfirmationState,
} from './record-confirmation';

function fixture() {
  const state: ConfirmationState = {
    draftSet: structuredClone(recordBatchDraftSetFixture),
    projectId: null,
    withdrawnDraftIds: [],
    mappings: [],
    confirmations: [],
    reviews: [],
    saves: [],
    operations: [],
  };
  const draft = state.draftSet.drafts[0]!;
  const context = evaluationContextFixture();
  context.account = {
    id: 'demo-rater-account',
    personId: 'demo-new-evaluator',
    isSystemAdmin: false,
  };
  context.grants = [];
  const rules: ConfirmationRules = {
    dimensionVersionId: draft.dimensionVersionId,
    anchorVersionId: draft.anchorVersionId,
    anchors: [1, 2, 3, 4, 5].map((value) => ({
      id: value === 3 ? 'demo-anchor' : `demo-anchor-${value}`,
      text: value === 3 ? '演示：按已定步骤完成任务' : `演示锚点${value}`,
      dimensionId: 'demo-professionalism',
      value,
      ruleVersion: draft.anchorVersionId,
    })),
  };
  const request: RecordSaveInput = {
    operation_id: 'demo-save-operation',
    expected_revision: 1,
    draftId: draft.draftId,
    personIds: [...draft.personIds],
    projectId: null,
    sbi: structuredClone(draft.sbi),
    decisions: [
      {
        personId: 'demo-person',
        dimensionId: 'demo-professionalism',
        action: 'confirm',
      },
    ],
  };
  const sources: ConfirmationSourceFact[] = [
    {
      reference: structuredClone(materialReferencesFixture.document),
      complete: true,
      excerpt: '演示：完成合成任务并记录验证步骤。',
      subjects: [{ evaluationNodeId: 'demo-node', personId: 'demo-person' }],
      kind: 'evaluation',
      requiredKinds: ['evaluation'],
    },
  ];
  let sequence = 0;
  function run(
    command: ConfirmationCommand = { action: 'save', input: request },
    wallNow = reassignmentNow,
  ) {
    return planRecordConfirmation({
      state,
      context,
      command,
      accountId: context.account.id,
      rules,
      sources,
      wallNow,
      newId: () => `demo-allocated-${++sequence}`,
    });
  }
  function existingPeer(
    value: number | null,
    evaluatorId = 'demo-old-evaluator',
  ): ConfirmationFact {
    state.mappings = [
      {
        draftId: draft.draftId,
        personId: 'demo-person',
        eventId: 'demo-existing-event',
      },
    ];
    const row: ConfirmationFact = {
      id: 'demo-peer-confirmation',
      eventId: 'demo-existing-event',
      personId: 'demo-person',
      evaluationNodeId: 'demo-node',
      dimensionId: 'demo-professionalism',
      evaluatorId,
      active: true,
      revision: 1,
      value,
    };
    state.confirmations.push(row);
    return row;
  }
  function saved() {
    const plan = run();
    if (plan.action !== 'save' || plan.replayed)
      throw new Error('fixture save');
    state.confirmations.push(...plan.confirmations);
    state.saves.push({
      receipt: plan.receipt,
      draft: structuredClone(draft),
      createdEventIds: plan.createdEvents.map((row) => row.eventId),
      originalInput: {
        operation_id: 'demo-original-input',
        text: '演示原话',
        attachmentIds: [],
        personId: 'demo-person',
        projectId: null,
      },
      withdrawnAt: null,
    });
    state.operations.push({
      action: 'save',
      actorAccountId: context.account.id,
      operationId: request.operation_id,
      fingerprint: confirmationFingerprint({ action: 'save', input: request }),
      draft: structuredClone(draft),
      receipt: plan.receipt,
    });
    draft.revision = plan.receipt.revision;
    const command: { action: 'undo'; input: RecordUndoInput } = {
      action: 'undo',
      input: { operation_id: 'demo-undo', saveId: plan.receipt.saveId },
    };
    return { plan, command };
  }
  return {
    state,
    draft,
    context,
    rules,
    request,
    sources,
    run,
    existingPeer,
    saved,
  };
}
function newSave(plan: ConfirmationPlan) {
  if (plan.action !== 'save' || plan.replayed)
    throw new Error('expected new save plan');
  return plan;
}

describe('per-draft human confirmation plans', () => {
  it('preserves the selected draft, frozen versions and complete evidence without mutating AI or state', () => {
    const f = fixture();
    const before = structuredClone(f.state);
    const plan = newSave(f.run());
    expect(plan.receipt.events).toHaveLength(1);
    expect(plan.confirmations[0]).toMatchObject({
      evaluatorId: 'demo-new-evaluator',
      value: 3,
      revision: 1,
      dimensionVersionId: 'demo-dimensions-v1',
      anchorVersionId: 'demo-anchors-v1',
      references: f.draft.sourceReferences,
    });
    expect(plan.receipt.undoUntil).toBe('2026-10-31T16:00:05.000Z');
    expect(plan.input).toEqual(f.request);
    expect(f.state).toEqual(before);
  });
  it('keeps two drafts for one person as distinct events and never uses person identity for deduplication', () => {
    const f = fixture();
    const first = newSave(f.run());
    f.request.draftId = f.state.draftSet.drafts[1]!.draftId;
    f.request.decisions = [];
    f.sources[0]!.reference = structuredClone(
      materialReferencesFixture.recording,
    );
    const second = newSave(f.run());
    expect(first.draft.draftId).not.toBe(second.draft.draftId);
    expect(first.receipt.events[0]!.personId).toBe(
      second.receipt.events[0]!.personId,
    );
    expect(first.receipt.events[0]!.eventId).not.toBe(
      second.receipt.events[0]!.eventId,
    );
  });
  it('lets a second evaluator reuse the exact persisted event and append only their own confirmation', () => {
    const f = fixture();
    f.existingPeer(4);
    const plan = newSave(f.run());
    expect(plan.createdEvents).toEqual([]);
    expect(plan.receipt.events).toEqual([
      { personId: 'demo-person', eventId: 'demo-existing-event' },
    ]);
    expect(plan.confirmations).toHaveLength(1);
    expect(plan.reviews).toEqual([]);
  });
  it('allows a manager with a current evaluator relation but never turns global read into confirmation permission', () => {
    const f = fixture();
    f.context.grants = [
      {
        accountId: f.context.account.id,
        role: 'manager',
        scope: 'company',
        cohortId: null,
        validFrom: '2026-01-01T00:00:00.000Z',
        validTo: null,
        revokedAt: null,
      },
    ];
    expect(f.run().action).toBe('save');
    f.context.evaluationRelations = [];
    expect(() => f.run()).toThrow('current_node_confirmation_required');
  });
  it.each(['expired', 'cross-node', 'admin', 'no-review'] as const)(
    'rejects %s without legacy fallback',
    (mode) => {
      const f = fixture();
      if (mode === 'expired')
        f.context.evaluationRelations.forEach((r) => {
          r.validTo = reassignmentNow;
        });
      if (mode === 'cross-node') f.draft.evaluationNodeId = 'demo-other-node';
      if (mode === 'admin') f.context.account.isSystemAdmin = true;
      if (mode === 'no-review')
        f.context.people.find((p) => p.id === 'demo-person')!.noReview = true;
      expect(() => f.run()).toThrow('current_node_confirmation_required');
    },
  );
  it.each([
    'stale',
    'withdrawn',
    'duplicate',
    'subjects',
    'missing-score',
  ] as const)('rejects %s draft input', (mode) => {
    const f = fixture();
    if (mode === 'stale') f.request.expected_revision = 2;
    if (mode === 'withdrawn') f.state.withdrawnDraftIds = [f.draft.draftId];
    if (mode === 'duplicate')
      f.state.draftSet.duplicateCandidates = [
        {
          candidateId: 'demo-choice',
          draftIds: f.state.draftSet.drafts.map((d) => d.draftId),
          reason: '演示：需人确认',
        },
      ];
    if (mode === 'subjects') f.request.personIds = ['other-person'];
    if (mode === 'missing-score')
      f.request.decisions[0]!.dimensionId = 'other-dimension';
    expect(() => f.run()).toThrow();
  });
  it.each([
    'incomplete',
    'hidden',
    'changed-location',
    'duplicate-source',
    'unrelated',
    'mixed-kind',
  ] as const)('rejects %s source facts', (mode) => {
    const f = fixture();
    const source = f.sources[0]!;
    if (mode === 'incomplete') source.complete = false;
    if (mode === 'hidden')
      source.subjects.push({
        evaluationNodeId: 'demo-other-node',
        personId: 'demo-person',
      });
    if (mode === 'changed-location')
      source.reference = {
        ...source.reference,
        location: { kind: 'document', paragraph: '99' },
      };
    if (mode === 'duplicate-source') f.sources.push(structuredClone(source));
    if (mode === 'unrelated') source.subjects = [];
    if (mode === 'mixed-kind') source.requiredKinds.push('performance');
    expect(() => f.run()).toThrow();
  });
  it('uses the draft rule identities even after a newer version is published', () => {
    const f = fixture();
    expect(newSave(f.run()).confirmations[0]!.anchor?.ruleVersion).toBe(
      'demo-anchors-v1',
    );
    f.rules.anchorVersionId = 'demo-anchors-v2';
    expect(() => f.run()).toThrow('frozen_rules_required');
  });
  it.each(['missing', 'ambiguous', 'changed-text'] as const)(
    'rejects %s frozen anchor',
    (mode) => {
      const f = fixture();
      if (mode === 'missing') f.rules.anchors = [];
      if (mode === 'ambiguous')
        f.rules.anchors.push(structuredClone(f.rules.anchors[2]!));
      if (mode === 'changed-text') f.rules.anchors[2]!.text = '另一版本文本';
      expect(() => f.run()).toThrow(
        mode === 'ambiguous'
          ? 'frozen_anchor_unresolved'
          : 'frozen_suggestion_invalid',
      );
    },
  );
  it('does not convert unknown into zero or accept confirm on unknown', () => {
    const f = fixture();
    f.request.decisions = [
      {
        personId: 'demo-person',
        dimensionId: 'demo-potential',
        action: 'unknown',
        reason: '资料不足',
      },
    ];
    expect(newSave(f.run()).confirmations[0]!.value).toBeNull();
    expect(newSave(f.run()).reviews).toEqual([]);
    f.request.decisions = [
      {
        personId: 'demo-person',
        dimensionId: 'demo-potential',
        action: 'confirm',
      },
    ];
    expect(() => f.run()).toThrow('unknown_cannot_be_scored');
  });
  it.each([
    [3, 2, '', false],
    [3, 1, '', true],
    [2, 5, ' ', true],
    [4, 1, '已写理由', false],
    [1, 3, '已写理由', false],
  ] as const)(
    'AI %i -> human %i with reason %j has gap=%s',
    (ai, value, reason, gap) => {
      const f = fixture();
      const score = f.draft.scores[0]!;
      if (score.state !== 'suggested') throw new Error('fixture');
      score.value = ai;
      const anchor = f.rules.anchors.find((row) => row.value === ai)!;
      score.anchor = {
        id: anchor.id,
        text: anchor.text,
        ruleVersion: anchor.ruleVersion,
      };
      f.request.decisions = [
        {
          personId: 'demo-person',
          dimensionId: score.dimensionId,
          action: 'edit',
          value,
          reason,
        },
      ];
      expect(newSave(f.run()).reviews.some((r) => r.kind === 'ai_gap')).toBe(
        gap,
      );
    },
  );
  it.each([
    [4, false],
    [1, true],
    [5, true],
    [null, false],
  ] as const)(
    'compares only active human peer %s at threshold two',
    (value, gap) => {
      const f = fixture();
      f.existingPeer(value);
      expect(newSave(f.run()).reviews.some((r) => r.kind === 'rater_gap')).toBe(
        gap,
      );
    },
  );
  it('does not let an edit reason excuse a human peer gap, nor compare withdrawn peers', () => {
    const f = fixture();
    const peer = f.existingPeer(1);
    f.request.decisions = [
      {
        personId: 'demo-person',
        dimensionId: 'demo-professionalism',
        action: 'edit',
        value: 4,
        reason: '演示理由',
      },
    ];
    expect(newSave(f.run()).reviews.map((r) => r.kind)).toEqual(['rater_gap']);
    peer.active = false;
    expect(newSave(f.run()).reviews).toEqual([]);
  });
  it('rejects a second business confirmation even when it uses a new operation ID', () => {
    const f = fixture();
    f.existingPeer(3, f.context.account.personId);
    expect(() => f.run()).toThrow('confirmation_already_exists');
  });
  it('replays the retained receipt after a revision advances; changed payload conflicts', () => {
    const f = fixture();
    const { plan } = f.saved();
    expect(f.run()).toEqual({
      action: 'save',
      replayed: true,
      receipt: plan.receipt,
    });
    f.request.sbi.title = '不同输入';
    expect(() => f.run()).toThrow('operation_payload_changed');
  });
  it('requires current authority even for a successful historical operation', () => {
    const f = fixture();
    f.saved();
    f.context.evaluationRelations = [];
    expect(() => f.run()).toThrow('current_node_confirmation_required');
  });
});

describe('whole-save five-second undo plans', () => {
  it.each([
    [4999, true],
    [5000, false],
    [5001, false],
    [-1, false],
  ] as const)('elapsed=%i is allowed=%s', (elapsed, allowed) => {
    const f = fixture();
    const { command } = f.saved();
    const run = () =>
      f.run(
        command,
        new Date(Date.parse(reassignmentNow) + elapsed).toISOString(),
      );
    if (!allowed) expect(run).toThrow('undo_window_closed');
    else {
      const p = run();
      expect(p.action).toBe('undo');
      expect(p.receipt).toMatchObject({
        withdrawnEvents: [{ personId: 'demo-person' }],
        originalInput: { text: '演示原话' },
      });
    }
  });
  it.each([
    'other-owner',
    'later-rater',
    'handled-review',
    'already-withdrawn',
    'inactive-score',
  ] as const)('rejects %s without partial effects', (mode) => {
    const f = fixture();
    const { plan, command } = f.saved();
    if (mode === 'other-owner') f.context.account.id = 'other-account';
    if (mode === 'later-rater')
      f.state.confirmations.push({
        ...plan.confirmations[0]!,
        id: 'other-confirmation',
        evaluatorId: 'other-rater',
      });
    if (mode === 'handled-review')
      f.state.reviews.push({
        id: 'handled-review',
        confirmationIds: plan.receipt.confirmationIds,
        handled: true,
        withdrawn: false,
      });
    if (mode === 'already-withdrawn')
      f.state.saves[0]!.withdrawnAt = reassignmentNow;
    if (mode === 'inactive-score') f.state.confirmations[0]!.active = false;
    const before = structuredClone(f.state);
    expect(() => f.run(command)).toThrow();
    expect(f.state).toEqual(before);
  });
  it('withdraws only the second evaluator scores while keeping the pre-existing event', () => {
    const f = fixture();
    f.existingPeer(3);
    const { command } = f.saved();
    const plan = f.run(command);
    expect(plan.receipt).toMatchObject({
      withdrawnEvents: [],
      withdrawnConfirmationIds: [expect.any(String)],
    });
  });
  it('replays a completed undo after the deadline but still rejects revoked authority', () => {
    const f = fixture();
    const { command } = f.saved();
    const undo = f.run(command);
    if (undo.action !== 'undo' || undo.replayed)
      throw new Error('fixture undo');
    f.state.operations.push({
      action: 'undo',
      actorAccountId: f.context.account.id,
      operationId: command.input.operation_id,
      fingerprint: confirmationFingerprint(command),
      draft: undo.draft,
      receipt: undo.receipt,
    });
    f.state.saves[0]!.withdrawnAt = reassignmentNow;
    expect(f.run(command, '2026-10-31T17:00:00.000Z').replayed).toBe(true);
    f.context.evaluationRelations = [];
    expect(() => f.run(command)).toThrow('current_node_confirmation_required');
  });
});
it('rejects invalid saved timestamps rather than extending the undo window', () => {
  const f = fixture();
  const { command } = f.saved();
  f.state.saves[0]!.receipt.savedAt = 'invalid';
  expect(() => f.run(command)).toThrow('undo_window_closed');
});
it('uses stable semantic operation keys across decision and person order', () => {
  const f = fixture();
  const first: ConfirmationCommand = {
    action: 'save',
    input: {
      ...f.request,
      personIds: ['人甲', 'person-z'],
      decisions: [
        {
          personId: '人甲',
          dimensionId: 'd2',
          action: 'unknown',
          reason: '资料不足',
        },
        {
          personId: 'person-z',
          dimensionId: 'd1',
          action: 'unknown',
          reason: '未体现',
        },
      ],
    },
  };
  const second = structuredClone(first);
  second.input.personIds.reverse();
  second.input.decisions.reverse();
  expect(confirmationFingerprint(first)).toBe(confirmationFingerprint(second));
});
it('does not treat the client project choice as an authorized server association', () => {
  const f = fixture();
  f.state.projectId = 'canonical-project';
  expect(() => f.run()).toThrow('project_selection_changed');
  f.request.projectId = 'canonical-project';
  expect(() => f.run()).toThrow('project_not_visible');
});
it('fails closed on invalid event mapping or mismatched confirmation identity', () => {
  const f = fixture();
  const peer = f.existingPeer(3);
  peer.evaluationNodeId = 'different-node';
  expect(() => f.run()).toThrow('confirmation_identity_invalid');
  peer.evaluationNodeId = 'demo-node';
  f.state.mappings.push({ ...f.state.mappings[0]! });
  expect(() => f.run()).toThrow('event_mapping_invalid');
});
it('requires a valid draft set and the requested stable draft identity', () => {
  const f = fixture();
  f.request.draftId = 'not-this-draft';
  expect(() => f.run()).toThrow('draft_not_found');
  f.state.draftSet.drafts = [];
  expect(() => f.run()).toThrow('draft_state_invalid');
});
it('rejects a changed account and invalid real server clock', () => {
  const f = fixture();
  expect(() =>
    planRecordConfirmation({
      accountId: 'other-account',
      command: { action: 'save', input: f.request },
      state: f.state,
      context: f.context,
      sources: f.sources,
      rules: f.rules,
      wallNow: reassignmentNow,
      newId: () => 'demo-id',
    }),
  ).toThrow('account_changed');
  expect(() => f.run(undefined, 'invalid-server-clock')).toThrow(
    'invalid_server_clock',
  );
});
it('checks the original suggestion anchor even when the human edits to a valid score', () => {
  const f = fixture();
  const score = f.draft.scores[0]!;
  if (score.state !== 'suggested') throw new Error('fixture score');
  score.value = 1;
  f.request.decisions = [
    {
      personId: 'demo-person',
      dimensionId: score.dimensionId,
      action: 'edit',
      value: 4,
      reason: '人工改分',
    },
  ];
  expect(() => f.run()).toThrow('frozen_suggestion_invalid');
});
it('does not accept a forged suggestion quote just because its source identity is visible', () => {
  const f = fixture();
  const score = f.draft.scores[0]!;
  if (score.state !== 'suggested') throw new Error('fixture score');
  score.citations[0]!.quote = '演示：来源中不存在的原话';
  expect(() => f.run()).toThrow('quote_not_verbatim');
});
it('preserves exact original text when planning undo, including surrounding whitespace', () => {
  const f = fixture();
  const { command } = f.saved();
  f.state.saves[0]!.originalInput.text = '  演示原话\n';
  expect(f.run(command).receipt).toMatchObject({
    originalInput: { text: '  演示原话\n' },
  });
});
it('continues the withdrawn native confirmation revision instead of reusing revision one', () => {
  const f = fixture();
  f.existingPeer(3);
  const { plan } = f.saved();
  const own = f.state.confirmations.find(
    (row) => row.id === plan.receipt.confirmationIds[0],
  )!;
  own.active = false;
  f.state.saves[0].withdrawnAt = reassignmentNow;
  f.request.operation_id += '-after-undo';
  f.request.expected_revision = f.draft.revision;
  const next = newSave(f.run());
  expect(next.confirmations[0]).toMatchObject({
    revision: 2,
    previousId: own.id,
    previousRevision: 1,
    active: true,
  });
  expect(own.active).toBe(false);
});

it('does not reuse revision one when the same evaluator has inactive confirmation history', () => {
  const f = fixture();
  f.existingPeer(3, f.context.account.personId).active = false;
  expect(() => f.run()).toThrow('confirmation_already_exists');
});

it('allows this event to be confirmed while unrelated drafts await a duplicate decision', () => {
  const f = fixture();
  const pending = ['demo-unrelated-a', 'demo-unrelated-b'].map((draftId) => ({
    ...structuredClone(f.draft),
    draftId,
  }));
  f.state.draftSet.drafts.push(...pending);
  f.state.draftSet.duplicateCandidates.push({
    candidateId: 'demo-unrelated-candidate',
    draftIds: pending.map((draft) => draft.draftId),
    reason: '演示：仅另外两件事待判断是否重复',
  });
  expect(newSave(f.run()).draft.draftId).toBe(f.draft.draftId);
});
