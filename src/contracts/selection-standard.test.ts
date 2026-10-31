import { describe, expect, it } from 'vitest';
import {
  createSelectionRevisionInputSchema,
  createSelectionRevisionResultSchema,
  effectiveRuleVersionReadInputSchema,
  effectiveRuleVersionReadResultSchema,
  effectiveRuleVersionSchema,
  evaluationRuleCategorySchema,
  publishSelectionRevisionInputSchema,
  publishSelectionRevisionResultSchema,
  returnSelectionRevisionInputSchema,
  returnSelectionRevisionResultSchema,
  saveSelectionRevisionInputSchema,
  saveSelectionRevisionResultSchema,
  selectionAiDraftSchema,
  selectionCohortBindingChangeSchema,
  selectionCohortVersionReadInputSchema,
  selectionCohortVersionReadResultSchema,
  selectionImpactPreviewSchema,
  selectionLifecycleTransitionSchema,
  selectionManagerRevisionSchema,
  selectionPublicationReceiptSchema,
  selectionPublicationUndoBoundarySchema,
  selectionPublicationUndoReceiptSchema,
  selectionPublicationUndoTransactionSchema,
  selectionReviewPointChangesSchema,
  selectionRevisionSchema,
  selectionStandardContentSchema,
  selectionStandardReadInputSchema,
  selectionStandardReadResultSchema,
  selectionRevisionReadInputSchema,
  selectionRevisionReadResultSchema,
  submitSelectionRevisionInputSchema,
  submitSelectionRevisionResultSchema,
  undoSelectionPublicationInputSchema,
  undoSelectionPublicationResultSchema,
  withdrawSelectionRevisionInputSchema,
  withdrawSelectionRevisionResultSchema,
} from './selection-standard';
import {
  iterationDemoManager,
  iterationDemoCohort,
  iterationDemoNextCohort,
  selectionImpactPreviewFixture,
  selectionManagerRevisionFixture,
  selectionPublicationFixture,
  selectionRevisionFixture,
  selectionUneditedDraftFixture,
  selectionPublicationUndoTransactionFixture,
} from './standard-iteration.fixtures';

const command = {
  operationId: 'demo-operation',
  draftId: 'demo-revision',
  expectedRevision: 1,
};
const undoCommand = {
  operationId: 'demo-undo',
  publicationId: 'demo-publication',
  expectedRevision: 2,
};
const point = {
  id: 'demo-point',
  title: '演示评审要点',
  description: '演示：核对个人交付材料',
};

