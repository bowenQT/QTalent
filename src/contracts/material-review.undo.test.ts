import { describe, expect, it } from 'vitest';
import { materialBatchReceiptSchema } from './materials';
import {
  materialReviewResolvedItemSchema,
  materialReviewUndoCommandSchema,
  materialReviewUndoReceiptSchema,
  materialReviewUndoResultSchema,
} from './material-review';
import { materialReviewItemsFixture } from './materials.fixtures';

const resolutions = {
  speaker: { action: 'bind', personId: 'demo-person' },
  unknown_person: { action: 'keep_original_only' },
  image_scope: { action: 'keep_attachment_only' },
  unknown_interviewer: {
    action: 'link_existing_interviewer',
    personId: 'demo-interviewer',
  },
  unknown_project: { action: 'mark_no_project' },
  unknown_interview_candidate: { action: 'keep_original_only' },
};
function resolvedItem(index: number) {
  const item = materialReviewItemsFixture[index];
  return {
    itemId: item.itemId,
    batchId: item.batchId,
    evaluationNodeId: item.evaluationNodeId,
    materialId: item.materialId,
    originalVersionId: item.originalVersionId,
    revision: 2,
    source: item.source,
    kind: item.kind,
    state: 'resolved',
    resolution: resolutions[item.kind],
    resolvedAt: '2026-11-01T03:00:00.000Z',
    auditId: 'demo-review-audit',
    undo: { status: 'available' },
    ...('importRowId' in item ? { importRowId: item.importRowId } : {}),
    ...('observedName' in item ? { observedName: item.observedName } : {}),
    ...(item.kind === 'speaker' ? { quote: item.quote } : {}),
  };
}
function receipt(index: number) {
  const item = resolvedItem(index);
  return {
    batchId: item.batchId,
    revision: 3,
    evaluationNodeId: item.evaluationNodeId,
    personIds: [],
    projectId: null,
    hasHiddenContent: false,
    status: 'completed',
    jobId: null,
    textMaterial: null,
    files: [
      {
        materialId: item.materialId,
        originalVersionId: item.originalVersionId,
        clientFileId: 'demo-file',
        filename: '演示材料',
        status: 'parsed',
        parseVersionId: 'demo-parse',
      },
    ],
    items: [],
    resolvedItems: [item],
    draftSet: null,
    confirmedDrafts: [],
    error: null,
    counts: {
      files: {
        total: 1,
        processing: 0,
        parsed: 1,
        needs_review: 0,
        unsupported: 0,
        failed: 0,
        original_only: 0,
        attachment_only: 0,
      },
      events: { total: 0, awaiting_confirmation: 0, confirmed: 0 },
      reviewItems: 0,
    },
  };
}
describe('owner continuation R1: resolved material review projection', () => {
  it.each(
    materialReviewItemsFixture.map(
      (item, index) => [item.kind, index] as const,
    ),
  )(
    'returns the %s result without creating an event or unresolved count',
    (_kind, index) => {
      const value = receipt(index);
      expect(materialBatchReceiptSchema.parse(value)).toEqual(value);
    },
  );
  it('reports only the authorized hidden-content boolean without hidden identities or counts', () => {
    const value = { ...receipt(1), hasHiddenContent: true };
    expect(materialBatchReceiptSchema.parse(value)).toEqual(value);
    for (const patch of [
      { hiddenCount: 3 },
      { hiddenPersonIds: ['demo-other'] },
      { hasHiddenContent: 1 },
    ])
      expect(
        materialBatchReceiptSchema.safeParse({ ...value, ...patch }).success,
      ).toBe(false);
  });
});

