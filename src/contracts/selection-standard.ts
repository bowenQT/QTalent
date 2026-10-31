import { z } from 'zod';
import {
  comparisonActorSchema,
  comparisonCohortSchema,
  comparisonManagerBasisSchema,
  selectionVersionIdSchema,
} from './judgment-comparison';
import {
  revisionEligibleAttributionSchema,
  standardIterationActionResultSchema,
  standardModelTraceSchema,
} from './standard-attribution';

const text = z.string().trim().min(1);
const revision = z.number().int().positive();
export const SELECTION_PUBLICATION_UNDO_WINDOW_MS = 5_000;
// Categories currently consumed by BOW-922/845/918. Provenance describes origin,
// never a category or a lifecycle. Other rule families can add categories later.
export const evaluationRuleCategorySchema = z.enum([
  'dimension_anchors',
  'xe_selection',
  'xe_weekly',
]);
export const evaluationRuleProvenanceSchema = z.enum([
  'published',
  'demo_import_snapshot',
]);
export const effectiveRuleVersionSchema = z
  .strictObject({
    category: evaluationRuleCategorySchema,
    versionId: text,
    provenance: evaluationRuleProvenanceSchema,
    effectiveFrom: z.iso.datetime(),
    effectiveUntil: z.iso.datetime().nullable(),
  })
  .refine(
    (version) =>
      version.effectiveUntil === null ||
      Date.parse(version.effectiveUntil) > Date.parse(version.effectiveFrom),
    '生效区间为左闭右开',
  )
  .refine((version) => {
    const patterns = {
      dimension_anchors: /^rubric-v[1-9]\d*$/,
      xe_selection: /^xe-select-v[1-9]\d*$/,
      xe_weekly: /^xe-weekly-v[1-9]\d*$/,
    };
    return patterns[version.category].test(version.versionId);
  }, '按类别读取，不能把来源或其他类别的版本当作生效版本');
export const effectiveRuleVersionReadInputSchema = z.strictObject({
  category: evaluationRuleCategorySchema,
  at: z.iso.datetime().optional(),
});
export const effectiveRuleVersionReadResultSchema = z.discriminatedUnion(
  'status',
  [
    z.strictObject({
      status: z.literal('success'),
      version: effectiveRuleVersionSchema,
    }),
    z.strictObject({
      status: z.enum(['forbidden', 'not_found', 'conflict']),
      message: text,
    }),
  ],
);

export const selectionCohortBindingSchema = z.strictObject({
  cohort: comparisonCohortSchema,
  standardVersionId: selectionVersionIdSchema,
  boundAt: z.iso.datetime(),
});
export const selectionCohortBindingChangeSchema = z
  .strictObject({
    previous: selectionCohortBindingSchema.nullable(),
    binding: selectionCohortBindingSchema,
  })
  .refine(
    ({ previous, binding }) =>
      previous === null ||
      (previous.cohort.id === binding.cohort.id &&
        previous.standardVersionId === binding.standardVersionId &&
        previous.boundAt === binding.boundAt),
    '期次一经绑定不因发布或撤销而切换版本',
  );
export const selectionCohortVersionReadInputSchema = z.strictObject({
  cohortId: text,
});
export const selectionCohortVersionReadResultSchema = z.discriminatedUnion(
  'status',
  [
    z.strictObject({
      status: z.literal('success'),
      binding: selectionCohortBindingSchema,
    }),
    z.strictObject({
      status: z.enum(['forbidden', 'not_found']),
      message: text,
    }),
  ],
);

export const selectionReviewPointSchema = z.strictObject({
  id: text,
  title: text,
  description: text,
});
export const selectionStandardContentSchema = z.strictObject({
  reviewPoints: z
    .array(selectionReviewPointSchema)
    .min(1)
    .refine(
      (points) =>
        new Set(points.map((point) => point.id)).size === points.length,
      '评审要点不能重复',
    ),
});
export const selectionReviewPointChangeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('add'), after: selectionReviewPointSchema }),
  z.strictObject({
    kind: z.literal('remove'),
    before: selectionReviewPointSchema,
  }),
  z
    .strictObject({
      kind: z.literal('edit'),
      before: selectionReviewPointSchema,
      after: selectionReviewPointSchema,
    })
    .refine(
      ({ before, after }) =>
        before.id === after.id &&
        (before.title !== after.title ||
          before.description !== after.description),
      '修改须保留要点标识且确有变化',
    ),
]);
export const selectionReviewPointChangesSchema = z
  .array(selectionReviewPointChangeSchema)
  .min(1)
  .refine((changes) => {
    const keys = changes.map((change) =>
      change.kind === 'add' ? change.after.id : change.before.id,
    );
    return new Set(keys).size === keys.length;
  }, '同一份修订里每项要点只记录一次变化');