describe('规则类别与选拔期次契约', () => {
  it('类别、来源和生命周期独立；两类生效版本可以并存', () => {
    expect(evaluationRuleCategorySchema.options).toEqual([
      'dimension_anchors',
      'xe_selection',
      'xe_weekly',
    ]);
    const common = {
      provenance: 'published',
      effectiveFrom: '2026-10-31T00:00:00Z',
      effectiveUntil: null,
    };
    expect(
      effectiveRuleVersionSchema.safeParse({
        ...common,
        category: 'dimension_anchors',
        versionId: 'rubric-v1',
      }).success,
    ).toBe(true);
    expect(
      effectiveRuleVersionSchema.safeParse({
        ...common,
        category: 'xe_selection',
        versionId: 'xe-select-v2',
      }).success,
    ).toBe(true);
    expect(
      effectiveRuleVersionSchema.safeParse({
        ...common,
        category: 'xe_weekly',
        versionId: 'xe-weekly-v1',
        provenance: 'demo_import_snapshot',
      }).success,
    ).toBe(true);
    expect(
      effectiveRuleVersionSchema.safeParse({
        ...common,
        category: 'published',
        versionId: 'rubric-v1',
      }).success,
    ).toBe(false);
    expect(
      effectiveRuleVersionSchema.safeParse({
        ...common,
        category: 'dimension_anchors',
        versionId: 'xe-select-v2',
      }).success,
    ).toBe(false);
    expect(
      effectiveRuleVersionSchema.safeParse({
        ...common,
        category: 'dimension_anchors',
        versionId: 'rubric-v1',
        provenance: 'active',
      }).success,
    ).toBe(false);
    expect(
      effectiveRuleVersionSchema.safeParse({
        ...common,
        category: 'dimension_anchors',
        versionId: 'rubric-v1',
        effectiveUntil: common.effectiveFrom,
      }).success,
    ).toBe(false);
    expect(
      effectiveRuleVersionSchema.safeParse({
        ...common,
        category: 'dimension_anchors',
        versionId: 'rubric-v1',
        effectiveUntil: '2026-11-01T00:00:00Z',
      }).success,
    ).toBe(true);
  });

  it('当前和历史时间点都显式按类别读取，查不到不冒充成功', () => {
    expect(
      effectiveRuleVersionReadInputSchema.safeParse({
        category: 'dimension_anchors',
      }).success,
    ).toBe(true);
    expect(
      effectiveRuleVersionReadInputSchema.safeParse({
        category: 'xe_selection',
        at: '2026-10-31T00:00:00Z',
      }).success,
    ).toBe(true);
    expect(
      effectiveRuleVersionReadInputSchema.safeParse({
        at: '2026-10-31T00:00:00Z',
      }).success,
    ).toBe(false);
    expect(
      effectiveRuleVersionReadResultSchema.safeParse({
        status: 'not_found',
        message: '演示：该类别在指定时间无生效版本',
      }).success,
    ).toBe(true);
  });

  it('第六期保持 v1，新建第七期可绑定 v2，发布和撤销都不能改已绑定期次', () => {
    const old = selectionImpactPreviewFixture().preservedBindings[0];
    expect(
      selectionCohortBindingChangeSchema.safeParse({
        previous: old,
        binding: old,
      }).success,
    ).toBe(true);
    expect(
      selectionCohortBindingChangeSchema.safeParse({
        previous: old,
        binding: { ...old, standardVersionId: 'xe-select-v2' },
      }).success,
    ).toBe(false);
    expect(
      selectionCohortBindingChangeSchema.safeParse({
        previous: old,
        binding: { ...old, boundAt: '2026-11-01T00:00:00Z' },
      }).success,
    ).toBe(false);
    const next = {
      cohort: iterationDemoNextCohort,
      standardVersionId: 'xe-select-v2',
      boundAt: '2026-11-01T00:00:00Z',
    };
    expect(
      selectionCohortBindingChangeSchema.safeParse({
        previous: null,
        binding: next,
      }).success,
    ).toBe(true);
    expect(
      selectionCohortBindingChangeSchema.safeParse({
        previous: next,
        binding: { ...next, standardVersionId: 'xe-select-v1' },
      }).success,
    ).toBe(false);
    expect(
      selectionCohortVersionReadInputSchema.safeParse({ cohortId: 'demo-xe6' })
        .success,
    ).toBe(true);
    expect(
      selectionCohortVersionReadResultSchema.safeParse({
        status: 'success',
        binding: old,
      }).success,
    ).toBe(true);
  });
});