describe('versioned undo command and pending receipt', () => {
  it.each(
    materialReviewItemsFixture.map(
      (item, index) => [item.kind, index] as const,
    ),
  )(
    'supports %s undo without accepting client authority or a model resume',
    (kind, index) => {
      const old = resolvedItem(index);
      const command = {
        operationId: 'demo-undo',
        batchId: old.batchId,
        itemId: old.itemId,
        kind,
        action: 'undo',
        expectedRevision: old.revision,
      };
      expect(materialReviewUndoCommandSchema.parse(command)).toEqual(command);
      const result = {
        previousRevision: old.revision,
        item: {
          ...materialReviewItemsFixture[index],
          revision: old.revision + 1,
          state: 'pending',
        },
        invalidatedDraftIds: ['demo-unconfirmed-draft'],
        auditId: 'demo-undo-audit',
        resume: null,
      };
      expect(materialReviewUndoReceiptSchema.parse(result)).toEqual(result);
      for (const replayed of [false, true])
        expect(
          materialReviewUndoResultSchema.parse({
            status: 'success',
            replayed,
            result,
          }),
        ).toEqual({ status: 'success', replayed, result });
      for (const patch of [
        { expectedRevision: 0 },
        { operationId: '' },
        { actorId: 'demo-forged' },
        { canUndo: true },
        { dependentDraftsConfirmed: false },
        { imported: false },
        { resolution: resolutions[kind] },
        { kind: 'unknown_kind' },
      ])
        expect(
          materialReviewUndoCommandSchema.safeParse({ ...command, ...patch })
            .success,
        ).toBe(false);
      for (const patch of [
        { previousRevision: 1 },
        { auditId: '' },
        { resume: { stage: 'organizing', jobId: 'demo-automatic-job' } },
        { item: { ...result.item, state: 'deferred' } },
        { item: { ...result.item, scores: [] } },
        { invalidatedDraftIds: ['demo-duplicate', 'demo-duplicate'] },
      ])
        expect(
          materialReviewUndoReceiptSchema.safeParse({ ...result, ...patch })
            .success,
        ).toBe(false);
      for (const message of [
        '依赖草稿已确认，请先撤销确认',
        '面评行已导入，请先撤销导入',
        '事项修订已变化，请刷新后重试',
      ])
        expect(
          materialReviewUndoResultSchema.parse({
            status: 'conflict',
            message,
            input: command,
          }),
        ).toEqual({ status: 'conflict', message, input: command });
      expect(
        materialReviewUndoResultSchema.parse({
          status: 'forbidden',
          message: '当前关系已失效',
        }).status,
      ).toBe('forbidden');
      expect(
        materialReviewUndoResultSchema.parse({
          status: 'not_found',
          message: '核对项不存在或不可见',
        }).status,
      ).toBe('not_found');
    },
  );
});

describe('current read-only resolution and undo cutoff metadata', () => {
  it.each(
    materialReviewItemsFixture.map(
      (item, index) => [item.kind, index] as const,
    ),
  )(
    'describes %s confirmation cutoff and rejects unresolved actions as settled results',
    (kind, index) => {
      const value = resolvedItem(index);
      expect(
        materialReviewResolvedItemSchema.parse({
          ...value,
          undo: { status: 'blocked', reason: 'dependent_draft_confirmed' },
        }).undo,
      ).toEqual({ status: 'blocked', reason: 'dependent_draft_confirmed' });
      const imported = {
        ...value,
        undo: { status: 'blocked', reason: 'interview_row_imported' },
      };
      expect(materialReviewResolvedItemSchema.safeParse(imported).success).toBe(
        kind === 'unknown_interviewer' ||
          kind === 'unknown_interview_candidate',
      );
      for (const patch of [
        { resolution: { action: 'defer' } },
        { resolution: { action: 'unbind' } },
        { state: 'pending' },
        { auditId: '' },
        { resolvedAt: 'yesterday' },
        { undo: { status: 'blocked' } },
        { undo: { status: 'available', grant: true } },
      ])
        expect(
          materialReviewResolvedItemSchema.safeParse({ ...value, ...patch })
            .success,
        ).toBe(false);
    },
  );
  it('keeps active and resolved identities disjoint and binds both to the current material snapshot', () => {
    const value = receipt(1);
    const resolved = value.resolvedItems[0];
    for (const patch of [
      { resolvedItems: [resolved, resolved] },
      { resolvedItems: [{ ...resolved, batchId: 'demo-other-batch' }] },
      { resolvedItems: [{ ...resolved, evaluationNodeId: 'demo-other-node' }] },
      { resolvedItems: [{ ...resolved, materialId: 'demo-other-material' }] },
      {
        items: [materialReviewItemsFixture[1]],
        status: 'needs_review',
        counts: { ...value.counts, reviewItems: 1 },
      },
    ])
      expect(
        materialBatchReceiptSchema.safeParse({ ...value, ...patch }).success,
      ).toBe(false);
    expect(
      materialBatchReceiptSchema.safeParse({
        ...value,
        resolvedItems: undefined,
      }).success,
    ).toBe(false);
    expect(
      materialBatchReceiptSchema.safeParse({
        ...value,
        hasHiddenContent: undefined,
      }).success,
    ).toBe(false);
  });
  it('retains completed-only action alternatives and source position checks', () => {
    const valid = [
      { ...resolvedItem(0), resolution: { action: 'mark_irrelevant' } },
      {
        ...resolvedItem(1),
        resolution: { action: 'bind_people', personIds: ['demo-person'] },
      },
      {
        ...resolvedItem(2),
        resolution: {
          action: 'confirm_scope',
          personIds: ['demo-person'],
          region: { left: 0.1, top: 0.2, right: 0.8, bottom: 0.9 },
        },
      },
      {
        ...resolvedItem(4),
        resolution: {
          action: 'link_existing_project',
          projectId: 'demo-project',
        },
      },
      {
        ...resolvedItem(5),
        resolution: {
          action: 'link_existing_candidate',
          personId: 'demo-person',
        },
      },
    ];
    for (const value of valid)
      expect(materialReviewResolvedItemSchema.parse(value)).toEqual(value);
    expect(
      materialReviewResolvedItemSchema.safeParse({
        ...resolvedItem(0),
        originalVersionId: 'demo-wrong-original',
      }).success,
    ).toBe(false);
    for (const index of [0, 2])
      expect(
        materialReviewResolvedItemSchema.safeParse({
          ...resolvedItem(index),
          source: materialReviewItemsFixture[3].source,
          originalVersionId: materialReviewItemsFixture[3].originalVersionId,
        }).success,
      ).toBe(false);
    for (const index of [3, 5])
      expect(
        materialReviewResolvedItemSchema.safeParse({
          ...resolvedItem(index),
          source: null,
        }).success,
      ).toBe(false);
  });
});