export const selectionImpactPreviewSchema = z
  .strictObject({
    id: text,
    contentRevision: revision,
    generatedAt: z.iso.datetime(),
    nextCohort: comparisonCohortSchema,
    newStandardVersionId: selectionVersionIdSchema,
    existingResults: z.array(
      z.strictObject({
        cohortId: text,
        standardVersionId: selectionVersionIdSchema,
        count: z.number().int().nonnegative(),
      }),
    ),
    preservedBindings: z.array(selectionCohortBindingSchema),
    existingResultsPolicy: z.literal('preserve_original_version'),
    recomputeHistoricalResults: z.literal(false),
    nextComparisonGrouping: z.literal('selection_standard_version'),
  })
  .refine(
    (preview) =>
      !preview.preservedBindings.some(
        (binding) => binding.cohort.id === preview.nextCohort.id,
      ),
    '下一期必须是尚未绑定的稳定期次标识，已绑定期次留在原版本',
  );

export const selectionAiDraftSchema = z.strictObject({
  origin: z.literal('ai_draft'),
  basis: revisionEligibleAttributionSchema,
  model: standardModelTraceSchema,
  changes: selectionReviewPointChangesSchema,
  generatedAt: z.iso.datetime(),
});
export const selectionHumanVersionSchema = z.strictObject({
  origin: z.literal('hr_edited'),
  changes: selectionReviewPointChangesSchema,
  editedBy: comparisonActorSchema,
  editedAt: z.iso.datetime(),
});
const revisionFields = {
  id: text,
  category: z.literal('xe_selection'),
  versionId: selectionVersionIdSchema,
  baseVersionId: selectionVersionIdSchema,
  revision,
  contentRevision: revision,
  reason: text,
  effect: z.literal('next_selection_cohort'),
  humanVersion: selectionHumanVersionSchema,
  impactPreview: selectionImpactPreviewSchema,
};
const returnRecordSchema = z.strictObject({
  reason: text,
  returnedBy: comparisonActorSchema,
  returnedAt: z.iso.datetime(),
});
const publicationFields = {
  publicationId: text,
  publishedBy: comparisonActorSchema,
  publishedAt: z.iso.datetime(),
  undoUntil: z.iso.datetime(),
};
const privateFields = {
  ...revisionFields,
  basis: revisionEligibleAttributionSchema,
  aiDraft: selectionAiDraftSchema.nullable(),
};
// HR sees case-level basis and the AI proposal separately from the human edit.
export const selectionRevisionSchema = z
  .discriminatedUnion('state', [
    z.strictObject({
      ...privateFields,
      state: z.literal('draft'),
      lastReturn: returnRecordSchema.nullable(),
    }),
    z.strictObject({
      ...privateFields,
      state: z.literal('pending_confirmation'),
      submittedBy: comparisonActorSchema,
      submittedAt: z.iso.datetime(),
    }),
    z.strictObject({
      ...privateFields,
      state: z.literal('active'),
      ...publicationFields,
    }),
    z.strictObject({
      ...privateFields,
      state: z.literal('superseded'),
      ...publicationFields,
      supersededByVersionId: selectionVersionIdSchema,
      supersededAt: z.iso.datetime(),
    }),
  ])
  .superRefine((draft, ctx) => {
    if (
      draft.baseVersionId === draft.versionId ||
      draft.impactPreview.contentRevision !== draft.contentRevision ||
      draft.impactPreview.newStandardVersionId !== draft.versionId
    ) {
      ctx.addIssue({
        code: 'custom',
        message: '预览须与本次草稿修订及新版本一致',
      });
    }
    if (
      draft.aiDraft &&
      (draft.aiDraft.basis.id !== draft.basis.id ||
        draft.aiDraft.basis.revision !== draft.basis.revision)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['aiDraft'],
        message: 'AI 起草须追溯到同一份已确认归因',
      });
    }
    if (
      'publishedAt' in draft &&
      Date.parse(draft.undoUntil) - Date.parse(draft.publishedAt) !==
        SELECTION_PUBLICATION_UNDO_WINDOW_MS
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['undoUntil'],
        message: '发布撤销窗口固定为五秒',
      });
    }
  });