describe('入营选拔标准修订与影响预览契约', () => {
  it('只增删改评审要点，不改维度锚点或原始评分', () => {
    const changes = [
      { kind: 'add', after: point },
      {
        kind: 'edit',
        before: { ...point, id: 'demo-edit' },
        after: { ...point, id: 'demo-edit', description: '演示：增加引用要求' },
      },
      { kind: 'remove', before: { ...point, id: 'demo-remove' } },
    ];
    expect(selectionReviewPointChangesSchema.parse(changes)).toHaveLength(3);
    expect(
      selectionReviewPointChangesSchema.safeParse([
        { kind: 'edit', before: point, after: point },
      ]).success,
    ).toBe(false);
    expect(
      selectionReviewPointChangesSchema.safeParse([
        { kind: 'edit', before: point, after: { ...point, id: 'different' } },
      ]).success,
    ).toBe(false);
    expect(
      selectionReviewPointChangesSchema.safeParse([changes[0], changes[0]])
        .success,
    ).toBe(false);
    expect(
      selectionReviewPointChangesSchema.safeParse([
        { kind: 'add', after: { ...point, dimensionId: 'prof', score: 5 } },
      ]).success,
    ).toBe(false);
    expect(
      selectionStandardContentSchema.safeParse({ reviewPoints: [point] })
        .success,
    ).toBe(true);
    expect(
      selectionStandardContentSchema.safeParse({ reviewPoints: [point, point] })
        .success,
    ).toBe(false);
  });

  it('已确认归因、AI 初稿与 HR 修改分别保存，预览绑定内容修订', () => {
    const draft = selectionRevisionSchema.parse(selectionRevisionFixture());
    if (draft.state !== 'pending_confirmation') throw new Error('fixture');
    expect(draft.basis.origin).toBe('human_conclusion');
    expect(draft.aiDraft?.origin).toBe('ai_draft');
    expect(draft.humanVersion.origin).toBe('hr_edited');
    expect(draft.aiDraft?.changes).not.toEqual(draft.humanVersion.changes);
    expect(draft.impactPreview.contentRevision).toBe(draft.contentRevision);
    expect(
      selectionRevisionSchema.safeParse({ ...draft, contentRevision: 2 })
        .success,
    ).toBe(false);
    expect(
      selectionRevisionSchema.safeParse({
        ...draft,
        baseVersionId: draft.versionId,
      }).success,
    ).toBe(false);
    expect(
      selectionRevisionSchema.safeParse({
        ...draft,
        impactPreview: {
          ...draft.impactPreview,
          newStandardVersionId: 'xe-select-v3',
        },
      }).success,
    ).toBe(false);
    expect(
      selectionRevisionSchema.safeParse({
        ...draft,
        aiDraft: { ...draft.aiDraft, basis: { ...draft.basis, revision: 2 } },
      }).success,
    ).toBe(false);
    expect(
      selectionAiDraftSchema.safeParse({
        ...draft.aiDraft,
        basis: { ...draft.basis, categories: ['person_or_environment'] },
      }).success,
    ).toBe(false);
  });

  it('规则内容与修订读取有完整输入/结果，管理者动作和读取都不能拿到 HR 私有依据', () => {
    expect(selectionStandardReadInputSchema.safeParse({}).success).toBe(true);
    expect(
      selectionStandardReadInputSchema.safeParse({ versionId: 'xe-select-v1' })
        .success,
    ).toBe(true);
    const version = {
      category: 'xe_selection',
      versionId: 'xe-select-v1',
      provenance: 'published',
      effectiveFrom: '2026-07-01T00:00:00Z',
      effectiveUntil: null,
    };
    expect(
      selectionStandardReadResultSchema.safeParse({
        status: 'success',
        version,
        content: { reviewPoints: [point] },
      }).success,
    ).toBe(true);
    expect(
      selectionStandardReadResultSchema.safeParse({
        status: 'success',
        version: {
          ...version,
          category: 'dimension_anchors',
          versionId: 'rubric-v1',
        },
        content: { reviewPoints: [point] },
      }).success,
    ).toBe(false);
    expect(
      selectionRevisionReadInputSchema.safeParse({ draftId: 'demo-revision' })
        .success,
    ).toBe(true);
    expect(
      selectionRevisionReadInputSchema.safeParse({
        draftId: 'demo-revision',
        audience: 'hr',
      }).success,
    ).toBe(false);
    expect(
      selectionRevisionReadResultSchema.safeParse({
        status: 'success',
        view: { audience: 'hr', revision: selectionRevisionFixture() },
      }).success,
    ).toBe(true);
    expect(
      selectionRevisionReadResultSchema.safeParse({
        status: 'success',
        view: {
          audience: 'manager',
          revision: selectionManagerRevisionFixture(),
        },
      }).success,
    ).toBe(true);
    expect(
      selectionRevisionReadResultSchema.safeParse({
        status: 'success',
        view: { audience: 'manager', revision: selectionRevisionFixture() },
      }).success,
    ).toBe(false);
  });

  it('下一期是稳定期次 id，已有结果按原版保留，不重算、不切换已绑定期次', () => {
    const preview = selectionImpactPreviewSchema.parse(
      selectionImpactPreviewFixture(),
    );
    expect(preview.nextCohort).toEqual(iterationDemoNextCohort);
    expect(preview.existingResults).toEqual([
      { cohortId: 'demo-xe6', standardVersionId: 'xe-select-v1', count: 11 },
    ]);
    expect(
      selectionImpactPreviewSchema.safeParse({
        ...preview,
        nextCohort: iterationDemoCohort,
      }).success,
    ).toBe(false);
    for (const patch of [
      { recomputeHistoricalResults: true },
      { nextComparisonGrouping: 'evaluator_rank' },
      { profileVersionChanges: [2] },
      { individualScoreChanges: [1] },
      { effect: 'inventory_batch' },
    ]) {
      expect(
        selectionImpactPreviewSchema.safeParse({ ...preview, ...patch })
          .success,
      ).toBe(false);
    }
  });

  it('管理者只见批次、偏差人数与归因类别，不返回 HR 案例和 AI 私有依据', () => {
    const manager = selectionManagerRevisionFixture();
    expect(selectionManagerRevisionSchema.safeParse(manager).success).toBe(
      true,
    );
    const hr = selectionRevisionFixture();
    for (const patch of [
      { basis: hr.basis },
      { aiDraft: hr.aiDraft },
      { citations: hr.basis.citations },
      { cases: ['demo-comparison-1'] },
      { evaluatorCounts: [5] },
    ]) {
      expect(
        selectionManagerRevisionSchema.safeParse({ ...manager, ...patch })
          .success,
      ).toBe(false);
    }
    expect(
      selectionManagerRevisionSchema.safeParse({
        ...manager,
        contentRevision: 2,
      }).success,
    ).toBe(false);
  });

  it.each([
    { action: 'create', from: null, to: 'draft', role: 'hr' },
    { action: 'edit', from: 'draft', to: 'draft', role: 'hr' },
    { action: 'submit', from: 'draft', to: 'pending_confirmation', role: 'hr' },
    {
      action: 'withdraw',
      from: 'pending_confirmation',
      to: 'draft',
      role: 'hr',
    },
    {
      action: 'return',
      from: 'pending_confirmation',
      to: 'draft',
      role: 'manager',
      reason: '演示：补充依据',
    },
    {
      action: 'publish',
      from: 'pending_confirmation',
      to: 'active',
      role: 'manager',
    },
    { action: 'supersede', from: 'active', to: 'superseded', role: 'system' },
    {
      action: 'undo_publish',
      from: 'active',
      to: 'pending_confirmation',
      role: 'manager',
    },
  ])('生命周期只允许已确认转移：$action', (transition) => {
    expect(
      selectionLifecycleTransitionSchema.safeParse(transition).success,
    ).toBe(true);
    expect(
      selectionLifecycleTransitionSchema.safeParse({
        ...transition,
        to: 'scheduled',
      }).success,
    ).toBe(false);
  });

  it('HR 不能发布，不能跳过待确认；管理者退回必须写理由', () => {
    expect(
      selectionLifecycleTransitionSchema.safeParse({
        action: 'publish',
        from: 'pending_confirmation',
        to: 'active',
        role: 'hr',
      }).success,
    ).toBe(false);
    expect(
      selectionLifecycleTransitionSchema.safeParse({
        action: 'publish',
        from: 'draft',
        to: 'active',
        role: 'manager',
      }).success,
    ).toBe(false);
    expect(
      selectionLifecycleTransitionSchema.safeParse({
        action: 'return',
        from: 'pending_confirmation',
        to: 'draft',
        role: 'manager',
        reason: ' ',
      }).success,
    ).toBe(false);
    expect(
      returnSelectionRevisionInputSchema.safeParse({ ...command, reason: '' })
        .success,
    ).toBe(false);
  });

  it('四种状态均能表达，状态修订变更保留同一内容预览；不允许已排期', () => {
    const pending = selectionRevisionFixture();
    if (pending.state !== 'pending_confirmation') throw new Error('fixture');
    const { state, submittedBy, submittedAt, ...base } = pending;
    expect(state).toBe('pending_confirmation');
    expect([submittedBy.id, submittedAt]).toEqual([
      'demo-hr',
      '2026-10-31T10:00:00Z',
    ]);
    expect(
      selectionRevisionSchema.safeParse({
        ...base,
        state: 'draft',
        lastReturn: null,
      }).success,
    ).toBe(true);
    expect(
      selectionRevisionSchema.safeParse({
        ...base,
        state: 'draft',
        lastReturn: {
          reason: '演示：补充证据',
          returnedBy: iterationDemoManager,
          returnedAt: '2026-10-31T10:00:00Z',
        },
      }).success,
    ).toBe(true);
    const pub = selectionPublicationFixture();
    const publication = {
      publicationId: pub.publicationId,
      publishedBy: pub.publishedBy,
      publishedAt: pub.publishedAt,
      undoUntil: pub.undoUntil,
    };
    expect(
      selectionRevisionSchema.safeParse({
        ...base,
        revision: 2,
        state: 'active',
        ...publication,
      }).success,
    ).toBe(true);
    expect(
      selectionRevisionSchema.safeParse({
        ...base,
        revision: 3,
        state: 'superseded',
        ...publication,
        supersededByVersionId: 'xe-select-v3',
        supersededAt: '2026-11-01T00:00:00Z',
      }).success,
    ).toBe(true);
    expect(
      selectionRevisionSchema.safeParse({
        ...base,
        state: 'active',
        ...publication,
        undoUntil: '2026-10-31T10:00:06Z',
      }).success,
    ).toBe(false);
    expect(
      selectionRevisionSchema.safeParse({ ...base, state: 'scheduled' })
        .success,
    ).toBe(false);
  });

  it('所有写操作带请求键与乐观锁，提交/发布还绑定已保存的预览 id', () => {
    const create = {
      operationId: 'demo-create',
      baseVersionId: 'xe-select-v1',
      attributionId: 'demo-attribution',
      expectedAttributionRevision: 1,
      reason: '演示修订',
    };
    expect(createSelectionRevisionInputSchema.safeParse(create).success).toBe(
      true,
    );
    expect(
      createSelectionRevisionInputSchema.safeParse({
        ...create,
        attribution: selectionRevisionFixture().basis,
      }).success,
    ).toBe(false);
    const save = {
      ...command,
      reason: '演示修订',
      changes: [{ kind: 'add', after: point }],
    };
    expect(saveSelectionRevisionInputSchema.safeParse(save).success).toBe(true);
    for (const schema of [
      submitSelectionRevisionInputSchema,
      publishSelectionRevisionInputSchema,
    ]) {
      expect(schema.safeParse(command).success).toBe(false);
      expect(
        schema.safeParse({ ...command, expectedPreviewId: 'demo-preview-r1' })
          .success,
      ).toBe(true);
    }
    expect(
      withdrawSelectionRevisionInputSchema.safeParse(command).success,
    ).toBe(true);
    expect(
      withdrawSelectionRevisionInputSchema.safeParse({
        ...command,
        expectedRevision: 0,
      }).success,
    ).toBe(false);
    expect(
      undoSelectionPublicationInputSchema.safeParse(undoCommand).success,
    ).toBe(true);
    const success = {
      status: 'success',
      replayed: false,
      result: selectionRevisionFixture(),
    };
    const saved = {
      ...selectionUneditedDraftFixture(),
      humanVersion: selectionRevisionFixture().humanVersion,
    };
    for (const [schema, result] of [
      [createSelectionRevisionResultSchema, selectionUneditedDraftFixture()],
      [saveSelectionRevisionResultSchema, saved],
      [submitSelectionRevisionResultSchema, success.result],
      [withdrawSelectionRevisionResultSchema, saved],
    ] as const) {
      expect(schema.safeParse({ ...success, result }).success).toBe(true);
    }
    expect(
      returnSelectionRevisionResultSchema.safeParse({
        ...success,
        result: { ...selectionManagerRevisionFixture(), state: 'draft' },
      }).success,
    ).toBe(true);
    expect(returnSelectionRevisionResultSchema.safeParse(success).success).toBe(
      false,
    );
    expect(
      publishSelectionRevisionResultSchema.safeParse({
        ...success,
        result: selectionPublicationFixture(),
      }).success,
    ).toBe(true);
    expect(
      publishSelectionRevisionResultSchema.safeParse({
        status: 'conflict',
        message: '演示：已被另一位管理者发布',
        input: { ...command, expectedPreviewId: 'demo-preview-r1' },
      }).success,
    ).toBe(true);
    expect(
      createSelectionRevisionResultSchema.safeParse({
        status: 'model_failed',
        message: '演示：模型失败',
        result: selectionRevisionFixture(),
      }).success,
    ).toBe(false);
  });
});