describe('owner supplement: authorized question before the resolved result', () => {
  it.each([1, 3, 4, 5])(
    'retains a nullable original observed name for resolved kind at %i',
    (index) => {
      const value = resolvedItem(index);
      for (const observedName of [null, '演示：原来待核对的名字']) {
        const projected = { ...value, observedName };
        expect(materialReviewResolvedItemSchema.parse(projected)).toEqual(
          projected,
        );
      }
      for (const observedName of [undefined, '', '   ', 42, ['演示姓名']])
        expect(
          materialReviewResolvedItemSchema.safeParse({ ...value, observedName })
            .success,
        ).toBe(false);
    },
  );
  it('returns the speaker question only as a nullable, nonempty read projection', () => {
    const value = resolvedItem(0);
    for (const quote of [null, '演示：这句话由谁说？']) {
      const projected = { ...value, quote };
      expect(materialReviewResolvedItemSchema.parse(projected)).toEqual(
        projected,
      );
    }
    for (const quote of [undefined, '', '   ', 42, { text: '演示引文' }])
      expect(
        materialReviewResolvedItemSchema.safeParse({ ...value, quote }).success,
      ).toBe(false);
    expect(
      materialReviewResolvedItemSchema.safeParse({
        ...value,
        observedName: '演示姓名',
      }).success,
    ).toBe(false);
    expect(
      materialReviewResolvedItemSchema.safeParse({
        ...resolvedItem(1),
        quote: '演示引文',
      }).success,
    ).toBe(false);
  });
  it('does not turn read-only problem context into caller-supplied undo authority or model work', () => {
    const item = materialReviewItemsFixture[0];
    const command = {
      operationId: 'demo-undo-question',
      batchId: item.batchId,
      itemId: item.itemId,
      expectedRevision: 2,
      kind: item.kind,
      action: 'undo',
    };
    for (const patch of [
      { quote: '演示：这句话由谁说？' },
      { observedName: null },
      { canCallModel: true },
    ])
      expect(
        materialReviewUndoCommandSchema.safeParse({ ...command, ...patch })
          .success,
      ).toBe(false);
    const projected = {
      ...receipt(0),
      hasHiddenContent: true,
      resolvedItems: [{ ...resolvedItem(0), quote: null }],
    };
    expect(materialBatchReceiptSchema.parse(projected)).toEqual(projected);
    expect(
      materialBatchReceiptSchema.safeParse({ ...projected, hiddenCount: 1 })
        .success,
    ).toBe(false);
  });
});