// No HR private attribution, AI case citations, names of evaluated people or
// evaluator distributions can be serialized into the manager confirmation view.
export const selectionManagerRevisionSchema = z
  .strictObject({
    ...revisionFields,
    state: z.enum(['draft', 'pending_confirmation', 'active', 'superseded']),
    basis: z.array(comparisonManagerBasisSchema).min(1),
  })
  .refine(
    (draft) =>
      draft.baseVersionId !== draft.versionId &&
      draft.impactPreview.contentRevision === draft.contentRevision &&
      draft.impactPreview.newStandardVersionId === draft.versionId,
    '确认页须显示保存的同一份预览',
  );

export const selectionStandardReadInputSchema = z.strictObject({
  versionId: selectionVersionIdSchema.optional(),
});
export const selectionStandardReadResultSchema = z.discriminatedUnion(
  'status',
  [
    z.strictObject({
      status: z.literal('success'),
      version: effectiveRuleVersionSchema.refine(
        (version) => version.category === 'xe_selection',
      ),
      content: selectionStandardContentSchema,
    }),
    z.strictObject({
      status: z.enum(['forbidden', 'not_found']),
      message: text,
    }),
  ],
);
export const selectionRevisionReadInputSchema = z.strictObject({
  draftId: text,
});
export const selectionRevisionReadResultSchema = z.discriminatedUnion(
  'status',
  [
    z.strictObject({
      status: z.literal('success'),
      view: z.discriminatedUnion('audience', [
        z.strictObject({
          audience: z.literal('hr'),
          revision: selectionRevisionSchema,
        }),
        z.strictObject({
          audience: z.literal('manager'),
          revision: selectionManagerRevisionSchema,
        }),
      ]),
    }),
    z.strictObject({
      status: z.enum(['forbidden', 'not_found']),
      message: text,
    }),
  ],
);

const commandFields = {
  operationId: text,
  draftId: text,
  expectedRevision: revision,
};
export const createSelectionRevisionInputSchema = z.strictObject({
  operationId: text,
  baseVersionId: selectionVersionIdSchema,
  attributionId: text,
  expectedAttributionRevision: revision,
  reason: text,
});
export const saveSelectionRevisionInputSchema = z.strictObject({
  ...commandFields,
  reason: text,
  changes: selectionReviewPointChangesSchema,
});
export const submitSelectionRevisionInputSchema = z.strictObject({
  ...commandFields,
  expectedPreviewId: text,
});
export const withdrawSelectionRevisionInputSchema =
  z.strictObject(commandFields);
export const returnSelectionRevisionInputSchema = z.strictObject({
  ...commandFields,
  reason: text,
});
export const publishSelectionRevisionInputSchema = z.strictObject({
  ...commandFields,
  expectedPreviewId: text,
});
export const undoSelectionPublicationInputSchema = z.strictObject({
  operationId: text,
  publicationId: text,
  expectedRevision: revision,
});
export const selectionPublicationReceiptSchema = z
  .strictObject({
    ...publicationFields,
    versionId: selectionVersionIdSchema,
    previousVersionId: selectionVersionIdSchema,
    revision,
    previewId: text,
    nextCohort: comparisonCohortSchema,
  })
  .refine(
    (receipt) =>
      receipt.versionId !== receipt.previousVersionId &&
      Date.parse(receipt.undoUntil) - Date.parse(receipt.publishedAt) ===
        SELECTION_PUBLICATION_UNDO_WINDOW_MS,
    '发布须产生新版本且提供五秒撤销窗口',
  );
// Server-only validation evidence; never accept requestedAt or current* from a
// client. The implementation must check these again inside its transaction.
export const selectionPublicationUndoBoundarySchema = z
  .strictObject({
    receipt: selectionPublicationReceiptSchema,
    command: undoSelectionPublicationInputSchema,
    requestedAt: z.iso.datetime(),
    currentPublicationId: text,
    currentRevision: revision,
  })
  .refine(
    ({
      receipt,
      command,
      requestedAt,
      currentPublicationId,
      currentRevision,
    }) =>
      command.publicationId === receipt.publicationId &&
      currentPublicationId === receipt.publicationId &&
      command.expectedRevision === currentRevision &&
      currentRevision === receipt.revision &&
      Date.parse(receipt.publishedAt) <= Date.parse(requestedAt) &&
      Date.parse(requestedAt) < Date.parse(receipt.undoUntil),
    '仅当前发布可在左闭右开的五秒内撤销，旧撤销不覆盖之后的操作',
  );