describe('发布五秒撤销与旧操作冲突契约', () => {
  const boundary = () => ({
    receipt: selectionPublicationFixture(),
    command: undoCommand,
    requestedAt: '2026-10-31T10:00:04.999Z',
    currentPublicationId: 'demo-publication',
    currentRevision: 2,
  });
  it.each(['2026-10-31T10:00:00Z', '2026-10-31T10:00:04.999Z'])(
    '五秒窗口内可撤销：%s',
    (requestedAt) => {
      expect(
        selectionPublicationUndoBoundarySchema.safeParse({
          ...boundary(),
          requestedAt,
        }).success,
      ).toBe(true);
    },
  );
  it.each(['2026-10-31T09:59:59.999Z', '2026-10-31T10:00:05Z'])(
    '窗口之外不可撤销：%s',
    (requestedAt) => {
      expect(
        selectionPublicationUndoBoundarySchema.safeParse({
          ...boundary(),
          requestedAt,
        }).success,
      ).toBe(false);
    },
  );
  it('旧发布、旧修订与伪造撤销窗口不能覆盖之后的操作', () => {
    expect(
      selectionPublicationReceiptSchema.safeParse({
        ...selectionPublicationFixture(),
        undoUntil: '2026-10-31T10:00:06Z',
      }).success,
    ).toBe(false);
    for (const patch of [
      { currentPublicationId: 'demo-newer-publication' },
      { currentRevision: 3 },
      { command: { ...undoCommand, publicationId: 'demo-old-publication' } },
    ]) {
      expect(
        selectionPublicationUndoBoundarySchema.safeParse({
          ...boundary(),
          ...patch,
        }).success,
      ).toBe(false);
    }
  });
  it('撤销恢复后续新建期次的默认 v1，第六期等已绑定期次保留原绑定', () => {
    const receipt = {
      publicationId: 'demo-publication',
      restoredVersionId: 'xe-select-v1',
      withdrawnVersionId: 'xe-select-v2',
      restoredDefaultForNewCohorts: 'xe-select-v1',
      preservedBindings: selectionImpactPreviewFixture().preservedBindings,
    };
    expect(
      selectionPublicationUndoReceiptSchema.safeParse(receipt).success,
    ).toBe(true);
    expect(
      undoSelectionPublicationResultSchema.safeParse({
        status: 'success',
        replayed: false,
        result: receipt,
      }).success,
    ).toBe(true);
    expect(
      selectionPublicationUndoReceiptSchema.safeParse({
        ...receipt,
        restoredDefaultForNewCohorts: 'xe-select-v2',
      }).success,
    ).toBe(false);
  });
});

