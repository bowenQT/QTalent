import { z } from 'zod';
import {
  createSelectionRevisionInputSchema,
  saveSelectionRevisionInputSchema,
  submitSelectionRevisionInputSchema,
  withdrawSelectionRevisionInputSchema,
  returnSelectionRevisionInputSchema,
  publishSelectionRevisionInputSchema,
  undoSelectionPublicationInputSchema,
  selectionImpactPreviewSchema,
  selectionRevisionSchema,
  selectionManagerRevisionSchema,
  selectionStandardContentSchema,
  selectionReviewPointChangesSchema,
  selectionPublicationReceiptSchema,
  selectionPublicationUndoTransactionSchema,
  selectionCohortBindingChangeSchema,
  selectionCohortBindingSchema,
  effectiveRuleVersionSchema,
  SELECTION_PUBLICATION_UNDO_WINDOW_MS,
  type SelectionRevision,
  type SelectionImpactPreview,
  type SelectionCohortBinding,
  type SelectionPublicationReceipt,
  type SelectionReviewPointChange,
  type EffectiveRuleVersion,
} from '../../../contracts/selection-standard';
import { revisionEligibleAttributionSchema } from '../../../contracts/standard-attribution';
import { comparisonManagerBasisSchema } from '../../../contracts/judgment-comparison';
import { activeGrants, type AuthzContext } from '../../authz';

type Actor = SelectionPublicationReceipt['publishedBy'];
type Content = z.infer<typeof selectionStandardContentSchema>;
type Basis = SelectionRevision['basis'];
type ManagerBasis = z.infer<typeof comparisonManagerBasisSchema>;