export const selectionPublicationUndoReceiptSchema = z
  .strictObject({
    publicationId: text,
    restoredVersionId: selectionVersionIdSchema,
    withdrawnVersionId: selectionVersionIdSchema,
    restoredDefaultForNewCohorts: selectionVersionIdSchema,
    preservedBindings: z.array(selectionCohortBindingSchema),
  })
  .refine(
    (receipt) =>
      receipt.restoredVersionId !== receipt.withdrawnVersionId &&
      receipt.restoredDefaultForNewCohorts === receipt.restoredVersionId,
    '撤销只恢复后续新建期次的默认版本，不改已绑定期次',
  );

export const selectionLifecycleTransitionSchema = z.discriminatedUnion(
  'action',
  [
    z.strictObject({
      action: z.literal('create'),
      from: z.null(),
      to: z.literal('draft'),
      role: z.literal('hr'),
    }),
    z.strictObject({
      action: z.literal('edit'),
      from: z.literal('draft'),
      to: z.literal('draft'),
      role: z.literal('hr'),
    }),
    z.strictObject({
      action: z.literal('submit'),
      from: z.literal('draft'),
      to: z.literal('pending_confirmation'),
      role: z.literal('hr'),
    }),
    z.strictObject({
      action: z.literal('withdraw'),
      from: z.literal('pending_confirmation'),
      to: z.literal('draft'),
      role: z.literal('hr'),
    }),
    z.strictObject({
      action: z.literal('return'),
      from: z.literal('pending_confirmation'),
      to: z.literal('draft'),
      role: z.literal('manager'),
      reason: text,
    }),
    z.strictObject({
      action: z.literal('publish'),
      from: z.literal('pending_confirmation'),
      to: z.literal('active'),
      role: z.literal('manager'),
    }),
    z.strictObject({
      action: z.literal('supersede'),
      from: z.literal('active'),
      to: z.literal('superseded'),
      role: z.literal('system'),
    }),
    z.strictObject({
      action: z.literal('undo_publish'),
      from: z.literal('active'),
      to: z.literal('pending_confirmation'),
      role: z.literal('manager'),
    }),
  ],
);
export const createSelectionRevisionResultSchema =
  standardIterationActionResultSchema(
    createSelectionRevisionInputSchema,
    selectionRevisionSchema,
  );
export const saveSelectionRevisionResultSchema =
  standardIterationActionResultSchema(
    saveSelectionRevisionInputSchema,
    selectionRevisionSchema,
  );
export const submitSelectionRevisionResultSchema =
  standardIterationActionResultSchema(
    submitSelectionRevisionInputSchema,
    selectionRevisionSchema,
  );
export const withdrawSelectionRevisionResultSchema =
  standardIterationActionResultSchema(
    withdrawSelectionRevisionInputSchema,
    selectionRevisionSchema,
  );
export const returnSelectionRevisionResultSchema =
  standardIterationActionResultSchema(
    returnSelectionRevisionInputSchema,
    selectionManagerRevisionSchema,
  );
export const publishSelectionRevisionResultSchema =
  standardIterationActionResultSchema(
    publishSelectionRevisionInputSchema,
    selectionPublicationReceiptSchema,
  );
export const undoSelectionPublicationResultSchema =
  standardIterationActionResultSchema(
    undoSelectionPublicationInputSchema,
    selectionPublicationUndoReceiptSchema,
  );
export type EvaluationRuleCategory = z.infer<
  typeof evaluationRuleCategorySchema
>;
export type EffectiveRuleVersion = z.infer<typeof effectiveRuleVersionSchema>;
export type EffectiveRuleVersionReadInput = z.infer<
  typeof effectiveRuleVersionReadInputSchema
>;
export type SelectionCohortBinding = z.infer<
  typeof selectionCohortBindingSchema
>;
export type SelectionReviewPointChange = z.infer<
  typeof selectionReviewPointChangeSchema
>;
export type SelectionImpactPreview = z.infer<
  typeof selectionImpactPreviewSchema
>;
export type SelectionRevision = z.infer<typeof selectionRevisionSchema>;
export type SelectionManagerRevision = z.infer<
  typeof selectionManagerRevisionSchema
>;
export type SelectionPublicationReceipt = z.infer<
  typeof selectionPublicationReceiptSchema
>;
export type CreateSelectionRevisionInput = z.infer<
  typeof createSelectionRevisionInputSchema
>;
export type SaveSelectionRevisionInput = z.infer<
  typeof saveSelectionRevisionInputSchema
>;
export type PublishSelectionRevisionInput = z.infer<
  typeof publishSelectionRevisionInputSchema
>;
export type UndoSelectionPublicationInput = z.infer<
  typeof undoSelectionPublicationInputSchema
>;