describe('R1：AI 初稿与人工提交的状态边界', () => {
  it('新建 AI 草稿可以真实保持尚未编辑，不伪造 HR 修改', () => {
    const draft = selectionUneditedDraftFixture();
    expect(selectionRevisionSchema.safeParse(draft).success).toBe(true);
    const result = createSelectionRevisionResultSchema.parse({
      status: 'success',
      replayed: false,
      result: draft,
    });
    expect(
      result.status === 'success' && result.result.humanVersion,
    ).toBeNull();
    expect(draft.aiDraft?.origin).toBe('ai_draft');
  });
  it('创建动作不能直接产出待确认，也不能凭空产出已署名 HR 初稿', () => {
    const pending = selectionRevisionFixture();
    expect(
      createSelectionRevisionResultSchema.safeParse({
        status: 'success',
        replayed: false,
        result: pending,
      }).success,
    ).toBe(false);
    expect(
      createSelectionRevisionResultSchema.safeParse({
        status: 'success',
        replayed: false,
        result: {
          ...selectionUneditedDraftFixture(),
          humanVersion: pending.humanVersion,
        },
      }).success,
    ).toBe(false);
  });
  it('提交成功必须是具有实际人工版本的待确认状态', () => {
    const pending = selectionRevisionFixture();
    expect(
      submitSelectionRevisionResultSchema.safeParse({
        status: 'success',
        replayed: false,
        result: pending,
      }).success,
    ).toBe(true);
    expect(
      submitSelectionRevisionResultSchema.safeParse({
        status: 'success',
        replayed: false,
        result: {
          ...selectionUneditedDraftFixture(),
          humanVersion: pending.humanVersion,
        },
      }).success,
    ).toBe(false);
    expect(
      selectionRevisionSchema.safeParse({ ...pending, humanVersion: null })
        .success,
    ).toBe(false);
  });
  it('保存、撤回和退回不能把尚未编辑的 AI 草稿当成人工版本', () => {
    const unedited = selectionUneditedDraftFixture();
    const saved = {
      ...unedited,
      humanVersion: selectionRevisionFixture().humanVersion,
    };
    for (const schema of [
      saveSelectionRevisionResultSchema,
      withdrawSelectionRevisionResultSchema,
    ]) {
      expect(
        schema.safeParse({ status: 'success', replayed: false, result: saved })
          .success,
      ).toBe(true);
      for (const result of [unedited, selectionRevisionFixture()]) {
        expect(
          schema.safeParse({ status: 'success', replayed: false, result })
            .success,
        ).toBe(false);
      }
    }
    const manager = selectionManagerRevisionFixture();
    for (const result of [
      manager,
      { ...manager, state: 'draft', humanVersion: null },
    ]) {
      expect(
        returnSelectionRevisionResultSchema.safeParse({
          status: 'success',
          replayed: false,
          result,
        }).success,
      ).toBe(false);
    }
  });
  it('管理者读取尚未编辑的草稿也不能凭空获得一份 HR 修改', () => {
    const managerDraft = {
      ...selectionManagerRevisionFixture(),
      state: 'draft',
      humanVersion: null,
    };
    expect(selectionManagerRevisionSchema.safeParse(managerDraft).success).toBe(
      true,
    );
    expect(
      selectionManagerRevisionSchema.safeParse({
        ...managerDraft,
        state: 'pending_confirmation',
      }).success,
    ).toBe(false);
  });
  it('撤销包含上一版恢复边；不能把这条边当独立重新发布', () => {
    expect(
      selectionLifecycleTransitionSchema.safeParse({
        action: 'restore_after_undo',
        from: 'superseded',
        to: 'active',
        role: 'system',
        publicationId: 'demo-publication',
      }).success,
    ).toBe(true);
    expect(
      selectionLifecycleTransitionSchema.safeParse({
        action: 'publish',
        from: 'superseded',
        to: 'active',
        role: 'manager',
      }).success,
    ).toBe(false);
  });
});