/** These facts are loaded on the server; no request may supply authority/time. */
export interface SelectionAuthority {
  context: AuthzContext;
  actor: Actor;
}
export interface SelectionImpactFacts {
  nextCohort: SelectionImpactPreview['nextCohort'];
  existingResults: SelectionImpactPreview['existingResults'];
  preservedBindings: SelectionCohortBinding[];
}
export interface SelectionRevisionRecord {
  revision: SelectionRevision;
  scopeCohortId: string;
  baseContent: Content;
  content: Content | null;
  /** Published content is immutable even if publication is later undone. */
  contentWasPublished: boolean;
  managerBasis: ManagerBasis[];
  submission: { submittedBy: Actor; submittedAt: string } | null;
}
export class SelectionLifecycleError extends Error {
  constructor(
    readonly status: 'forbidden' | 'not_found' | 'conflict',
    message: string,
  ) {
    super(message);
    this.name = 'SelectionLifecycleError';
  }
}
function conflict(message: string): never {
  throw new SelectionLifecycleError('conflict', message);
}
function instant(authority: SelectionAuthority): string {
  return z.iso.datetime().parse(authority.context.now);
}
function requireCurrent(
  version: EffectiveRuleVersion,
  authority: SelectionAuthority,
) {
  effectiveRuleVersionSchema.parse(version);
  const at = Date.parse(instant(authority));
  if (
    version.category !== 'xe_selection' ||
    Date.parse(version.effectiveFrom) > at ||
    (version.effectiveUntil !== null &&
      at >= Date.parse(version.effectiveUntil))
  )
    conflict('当前选拔标准已变化');
}
export function authorizeSelectionAction(
  authority: SelectionAuthority,
  role: 'hr' | 'manager',
  cohortId?: string,
) {
  instant(authority);
  if (
    authority.actor.id !== authority.context.account.personId ||
    !activeGrants(authority.context).some(
      (grant) =>
        grant.role === role &&
        (role === 'manager' ||
          cohortId === undefined ||
          grant.cohortId === cohortId),
    )
  )
    throw new SelectionLifecycleError(
      'forbidden',
      '你没有处理此选拔标准的权限',
    );
}
function fields(revision: SelectionRevision) {
  return {
    id: revision.id,
    category: revision.category,
    versionId: revision.versionId,
    baseVersionId: revision.baseVersionId,
    revision: revision.revision,
    contentRevision: revision.contentRevision,
    reason: revision.reason,
    effect: revision.effect,
    basis: revision.basis,
    aiDraft: revision.aiDraft,
    humanVersion: revision.humanVersion,
    impactPreview: revision.impactPreview,
  };
}
function guard(
  authority: SelectionAuthority,
  record: SelectionRevisionRecord,
  input: { draftId: string; expectedRevision: number },
  role: 'hr' | 'manager',
  state: SelectionRevision['state'],
) {
  authorizeSelectionAction(authority, role, record.scopeCohortId);
  if (role === 'hr') {
    for (const cohort of [
      record.revision.impactPreview.nextCohort.id,
      ...record.revision.impactPreview.existingResults.map(
        (row) => row.cohortId,
      ),
      ...record.revision.impactPreview.preservedBindings.map(
        (row) => row.cohort.id,
      ),
    ])
      authorizeSelectionAction(authority, role, cohort);
  }
  selectionRevisionSchema.parse(record.revision);
  if (
    record.revision.id !== input.draftId ||
    record.revision.revision !== input.expectedRevision
  )
    conflict('草稿已变化，请刷新后重试');
  if (record.revision.state !== state) conflict('当前状态不能执行此操作');
}
function normalizeImpact(facts: SelectionImpactFacts): SelectionImpactFacts {
  const groups = facts.existingResults.map((row) =>
    JSON.stringify([row.cohortId, row.standardVersionId]),
  );
  if (
    new Set(groups).size !== groups.length ||
    new Set(facts.preservedBindings.map((binding) => binding.cohort.id))
      .size !== facts.preservedBindings.length
  )
    conflict('影响快照含重复的结果分组或期次绑定');
  return {
    nextCohort: { id: facts.nextCohort.id, name: facts.nextCohort.name },
    existingResults: facts.existingResults
      .map((row) => ({
        cohortId: row.cohortId,
        standardVersionId: row.standardVersionId,
        count: row.count,
      }))
      .sort((a, b) =>
        JSON.stringify([a.cohortId, a.standardVersionId]).localeCompare(
          JSON.stringify([b.cohortId, b.standardVersionId]),
        ),
      ),
    preservedBindings: facts.preservedBindings
      .map((binding) => ({
        cohort: { id: binding.cohort.id, name: binding.cohort.name },
        standardVersionId: binding.standardVersionId,
        boundAt: new Date(binding.boundAt).toISOString(),
      }))
      .sort((a, b) => a.cohort.id.localeCompare(b.cohort.id)),
  };
}
export function prepareSelectionImpactPreview(
  authority: SelectionAuthority,
  record: Pick<SelectionRevisionRecord, 'scopeCohortId'>,
  facts: SelectionImpactFacts,
  identifiers: { id: string; contentRevision: number; versionId: string },
): SelectionImpactPreview {
  authorizeSelectionAction(authority, 'hr', record.scopeCohortId);
  // The preview is a scoped aggregate, never a dump of server-global bindings.
  for (const cohort of [
    facts.nextCohort.id,
    ...facts.existingResults.map((row) => row.cohortId),
    ...facts.preservedBindings.map((row) => row.cohort.id),
  ])
    authorizeSelectionAction(authority, 'hr', cohort);
  return selectionImpactPreviewSchema.parse({
    id: identifiers.id,
    contentRevision: identifiers.contentRevision,
    generatedAt: instant(authority),
    ...normalizeImpact(facts),
    newStandardVersionId: identifiers.versionId,
    existingResultsPolicy: 'preserve_original_version',
    recomputeHistoricalResults: false,
    nextComparisonGrouping: 'selection_standard_version',
  });
}
export function applySelectionReviewPointChanges(
  base: Content,
  changes: SelectionReviewPointChange[],
): Content {
  const parsed = selectionStandardContentSchema.parse(base);
  const parsedChanges = selectionReviewPointChangesSchema.parse(changes);
  const points = new Map(
    parsed.reviewPoints.map((point) => [point.id, structuredClone(point)]),
  );
  // Changes are validated by the frozen save command before this function.
  const seen = new Set<string>();
  for (const change of parsedChanges) {
    const key = change.kind === 'add' ? change.after.id : change.before.id;
    if (seen.has(key)) conflict('同一要点不能重复修改');
    seen.add(key);
    const current = points.get(key);
    if (change.kind === 'add') {
      if (current) conflict('新增要点已存在');
      points.set(key, structuredClone(change.after));
    } else {
      if (!current || JSON.stringify(current) !== JSON.stringify(change.before))
        conflict('修改依据与原版本内容不一致');
      if (change.kind === 'remove') points.delete(key);
      else points.set(key, structuredClone(change.after));
    }
  }
  if (points.size === 0) conflict('修订至少保留一个评审要点');
  return selectionStandardContentSchema.parse({
    reviewPoints: [...points.values()],
  });
}
export function planCreateSelectionRevision(
  authority: SelectionAuthority,
  raw: unknown,
  facts: {
    draftId: string;
    versionId: string;
    previewId: string;
    scopeCohortId: string;
    basis: Basis;
    managerBasis: ManagerBasis[];
    current: EffectiveRuleVersion;
    baseContent: Content;
    impact: SelectionImpactFacts;
  },
): SelectionRevisionRecord {
  const input = createSelectionRevisionInputSchema.parse(raw);
  authorizeSelectionAction(authority, 'hr', facts.scopeCohortId);
  const basis = revisionEligibleAttributionSchema.parse(facts.basis);
  const current = effectiveRuleVersionSchema.parse(facts.current);
  requireCurrent(current, authority);
  if (
    basis.id !== input.attributionId ||
    basis.revision !== input.expectedAttributionRevision ||
    current.category !== 'xe_selection' ||
    current.versionId !== input.baseVersionId
  )
    conflict('归因或当前选拔标准版本已变化');
  if (
    facts.managerBasis.some(
      (row) =>
        row.batch.id !== basis.batchId ||
        row.batch.cohort.id !== facts.scopeCohortId ||
        row.batch.selectionStandardVersionId !== input.baseVersionId,
    )
  )
    conflict('确认摘要与归因所属批次不一致');
  const preview = prepareSelectionImpactPreview(
    authority,
    facts,
    facts.impact,
    {
      id: facts.previewId,
      contentRevision: 1,
      versionId: facts.versionId,
    },
  );
  const revision = selectionRevisionSchema.parse({
    id: facts.draftId,
    category: 'xe_selection',
    versionId: facts.versionId,
    baseVersionId: input.baseVersionId,
    revision: 1,
    contentRevision: 1,
    reason: input.reason,
    effect: 'next_selection_cohort',
    basis,
    aiDraft: null,
    humanVersion: null,
    impactPreview: preview,
    state: 'draft',
    lastReturn: null,
  });
  return {
    revision,
    scopeCohortId: facts.scopeCohortId,
    baseContent: selectionStandardContentSchema.parse(facts.baseContent),
    content: null,
    contentWasPublished: false,
    managerBasis: z
      .array(comparisonManagerBasisSchema)
      .min(1)
      .parse(facts.managerBasis),
    submission: null,
  };
}
export function planSaveSelectionRevision(
  authority: SelectionAuthority,
  record: SelectionRevisionRecord,
  raw: unknown,
  facts: { previewId: string; impact: SelectionImpactFacts },
): SelectionRevisionRecord {
  const input = saveSelectionRevisionInputSchema.parse(raw);
  guard(authority, record, input, 'hr', 'draft');
  if (record.contentWasPublished)
    conflict('已发布版本的内容须保留，请另起修订');
  const content = applySelectionReviewPointChanges(
    record.baseContent,
    input.changes,
  );
  const contentRevision = record.revision.contentRevision + 1;
  return {
    ...record,
    content,
    revision: selectionRevisionSchema.parse({
      ...fields(record.revision),
      state: 'draft',
      lastReturn:
        record.revision.state === 'draft' ? record.revision.lastReturn : null,
      revision: record.revision.revision + 1,
      contentRevision,
      reason: input.reason,
      humanVersion: {
        origin: 'hr_edited',
        changes: input.changes,
        editedBy: authority.actor,
        editedAt: instant(authority),
      },
      impactPreview: prepareSelectionImpactPreview(
        authority,
        record,
        facts.impact,
        {
          id: facts.previewId,
          contentRevision,
          versionId: record.revision.versionId,
        },
      ),
    }),
  };
}
export function planSubmitSelectionRevision(
  authority: SelectionAuthority,
  record: SelectionRevisionRecord,
  raw: unknown,
): SelectionRevisionRecord {
  const input = submitSelectionRevisionInputSchema.parse(raw);
  guard(authority, record, input, 'hr', 'draft');
  if (record.revision.humanVersion === null || record.content === null)
    conflict('请先由 HR 保存人工版本');
  if (input.expectedPreviewId !== record.revision.impactPreview.id)
    conflict('影响预览已变化');
  const submission = {
    submittedBy: authority.actor,
    submittedAt: instant(authority),
  };
  return {
    ...record,
    submission,
    revision: selectionRevisionSchema.parse({
      ...fields(record.revision),
      state: 'pending_confirmation',
      revision: record.revision.revision + 1,
      ...submission,
    }),
  };
}
export function planWithdrawSelectionRevision(
  authority: SelectionAuthority,
  record: SelectionRevisionRecord,
  raw: unknown,
): SelectionRevisionRecord {
  const input = withdrawSelectionRevisionInputSchema.parse(raw);
  guard(authority, record, input, 'hr', 'pending_confirmation');
  return {
    ...record,
    revision: selectionRevisionSchema.parse({
      ...fields(record.revision),
      state: 'draft',
      revision: record.revision.revision + 1,
      lastReturn: null,
    }),
  };
}
export function planReturnSelectionRevision(
  authority: SelectionAuthority,
  record: SelectionRevisionRecord,
  raw: unknown,
): SelectionRevisionRecord {
  const input = returnSelectionRevisionInputSchema.parse(raw);
  guard(authority, record, input, 'manager', 'pending_confirmation');
  return {
    ...record,
    revision: selectionRevisionSchema.parse({
      ...fields(record.revision),
      state: 'draft',
      revision: record.revision.revision + 1,
      lastReturn: {
        reason: input.reason,
        returnedBy: authority.actor,
        returnedAt: instant(authority),
      },
    }),
  };
}
export interface SelectionCategorySwitch {
  category: 'xe_selection';
  expectedVersionId: string;
  expectedPublicationId: string | null;
  activate: EffectiveRuleVersion;
  deactivateVersionId: string;
  at: string;
}
export function planPublishSelectionRevision(
  authority: SelectionAuthority,
  record: SelectionRevisionRecord,
  raw: unknown,
  facts: {
    current: EffectiveRuleVersion;
    currentPublicationId: string | null;
    publicationId: string;
    impact: SelectionImpactFacts;
  },
) {
  const input = publishSelectionRevisionInputSchema.parse(raw);
  guard(authority, record, input, 'manager', 'pending_confirmation');
  const current = effectiveRuleVersionSchema.parse(facts.current);
  requireCurrent(current, authority);
  if (
    current.category !== 'xe_selection' ||
    current.versionId !== record.revision.baseVersionId
  )
    conflict('当前选拔标准已变化，请重新核对修订');
  if (input.expectedPreviewId !== record.revision.impactPreview.id)
    conflict('影响预览已变化');
  if (
    JSON.stringify(normalizeImpact(record.revision.impactPreview)) !==
    JSON.stringify(normalizeImpact(facts.impact))
  )
    conflict('影响事实已变化，请由 HR 重新保存预览');
  if (record.content === null || record.revision.humanVersion === null)
    conflict('缺少保存的人工版本');
  const publishedAt = instant(authority);
  const undoUntil = new Date(
    Date.parse(publishedAt) + SELECTION_PUBLICATION_UNDO_WINDOW_MS,
  ).toISOString();
  const publication = {
    publicationId: facts.publicationId,
    publishedBy: authority.actor,
    publishedAt,
    undoUntil,
  };
  const receipt = selectionPublicationReceiptSchema.parse({
    ...publication,
    versionId: record.revision.versionId,
    previousVersionId: current.versionId,
    revision: record.revision.revision + 1,
    previewId: record.revision.impactPreview.id,
    nextCohort: record.revision.impactPreview.nextCohort,
  });
  const categorySwitch: SelectionCategorySwitch = {
    category: 'xe_selection',
    expectedVersionId: current.versionId,
    expectedPublicationId: facts.currentPublicationId,
    deactivateVersionId: current.versionId,
    activate: {
      category: 'xe_selection',
      versionId: record.revision.versionId,
      provenance: 'published',
      effectiveFrom: publishedAt,
      effectiveUntil: null,
    },
    at: publishedAt,
  };
  return {
    record: {
      ...record,
      contentWasPublished: true,
      revision: selectionRevisionSchema.parse({
        ...fields(record.revision),
        state: 'active',
        revision: receipt.revision,
        ...publication,
      }),
    },
    receipt,
    categorySwitch,
    previousTransition: {
      action: 'supersede' as const,
      from: 'active' as const,
      to: 'superseded' as const,
      role: 'system' as const,
    },
  };
}
export function planUndoSelectionPublication(
  authority: SelectionAuthority,
  record: SelectionRevisionRecord,
  raw: unknown,
  facts: {
    receipt: SelectionPublicationReceipt;
    current: EffectiveRuleVersion;
    currentPublicationId: string | null;
    previous: EffectiveRuleVersion;
    bindingsBefore: SelectionCohortBinding[];
  },
) {
  const input = undoSelectionPublicationInputSchema.parse(raw);
  authorizeSelectionAction(authority, 'manager');
  requireCurrent(facts.current, authority);
  if (
    record.revision.state !== 'active' ||
    record.submission === null ||
    record.revision.publicationId !== facts.receipt.publicationId ||
    record.revision.versionId !== facts.receipt.versionId ||
    facts.current.category !== 'xe_selection' ||
    facts.current.versionId !== facts.receipt.versionId ||
    facts.previous.category !== 'xe_selection' ||
    facts.previous.versionId !== facts.receipt.previousVersionId
  )
    conflict('该次发布已变化，不能撤销');
  const now = instant(authority);
  const restored = effectiveRuleVersionSchema.parse({
    ...facts.previous,
    effectiveFrom: now,
    effectiveUntil: null,
  });
  const validation = selectionPublicationUndoTransactionSchema.safeParse({
    boundary: {
      receipt: facts.receipt,
      command: input,
      requestedAt: now,
      currentPublicationId: facts.currentPublicationId,
      currentRevision: record.revision.revision,
    },
    withdrawnVersion: {
      versionId: record.revision.versionId,
      transition: {
        action: 'undo_publish',
        from: 'active',
        to: 'pending_confirmation',
        role: 'manager',
      },
    },
    restoredVersion: {
      versionId: facts.previous.versionId,
      transition: {
        action: 'restore_after_undo',
        from: 'superseded',
        to: 'active',
        role: 'system',
        publicationId: facts.receipt.publicationId,
      },
    },
    effectiveVersionAfterUndo: restored,
    bindingsBefore: facts.bindingsBefore,
    receipt: {
      publicationId: facts.receipt.publicationId,
      restoredVersionId: facts.previous.versionId,
      withdrawnVersionId: record.revision.versionId,
      restoredDefaultForNewCohorts: facts.previous.versionId,
      preservedBindings: facts.bindingsBefore,
    },
    historicalResultsPolicy: 'preserve_original_version',
    recomputeHistoricalResults: false,
  });
  if (!validation.success) conflict('撤销窗口或发布版本已变化，请刷新后查看');
  const categorySwitch: SelectionCategorySwitch = {
    category: 'xe_selection',
    expectedVersionId: facts.current.versionId,
    expectedPublicationId: facts.receipt.publicationId,
    activate: restored,
    deactivateVersionId: facts.current.versionId,
    at: now,
  };
  return {
    record: {
      ...record,
      revision: selectionRevisionSchema.parse({
        ...fields(record.revision),
        state: 'pending_confirmation',
        revision: record.revision.revision + 1,
        ...record.submission,
      }),
    },
    receipt: validation.data.receipt,
    categorySwitch,
    transaction: validation.data,
  };
}
export function projectSelectionManagerRevision(
  record: SelectionRevisionRecord,
) {
  const {
    basis: _privateBasis,
    aiDraft: _privateAi,
    ...publicFields
  } = fields(record.revision);
  void _privateBasis;
  void _privateAi;
  return selectionManagerRevisionSchema.parse({
    ...publicFields,
    state: record.revision.state,
    basis: record.managerBasis,
  });
}
export function planSelectionCohortBinding(
  authority: SelectionAuthority,
  cohort: SelectionCohortBinding['cohort'],
  existing: SelectionCohortBinding | null,
  current: EffectiveRuleVersion,
): SelectionCohortBinding {
  // Cohort creation/binding is a server command; HR must own that cohort scope.
  const manager = activeGrants(authority.context).some(
    (grant) => grant.role === 'manager',
  );
  authorizeSelectionAction(authority, manager ? 'manager' : 'hr', cohort.id);
  if (existing && existing.cohort.id !== cohort.id)
    conflict('期次绑定不属于请求期次');
  requireCurrent(current, authority);
  const binding =
    existing ??
    selectionCohortBindingSchema.parse({
      cohort,
      standardVersionId: current.versionId,
      boundAt: instant(authority),
    });
  selectionCohortBindingChangeSchema.parse({ previous: existing, binding });
  return structuredClone(binding);
}
