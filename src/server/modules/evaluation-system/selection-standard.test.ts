import { describe, expect, it } from 'vitest';
import {
  authorizeSelectionAction,
  applySelectionReviewPointChanges,
  planCreateSelectionRevision,
  planSaveSelectionRevision,
  planSubmitSelectionRevision,
  planWithdrawSelectionRevision,
  planReturnSelectionRevision,
  planPublishSelectionRevision,
  planUndoSelectionPublication,
  planSelectionCohortBinding,
  prepareSelectionImpactPreview,
  projectSelectionManagerRevision,
  type SelectionAuthority,
} from './selection-standard';
import {
  selectionImpactPreviewFixture,
  selectionRevisionFixture,
  comparisonManagerFixture,
  iterationDemoHr,
  iterationDemoManager,
  iterationDemoCohort,
  iterationDemoNextCohort,
} from '../../../contracts/standard-iteration.fixtures';
import {
  selectionPublicationUndoTransactionSchema,
  type EffectiveRuleVersion,
} from '../../../contracts/selection-standard';

const time = '2026-10-31T10:00:00.000Z';
function authority(
  role: 'hr' | 'manager' = 'hr',
  now = time,
): SelectionAuthority {
  const actor = role === 'hr' ? iterationDemoHr : iterationDemoManager;
  return {
    actor,
    context: {
      account: {
        id: actor.id + '-account',
        personId: actor.id,
        isSystemAdmin: false,
      },
      now,
      grants: (role === 'hr'
        ? [iterationDemoCohort.id, iterationDemoNextCohort.id]
        : [null]
      ).map((cohortId) => ({
        accountId: actor.id + '-account',
        role,
        scope: role === 'hr' ? 'cohort' : 'company',
        cohortId,
        validFrom: '2026-01-01T00:00:00Z',
        validTo: null,
        revokedAt: null,
      })),
      enrollments: [],
      assignments: [],
      projects: [],
      members: [],
      people: [],
    },
  };
}
const initial: EffectiveRuleVersion = {
  category: 'xe_selection',
  versionId: 'xe-select-v1',
  provenance: 'published',
  effectiveFrom: '2026-07-01T00:00:00.000Z',
  effectiveUntil: null,
};
function impact() {
  const preview = selectionImpactPreviewFixture();
  return {
    nextCohort: preview.nextCohort,
    existingResults: preview.existingResults,
    preservedBindings: preview.preservedBindings,
  };
}
const create = {
  operationId: 'demo-create',
  baseVersionId: initial.versionId,
  attributionId: 'demo-attribution',
  expectedAttributionRevision: 1,
  reason: '演示：核验个人贡献',
};
function creationFacts() {
  return {
    draftId: 'demo-draft',
    versionId: 'xe-select-v2',
    previewId: 'demo-preview-1',
    scopeCohortId: iterationDemoCohort.id,
    basis: selectionRevisionFixture().basis,
    managerBasis: comparisonManagerFixture().batches,
    current: initial,
    baseContent: {
      reviewPoints: [
        {
          id: 'demo-basic',
          title: '演示作品',
          description: '演示：保留作品原文引用',
        },
      ],
    },
    impact: impact(),
  };
}
function fresh() {
  return planCreateSelectionRevision(authority(), create, creationFacts());
}
const command = (record: ReturnType<typeof fresh>) => ({
  operationId: 'demo-command',
  draftId: record.revision.id,
  expectedRevision: record.revision.revision,
});
function saved() {
  const record = fresh();
  return planSaveSelectionRevision(
    authority(),
    record,
    {
      ...command(record),
      reason: create.reason,
      changes: selectionRevisionFixture().humanVersion.changes,
    },
    { previewId: 'demo-preview-saved', impact: impact() },
  );
}
function pending() {
  const record = saved();
  return planSubmitSelectionRevision(authority(), record, {
    ...command(record),
    expectedPreviewId: record.revision.impactPreview.id,
  });
}
function published() {
  const record = pending();
  return planPublishSelectionRevision(
    authority('manager'),
    record,
    {
      ...command(record),
      expectedPreviewId: record.revision.impactPreview.id,
    },
    {
      current: initial,
      currentPublicationId: null,
      publicationId: 'demo-pub-1',
      impact: impact(),
    },
  );
}
function undo(at = '2026-10-31T10:00:04.999Z') {
  const publication = published();
  return {
    publication,
    auth: authority('manager', at),
    input: {
      operationId: 'demo-undo',
      publicationId: publication.receipt.publicationId,
      expectedRevision: publication.receipt.revision,
    },
    facts: {
      receipt: publication.receipt,
      current: publication.categorySwitch.activate,
      currentPublicationId: publication.receipt.publicationId,
      previous: initial,
      bindingsBefore: impact().preservedBindings,
    },
  };
}
describe('server-owned current authorization and scoped preview', () => {
  it('revokes access to the entire saved preview before an HR action if its next-cohort scope is withdrawn', () => {
    const record = saved();
    const ctx = authority();
    ctx.context.grants[1].revokedAt = time;
    expect(() =>
      planSubmitSelectionRevision(ctx, record, {
        ...command(record),
        expectedPreviewId: record.revision.impactPreview.id,
      }),
    ).toThrow('权限');
  });
  it.each([
    'revoked',
    'expired',
    'future',
    'wrong_account',
    'wrong_scope',
    'system_admin',
    'forged_actor',
  ])('rejects a %s HR authority before creating a revision', (kind) => {
    const auth = authority();
    if (kind === 'revoked')
      auth.context.grants.forEach((grant) => {
        grant.revokedAt = time;
      });
    if (kind === 'expired')
      auth.context.grants.forEach((grant) => {
        grant.validTo = time;
      });
    if (kind === 'future')
      auth.context.grants.forEach((grant) => {
        grant.validFrom = '2026-11-01T00:00:00Z';
      });
    if (kind === 'wrong_account') auth.context.account.id = 'other-account';
    if (kind === 'wrong_scope')
      auth.context.grants.forEach((grant) => {
        grant.cohortId = 'other-cohort';
      });
    if (kind === 'system_admin') auth.context.account.isSystemAdmin = true;
    if (kind === 'forged_actor') auth.actor = iterationDemoManager;
    expect(() =>
      planCreateSelectionRevision(auth, create, creationFacts()),
    ).toThrow('权限');
  });
  it('does not borrow attribution signatures or serialize another cohort into an HR preview', () => {
    const facts = creationFacts();
    facts.scopeCohortId = 'other-cohort';
    expect(() =>
      planCreateSelectionRevision(authority(), create, facts),
    ).toThrow('权限');
    const source = impact();
    source.existingResults.push({
      cohortId: 'hidden-cohort',
      standardVersionId: 'xe-select-v1',
      count: 93,
    });
    expect(() =>
      prepareSelectionImpactPreview(authority(), fresh(), source, {
        id: 'p',
        contentRevision: 1,
        versionId: 'xe-select-v2',
      }),
    ).toThrow('权限');
    source.existingResults.pop();
    source.preservedBindings[0].cohort = {
      id: 'hidden-cohort',
      name: '不应泄露',
    };
    expect(() =>
      prepareSelectionImpactPreview(authority(), fresh(), source, {
        id: 'p',
        contentRevision: 1,
        versionId: 'xe-select-v2',
      }),
    ).toThrow('权限');
    const target = impact();
    target.nextCohort = { id: 'hidden-next-cohort', name: '不应泄露' };
    expect(() =>
      prepareSelectionImpactPreview(authority(), fresh(), target, {
        id: 'p',
        contentRevision: 1,
        versionId: 'xe-select-v2',
      }),
    ).toThrow('权限');
  });
  it('separates HR editing from manager confirmation and rejects malformed business time', () => {
    expect(() =>
      authorizeSelectionAction(
        authority('manager'),
        'hr',
        iterationDemoCohort.id,
      ),
    ).toThrow('权限');
    expect(() => authorizeSelectionAction(authority(), 'manager')).toThrow(
      '权限',
    );
    expect(() =>
      authorizeSelectionAction(authority('hr', 'not-a-time'), 'hr'),
    ).toThrow();
    expect(() => authorizeSelectionAction(authority(), 'hr')).not.toThrow();
  });
});
describe('draft, saved human version and immutable preview', () => {
  it('creates an unsigned draft from a confirmed eligible attribution, with no model call or human impersonation', () => {
    const facts = creationFacts();
    const before = structuredClone(facts);
    const record = fresh();
    expect(record.revision).toMatchObject({
      state: 'draft',
      humanVersion: null,
      aiDraft: null,
      revision: 1,
    });
    expect(record.revision.impactPreview).toMatchObject({
      existingResultsPolicy: 'preserve_original_version',
      recomputeHistoricalResults: false,
      nextComparisonGrouping: 'selection_standard_version',
    });
    expect(record.content).toBeNull();
    expect(facts).toEqual(before);
    expect(() =>
      planSubmitSelectionRevision(authority(), record, {
        ...command(record),
        expectedPreviewId: record.revision.impactPreview.id,
      }),
    ).toThrow('人工版本');
  });
  it.each([
    'attribution_revision',
    'attribution_id',
    'ineligible',
    'wrong_category',
    'future_version',
    'ended_version',
    'different_base',
    'different_summary',
  ])(
    'rejects %s input facts rather than freezing invented authority or a stale base',
    (kind) => {
      const facts = creationFacts();
      if (kind === 'attribution_revision') facts.basis.revision++;
      if (kind === 'attribution_id') facts.basis.id = 'other';
      if (kind === 'ineligible') facts.basis.categories = ['evaluator'];
      if (kind === 'wrong_category')
        facts.current = {
          ...initial,
          category: 'dimension_anchors',
          versionId: 'rubric-v1',
        };
      if (kind === 'future_version')
        facts.current = { ...initial, effectiveFrom: '2026-11-01T00:00:00Z' };
      if (kind === 'ended_version')
        facts.current = { ...initial, effectiveUntil: time };
      if (kind === 'different_base')
        facts.current = { ...initial, versionId: 'xe-select-v9' };
      if (kind === 'different_summary')
        facts.managerBasis[0].batch.id = 'another-batch';
      expect(() =>
        planCreateSelectionRevision(authority(), create, facts),
      ).toThrow();
    },
  );
  it('saves only actual HR content, increments content revision and rejects the old preview', () => {
    const draft = fresh();
    const record = saved();
    expect(record.revision).toMatchObject({
      revision: 2,
      contentRevision: 2,
      humanVersion: {
        origin: 'hr_edited',
        editedBy: iterationDemoHr,
        editedAt: time,
      },
    });
    expect(record.content!.reviewPoints.map((point) => point.id)).toEqual([
      'demo-basic',
      'demo-individual-contribution',
    ]);
    expect(draft.revision.humanVersion).toBeNull();
    expect(() =>
      planSubmitSelectionRevision(authority(), record, {
        ...command(record),
        expectedPreviewId: draft.revision.impactPreview.id,
      }),
    ).toThrow('预览');
    const submitted = pending();
    expect(submitted.revision.state).toBe('pending_confirmation');
    expect(submitted.revision.impactPreview).toEqual(
      record.revision.impactPreview,
    );
    expect(submitted.revision.revision).toBe(3);
  });
  it('requires current optimistic revision and rejects client actor/role/time extensions', () => {
    const record = saved();
    const input = {
      ...command(record),
      expectedPreviewId: record.revision.impactPreview.id,
    };
    expect(() =>
      planSubmitSelectionRevision(authority(), record, {
        ...input,
        expectedRevision: 1,
      }),
    ).toThrow('刷新');
    expect(() =>
      planSubmitSelectionRevision(authority(), record, {
        ...input,
        draftId: 'other',
      }),
    ).toThrow('刷新');
    for (const extra of [
      { actor: iterationDemoHr },
      { role: 'manager' },
      { now: time },
    ])
      expect(() =>
        planSubmitSelectionRevision(authority(), record, {
          ...input,
          ...extra,
        }),
      ).toThrow();
    const submitted = pending();
    expect(() =>
      planSubmitSelectionRevision(authority(), submitted, {
        ...command(submitted),
        expectedPreviewId: submitted.revision.impactPreview.id,
      }),
    ).toThrow('状态');
  });
  it('preserves submitted content on HR withdrawal and records a manager return reason without exposing private basis', () => {
    const record = pending();
    const withdrawn = planWithdrawSelectionRevision(
      authority(),
      record,
      command(record),
    );
    expect(withdrawn.revision).toMatchObject({
      state: 'draft',
      lastReturn: null,
    });
    expect(withdrawn.revision.humanVersion).toEqual(
      record.revision.humanVersion,
    );
    const returned = planReturnSelectionRevision(authority('manager'), record, {
      ...command(record),
      reason: '演示：补充可核验说明',
    });
    expect(returned.revision).toMatchObject({
      state: 'draft',
      lastReturn: {
        reason: '演示：补充可核验说明',
        returnedBy: iterationDemoManager,
      },
    });
    expect(returned.revision.impactPreview).toEqual(
      record.revision.impactPreview,
    );
    expect(() =>
      planReturnSelectionRevision(authority('manager'), record, {
        ...command(record),
        reason: ' ',
      }),
    ).toThrow();
    const view = projectSelectionManagerRevision(returned);
    expect(view.basis).toEqual(comparisonManagerFixture().batches);
    expect(view).not.toHaveProperty('aiDraft');
    expect(JSON.stringify(view)).not.toContain('demo-comparison-');
    expect(JSON.stringify(view)).not.toContain('demo-front-row-');
  });
  it('rejects duplicate impact groups, duplicate bindings and an already bound next cohort', () => {
    for (const kind of ['groups', 'bindings', 'bound_next']) {
      const facts = impact();
      if (kind === 'groups')
        facts.existingResults.push(facts.existingResults[0]);
      if (kind === 'bindings')
        facts.preservedBindings.push(facts.preservedBindings[0]);
      if (kind === 'bound_next')
        facts.nextCohort = facts.preservedBindings[0].cohort;
      expect(() =>
        prepareSelectionImpactPreview(authority(), fresh(), facts, {
          id: 'p',
          contentRevision: 1,
          versionId: 'xe-select-v2',
        }),
      ).toThrow();
    }
  });
  it('validates actual before/after content for edit/remove/add and keeps version content immutable', () => {
    const base = creationFacts().baseContent;
    const point = base.reviewPoints[0];
    expect(
      applySelectionReviewPointChanges(base, [
        {
          kind: 'edit',
          before: point,
          after: { ...point, description: '演示：新要点' },
        },
      ]).reviewPoints[0].description,
    ).toBe('演示：新要点');
    const added = applySelectionReviewPointChanges(
      base,
      selectionRevisionFixture().humanVersion.changes,
    );
    expect(
      applySelectionReviewPointChanges(added, [
        { kind: 'remove', before: point },
      ]).reviewPoints,
    ).toHaveLength(1);
    expect(() =>
      applySelectionReviewPointChanges(base, [{ kind: 'add', after: point }]),
    ).toThrow('已存在');
    expect(() =>
      applySelectionReviewPointChanges(base, [
        { kind: 'remove', before: { ...point, description: '伪造旧文' } },
      ]),
    ).toThrow('不一致');
    expect(() =>
      applySelectionReviewPointChanges(base, [
        { kind: 'remove', before: point },
      ]),
    ).toThrow();
    expect(base.reviewPoints[0]).toEqual(point);
  });
});
describe('publication plans and the five-second paired undo', () => {
  it('compares the saved preview by values when storage returns object keys in a different order', () => {
    const record = pending();
    const facts = impact();
    facts.nextCohort = { name: facts.nextCohort.name, id: facts.nextCohort.id };
    const row = facts.existingResults[0];
    facts.existingResults[0] = {
      count: row.count,
      standardVersionId: row.standardVersionId,
      cohortId: row.cohortId,
    };
    const binding = facts.preservedBindings[0];
    facts.preservedBindings[0] = {
      boundAt: binding.boundAt,
      standardVersionId: binding.standardVersionId,
      cohort: { name: binding.cohort.name, id: binding.cohort.id },
    };
    expect(() =>
      planPublishSelectionRevision(
        authority('manager'),
        record,
        {
          ...command(record),
          expectedPreviewId: record.revision.impactPreview.id,
        },
        {
          current: initial,
          currentPublicationId: null,
          publicationId: 'demo-pub',
          impact: facts,
        },
      ),
    ).not.toThrow();
  });
  it('publishes the exact saved human version and selection-only category switch', () => {
    const result = published();
    expect(result.record.revision.state).toBe('active');
    expect(result.receipt).toMatchObject({
      previousVersionId: 'xe-select-v1',
      versionId: 'xe-select-v2',
      revision: 4,
      previewId: 'demo-preview-saved',
      publishedBy: iterationDemoManager,
      undoUntil: '2026-10-31T10:00:05.000Z',
    });
    expect(result.categorySwitch).toMatchObject({
      category: 'xe_selection',
      expectedVersionId: 'xe-select-v1',
      deactivateVersionId: 'xe-select-v1',
      activate: {
        versionId: 'xe-select-v2',
        effectiveFrom: time,
        effectiveUntil: null,
      },
    });
    expect(result.previousTransition).toMatchObject({
      action: 'supersede',
      role: 'system',
    });
    expect(result.record.content).toEqual(saved().content);
    expect(projectSelectionManagerRevision(result.record).state).toBe('active');
  });
  it.each([
    'base',
    'preview',
    'changed_count',
    'next_bound',
    'missing_content',
  ])(
    'refuses publication with %s drift instead of silently refreshing the confirmer preview',
    (kind) => {
      const record = pending();
      const input = {
        ...command(record),
        expectedPreviewId: record.revision.impactPreview.id,
      };
      const facts = {
        current: initial,
        currentPublicationId: null,
        publicationId: 'pub',
        impact: impact(),
      };
      if (kind === 'base')
        facts.current = { ...initial, versionId: 'xe-select-v9' };
      if (kind === 'preview') input.expectedPreviewId = 'stale';
      if (kind === 'changed_count') facts.impact.existingResults[0].count++;
      if (kind === 'next_bound')
        facts.impact.preservedBindings.push({
          cohort: iterationDemoNextCohort,
          standardVersionId: 'xe-select-v1',
          boundAt: time,
        });
      if (kind === 'missing_content') record.content = null;
      expect(() =>
        planPublishSelectionRevision(
          authority('manager'),
          record,
          input,
          facts,
        ),
      ).toThrow();
    },
  );
  it.each([time, '2026-10-31T10:00:04.999Z'])(
    'restores the previous category/default atomically in the plan at %s',
    (at) => {
      const args = undo(at);
      const result = planUndoSelectionPublication(
        args.auth,
        args.publication.record,
        args.input,
        args.facts,
      );
      expect(result.record.revision.state).toBe('pending_confirmation');
      expect(result.record.revision.revision).toBe(5);
      expect(result.categorySwitch.activate.versionId).toBe('xe-select-v1');
      expect(result.receipt.restoredDefaultForNewCohorts).toBe('xe-select-v1');
      expect(result.receipt.preservedBindings).toEqual(
        impact().preservedBindings,
      );
      expect(
        selectionPublicationUndoTransactionSchema.safeParse(result.transaction)
          .success,
      ).toBe(true);
      expect(result.transaction.withdrawnVersion.transition.action).toBe(
        'undo_publish',
      );
      expect(result.transaction.restoredVersion.transition.action).toBe(
        'restore_after_undo',
      );
    },
  );
  it.each([
    'too_late',
    'before_publish',
    'old_revision',
    'old_publication',
    'later_publication',
    'later_version',
    'wrong_previous',
    'missing_submission',
  ])(
    'rejects %s undo so old work cannot overwrite later operations',
    (kind) => {
      const args = undo(
        kind === 'too_late'
          ? '2026-10-31T10:00:05.000Z'
          : kind === 'before_publish'
            ? '2026-10-31T09:59:59.999Z'
            : undefined,
      );
      if (kind === 'old_revision') args.input.expectedRevision--;
      if (kind === 'old_publication') args.input.publicationId = 'old';
      if (kind === 'later_publication')
        args.facts.currentPublicationId = 'later';
      if (kind === 'later_version')
        args.facts.current = {
          ...args.facts.current,
          versionId: 'xe-select-v3',
        };
      if (kind === 'wrong_previous')
        args.facts.previous = { ...initial, versionId: 'xe-select-v9' };
      if (kind === 'missing_submission')
        args.publication.record.submission = null;
      expect(() =>
        planUndoSelectionPublication(
          args.auth,
          args.publication.record,
          args.input,
          args.facts,
        ),
      ).toThrow();
    },
  );
  it('keeps sixth/seventh cohort bindings and published content stable through undo and subsequent editing attempts', () => {
    const publication = published();
    const sixth = impact().preservedBindings[0];
    const seventh = planSelectionCohortBinding(
      authority('manager'),
      iterationDemoNextCohort,
      null,
      publication.categorySwitch.activate,
    );
    expect(seventh.standardVersionId).toBe('xe-select-v2');
    expect(
      planSelectionCohortBinding(
        authority('manager'),
        iterationDemoCohort,
        sixth,
        publication.categorySwitch.activate,
      ),
    ).toEqual(sixth);
    const args = undo();
    args.facts.bindingsBefore.push(seventh);
    const restored = planUndoSelectionPublication(
      args.auth,
      args.publication.record,
      args.input,
      args.facts,
    );
    expect(
      restored.receipt.preservedBindings.map(
        (binding) => binding.standardVersionId,
      ),
    ).toEqual(['xe-select-v1', 'xe-select-v2']);
    expect(
      planSelectionCohortBinding(
        args.auth,
        iterationDemoNextCohort,
        seventh,
        restored.categorySwitch.activate,
      ),
    ).toEqual(seventh);
    const eighth = planSelectionCohortBinding(
      args.auth,
      { id: 'demo-xe8', name: '第八期（演示）' },
      null,
      restored.categorySwitch.activate,
    );
    expect(eighth.standardVersionId).toBe('xe-select-v1');
    const withdrawn = planWithdrawSelectionRevision(
      authority(),
      restored.record,
      command(restored.record),
    );
    expect(() =>
      planSaveSelectionRevision(
        authority(),
        withdrawn,
        {
          ...command(withdrawn),
          reason: create.reason,
          changes: selectionRevisionFixture().humanVersion.changes,
        },
        { previewId: 'changed', impact: impact() },
      ),
    ).toThrow('另起修订');
    expect(publication.record.content).toEqual(saved().content);
  });
  it('denies an unrelated binding and an invalid or non-selection current category', () => {
    const sixth = impact().preservedBindings[0];
    expect(() =>
      planSelectionCohortBinding(
        authority(),
        iterationDemoNextCohort,
        sixth,
        initial,
      ),
    ).toThrow('不属于');
    expect(() =>
      planSelectionCohortBinding(authority(), iterationDemoNextCohort, null, {
        ...initial,
        category: 'dimension_anchors',
        versionId: 'rubric-v1',
      }),
    ).toThrow('标准');
    expect(() =>
      planSelectionCohortBinding(
        authority(),
        { id: 'hidden', name: '隐藏期次' },
        null,
        initial,
      ),
    ).toThrow('权限');
  });
});