describe('R1：撤销发布的原子恢复合同', () => {
  it('同一事务恢复上一版状态、当前读取和默认版本，新版回待确认，保留原期次', () => {
    const transaction = selectionPublicationUndoTransactionFixture();
    const result = selectionPublicationUndoTransactionSchema.parse(transaction);
    expect(result.restoredVersion.transition.to).toBe('active');
    expect(result.withdrawnVersion.transition.to).toBe('pending_confirmation');
    expect(result.effectiveVersionAfterUndo.versionId).toBe('xe-select-v1');
    expect(result.receipt.restoredDefaultForNewCohorts).toBe('xe-select-v1');
    expect(result.receipt.preservedBindings).toEqual(result.bindingsBefore);
  });

  it('不能只恢复默认指针；必须同时恢复正确上一版和新版生命周期', () => {
    const transaction = selectionPublicationUndoTransactionFixture();
    for (const patch of [
      {
        withdrawnVersion: {
          ...transaction.withdrawnVersion,
          versionId: 'xe-select-v3',
        },
      },
      {
        withdrawnVersion: {
          ...transaction.withdrawnVersion,
          transition: {
            action: 'publish',
            from: 'pending_confirmation',
            to: 'active',
            role: 'manager',
          },
        },
      },
      {
        restoredVersion: {
          ...transaction.restoredVersion,
          versionId: 'xe-select-v3',
        },
      },
      {
        restoredVersion: {
          ...transaction.restoredVersion,
          transition: {
            action: 'supersede',
            from: 'active',
            to: 'superseded',
            role: 'system',
          },
        },
      },
      {
        restoredVersion: {
          ...transaction.restoredVersion,
          transition: {
            ...transaction.restoredVersion.transition,
            publicationId: 'demo-other-publication',
          },
        },
      },
      {
        effectiveVersionAfterUndo: {
          ...transaction.effectiveVersionAfterUndo,
          versionId: 'xe-select-v2',
        },
      },
      {
        receipt: {
          ...transaction.receipt,
          publicationId: 'demo-other-publication',
        },
      },
      {
        receipt: { ...transaction.receipt, withdrawnVersionId: 'xe-select-v3' },
      },
      {
        receipt: {
          ...transaction.receipt,
          restoredVersionId: 'xe-select-v3',
          restoredDefaultForNewCohorts: 'xe-select-v3',
        },
      },
    ]) {
      expect(
        selectionPublicationUndoTransactionSchema.safeParse({
          ...transaction,
          ...patch,
        }).success,
      ).toBe(false);
    }
  });

  it('上一版必须在撤销时对该类别有效，不能留下空档或读到其他类别', () => {
    const transaction = selectionPublicationUndoTransactionFixture();
    for (const effective of [
      {
        ...transaction.effectiveVersionAfterUndo,
        category: 'dimension_anchors',
        versionId: 'rubric-v1',
      },
      {
        ...transaction.effectiveVersionAfterUndo,
        effectiveFrom: '2026-10-31T10:00:05Z',
      },
      {
        ...transaction.effectiveVersionAfterUndo,
        effectiveUntil: transaction.boundary.requestedAt,
      },
    ]) {
      expect(
        selectionPublicationUndoTransactionSchema.safeParse({
          ...transaction,
          effectiveVersionAfterUndo: effective,
        }).success,
      ).toBe(false);
    }
    expect(
      selectionPublicationUndoTransactionSchema.safeParse({
        ...transaction,
        effectiveVersionAfterUndo: {
          ...transaction.effectiveVersionAfterUndo,
          effectiveUntil: '2026-11-01T00:00:00Z',
        },
      }).success,
    ).toBe(true);
  });

  it('不能借撤销增删、重绑期次或重算历史结果', () => {
    const transaction = selectionPublicationUndoTransactionFixture();
    const binding = transaction.bindingsBefore[0];
    for (const preservedBindings of [
      [],
      [binding, binding],
      [{ ...binding, standardVersionId: 'xe-select-v2' }],
      [{ ...binding, boundAt: '2026-07-02T00:00:00Z' }],
      [{ ...binding, cohort: iterationDemoNextCohort }],
      [
        {
          ...binding,
          cohort: { ...binding.cohort, name: '另一个期次（演示）' },
        },
      ],
    ]) {
      expect(
        selectionPublicationUndoTransactionSchema.safeParse({
          ...transaction,
          receipt: { ...transaction.receipt, preservedBindings },
        }).success,
      ).toBe(false);
    }
    expect(
      selectionPublicationUndoTransactionSchema.safeParse({
        ...transaction,
        bindingsBefore: [binding, binding],
      }).success,
    ).toBe(false);
    expect(
      selectionPublicationUndoTransactionSchema.safeParse({
        ...transaction,
        recomputeHistoricalResults: true,
      }).success,
    ).toBe(false);
    expect(
      selectionPublicationUndoTransactionSchema.safeParse({
        ...transaction,
        historicalResultsPolicy: 'recalculate',
      }).success,
    ).toBe(false);
  });

  it('已到五秒边界或出现较新操作时，整份恢复计划无效', () => {
    const transaction = selectionPublicationUndoTransactionFixture();
    for (const patch of [
      { requestedAt: '2026-10-31T10:00:05Z' },
      { currentRevision: 3 },
      { currentPublicationId: 'demo-newer-publication' },
    ]) {
      expect(
        selectionPublicationUndoTransactionSchema.safeParse({
          ...transaction,
          boundary: { ...transaction.boundary, ...patch },
        }).success,
      ).toBe(false);
    }
  });
});
