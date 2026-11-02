import {
  confirmStandardAttributionResultSchema,
  generateStandardHypothesesResultSchema,
  type ConfirmedStandardAttribution,
} from '@/contracts/standard-attribution';
import {
  SELECTION_PUBLICATION_UNDO_WINDOW_MS,
  createSelectionRevisionResultSchema,
  publishSelectionRevisionResultSchema,
  returnSelectionRevisionResultSchema,
  saveSelectionRevisionResultSchema,
  selectionRevisionReadResultSchema,
  submitSelectionRevisionResultSchema,
  undoSelectionPublicationResultSchema,
  withdrawSelectionRevisionResultSchema,
  type SelectionManagerRevision,
  type SelectionPublicationReceipt,
  type SelectionRevision,
} from '@/contracts/selection-standard';
import type {
  AttributionPorts,
  HrRevisionPorts,
  ManagerRevisionPorts,
} from '@/features/standard-iteration/ports';
import {
  nextCohort,
  sampleAiChanges,
  sampleAttribution,
  sampleHr,
  sampleHypotheses,
  sampleManager,
  sampleManagerPage,
  samplePreview,
  sampleStandard,
} from './samples';

/*
 * A scripted stand-in for BOW-918/921 in the development sample: the same contract
 * inputs and results, one revision of xe-select. State lives in sessionStorage so a
 * walk can switch role by URL. Every result is parsed by its contract schema.
 */
export type SampleSeed = 'fresh' | 'pending' | 'returned';
export type SampleAi = 'ok' | 'fail' | 'empty';
type StoreState = {
  attributions: ConfirmedStandardAttribution[];
  revision: SelectionRevision | null;
  publication: SelectionPublicationReceipt | null;
  aiCalls: number;
};

const KEY = 'bow-920-sample';
const draftId = 'rev-xe-select-v2';
const at = (day: string) => `2026-${day}T02:00:00Z`;
const now = () => new Date().toISOString();

function seeded(seed: SampleSeed): StoreState {
  const state: StoreState = {
    attributions: [sampleAttribution],
    revision: null,
    publication: null,
    aiCalls: 0,
  };
  if (seed === 'fresh') return state;
  const humanVersion = {
    origin: 'hr_edited' as const,
    changes: sampleAiChanges,
    editedBy: sampleHr,
    editedAt: at('09-04'),
  };
  const base = {
    id: draftId,
    category: 'xe_selection' as const,
    versionId: 'xe-select-v2',
    baseVersionId: 'xe-select-v1',
    contentRevision: 2,
    reason: '优先录取一档只看作品成品，组队和个人分不开',
    effect: 'next_selection_cohort' as const,
    basis: sampleAttribution,
    aiDraft: {
      origin: 'ai_draft' as const,
      basis: sampleAttribution,
      model: sampleHypotheses[0].model,
      changes: sampleAiChanges,
      generatedAt: at('09-04'),
    },
    humanVersion,
    impactPreview: samplePreview(2, at('09-04')),
  };
  state.revision =
    seed === 'pending'
      ? {
          ...base,
          revision: 3,
          state: 'pending_confirmation',
          submittedBy: sampleHr,
          submittedAt: at('09-04'),
        }
      : {
          ...base,
          revision: 4,
          state: 'draft',
          lastReturn: {
            reason: '刚过线一档也写一句要看到什么',
            returnedBy: sampleManager,
            returnedAt: at('09-04'),
          },
        };
  return state;
}

function load(): StoreState {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as StoreState;
  } catch {
    // Storage blocked: the walk restarts from the seed.
  }
  return seeded('fresh');
}
function persist(state: StoreState) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage blocked: the walk lives for this page only.
  }
}

const conflict = <I>(input: I) => ({
  status: 'conflict' as const,
  message: '状态已更新',
  input,
});
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What the manager may see of a revision: no case-level basis, no AI proposal. */
export function managerView(
  revision: SelectionRevision,
): SelectionManagerRevision {
  const fields = {
    id: revision.id,
    category: revision.category,
    versionId: revision.versionId,
    baseVersionId: revision.baseVersionId,
    revision: revision.revision,
    contentRevision: revision.contentRevision,
    reason: revision.reason,
    effect: revision.effect,
    impactPreview: revision.impactPreview,
    basis: sampleManagerPage(revision.basis.categories).batches,
  };
  if (revision.state === 'draft')
    return { ...fields, state: 'draft', humanVersion: revision.humanVersion };
  return {
    ...fields,
    state: revision.state,
    humanVersion: revision.humanVersion,
  };
}

export function createSampleStore(seed: SampleSeed | null, ai: SampleAi) {
  let state = seed ? seeded(seed) : load();
  persist(state);
  const commit = (next: StoreState) => {
    state = next;
    persist(state);
  };
  const current = () => state.revision;

  const attribution: AttributionPorts = {
    async generate() {
      await wait(600);
      commit({ ...state, aiCalls: state.aiCalls + 1 });
      if (ai === 'fail' && state.aiCalls === 1)
        return generateStandardHypothesesResultSchema.parse({
          status: 'model_failed',
          message: 'AI 整理失败',
        });
      return generateStandardHypothesesResultSchema.parse({
        status: 'success',
        replayed: false,
        result: ai === 'empty' ? [] : sampleHypotheses,
      });
    },
    async confirm(input) {
      const attributionId = `attr-${input.hypothesisId ?? input.operationId}`;
      const existing = state.attributions.find((a) => a.id === attributionId);
      if (existing)
        return confirmStandardAttributionResultSchema.parse({
          status: 'success',
          replayed: true,
          result: existing,
        });
      const hypothesis = sampleHypotheses.find(
        (h) => h.id === input.hypothesisId,
      );
      const result: ConfirmedStandardAttribution = {
        id: attributionId,
        revision: 1,
        batchId: input.batchId,
        origin: 'human_conclusion',
        hypothesisId: input.hypothesisId,
        categories: input.categories,
        rationale: input.rationale,
        citations: (hypothesis?.citations ?? []).filter((c) =>
          input.caseIds.includes(c.caseId),
        ),
        confirmedBy: sampleHr,
        confirmedAt: now(),
      };
      commit({ ...state, attributions: [...state.attributions, result] });
      return confirmStandardAttributionResultSchema.parse({
        status: 'success',
        replayed: false,
        result,
      });
    },
    async createRevision(input) {
      const basis = state.attributions.find(
        (a) => a.id === input.attributionId,
      );
      const open = current();
      if (open && ['draft', 'pending_confirmation'].includes(open.state))
        return createSelectionRevisionResultSchema.parse(conflict(input));
      if (!basis || !basis.categories.includes('evaluation_standard'))
        return createSelectionRevisionResultSchema.parse({
          status: 'forbidden',
          message: '只有含评价标准的归因可以起草',
        });
      const created: SelectionRevision = {
        id: draftId,
        category: 'xe_selection',
        versionId: 'xe-select-v2',
        baseVersionId: input.baseVersionId,
        revision: 1,
        contentRevision: 1,
        reason: input.reason,
        effect: 'next_selection_cohort',
        basis,
        aiDraft: {
          origin: 'ai_draft',
          basis,
          model: sampleHypotheses[0].model,
          changes: sampleAiChanges,
          generatedAt: now(),
        },
        humanVersion: null,
        impactPreview: samplePreview(1, now()),
        state: 'draft',
        lastReturn: null,
      };
      commit({ ...state, revision: created });
      return createSelectionRevisionResultSchema.parse({
        status: 'success',
        replayed: false,
        result: created,
      });
    },
  };

  const hr: HrRevisionPorts = {
    async save(input) {
      await wait(300);
      const open = current();
      if (
        !open ||
        open.state !== 'draft' ||
        open.revision !== input.expectedRevision
      )
        return saveSelectionRevisionResultSchema.parse(conflict(input));
      const contentRevision = open.contentRevision + 1;
      const saved: SelectionRevision = {
        ...open,
        revision: open.revision + 1,
        contentRevision,
        reason: input.reason,
        humanVersion: {
          origin: 'hr_edited',
          changes: input.changes,
          editedBy: sampleHr,
          editedAt: now(),
        },
        impactPreview: samplePreview(contentRevision, now()),
      };
      commit({ ...state, revision: saved });
      return saveSelectionRevisionResultSchema.parse({
        status: 'success',
        replayed: false,
        result: saved,
      });
    },
    async submit(input) {
      const open = current();
      if (
        !open ||
        open.state !== 'draft' ||
        !open.humanVersion ||
        open.revision !== input.expectedRevision ||
        open.impactPreview.id !== input.expectedPreviewId
      )
        return submitSelectionRevisionResultSchema.parse(conflict(input));
      const { lastReturn: _, ...rest } = open;
      void _;
      const submitted: SelectionRevision = {
        ...rest,
        humanVersion: open.humanVersion,
        revision: open.revision + 1,
        state: 'pending_confirmation',
        submittedBy: sampleHr,
        submittedAt: now(),
      };
      commit({ ...state, revision: submitted });
      return submitSelectionRevisionResultSchema.parse({
        status: 'success',
        replayed: false,
        result: submitted,
      });
    },
    async withdraw(input) {
      const open = current();
      if (
        !open ||
        open.state !== 'pending_confirmation' ||
        open.revision !== input.expectedRevision
      )
        return withdrawSelectionRevisionResultSchema.parse(conflict(input));
      const { submittedBy: _by, submittedAt: _at, ...rest } = open;
      void _by;
      void _at;
      const back: SelectionRevision = {
        ...rest,
        revision: open.revision + 1,
        state: 'draft',
        lastReturn: null,
      };
      commit({ ...state, revision: back });
      return withdrawSelectionRevisionResultSchema.parse({
        status: 'success',
        replayed: false,
        result: back,
      });
    },
  };

  const manager: ManagerRevisionPorts = {
    async read(input) {
      const open = current();
      if (!open || open.id !== input.draftId)
        return selectionRevisionReadResultSchema.parse({
          status: 'not_found',
          message: '没有这份修订',
        });
      return selectionRevisionReadResultSchema.parse({
        status: 'success',
        view: { audience: 'manager', revision: managerView(open) },
      });
    },
    async publish(input) {
      await wait(300);
      const open = current();
      if (
        !open ||
        open.state !== 'pending_confirmation' ||
        open.revision !== input.expectedRevision ||
        open.impactPreview.id !== input.expectedPreviewId
      )
        return publishSelectionRevisionResultSchema.parse(conflict(input));
      const publishedAt = new Date();
      const receipt: SelectionPublicationReceipt = {
        publicationId: `pub-${open.revision + 1}`,
        publishedBy: sampleManager,
        publishedAt: publishedAt.toISOString(),
        undoUntil: new Date(
          publishedAt.getTime() + SELECTION_PUBLICATION_UNDO_WINDOW_MS,
        ).toISOString(),
        versionId: open.versionId,
        previousVersionId: open.baseVersionId,
        revision: open.revision + 1,
        previewId: open.impactPreview.id,
        nextCohort,
      };
      const { submittedBy: _by, submittedAt: _at, ...rest } = open;
      void _by;
      void _at;
      commit({
        ...state,
        publication: receipt,
        revision: {
          ...rest,
          revision: receipt.revision,
          state: 'active',
          publicationId: receipt.publicationId,
          publishedBy: receipt.publishedBy,
          publishedAt: receipt.publishedAt,
          undoUntil: receipt.undoUntil,
        },
      });
      return publishSelectionRevisionResultSchema.parse({
        status: 'success',
        replayed: false,
        result: receipt,
      });
    },
    async undo(input) {
      const open = current();
      const receipt = state.publication;
      if (
        !open ||
        open.state !== 'active' ||
        !receipt ||
        receipt.publicationId !== input.publicationId ||
        open.revision !== input.expectedRevision ||
        Date.now() >= Date.parse(receipt.undoUntil)
      )
        return undoSelectionPublicationResultSchema.parse(conflict(input));
      const {
        publicationId: _id,
        publishedBy: _by,
        publishedAt: _at,
        undoUntil: _until,
        ...rest
      } = open;
      void [_id, _by, _at, _until];
      commit({
        ...state,
        publication: null,
        revision: {
          ...rest,
          revision: open.revision + 1,
          state: 'pending_confirmation',
          submittedBy: sampleHr,
          submittedAt: now(),
        },
      });
      return undoSelectionPublicationResultSchema.parse({
        status: 'success',
        replayed: false,
        result: {
          publicationId: receipt.publicationId,
          restoredVersionId: receipt.previousVersionId,
          withdrawnVersionId: receipt.versionId,
          restoredDefaultForNewCohorts: receipt.previousVersionId,
          preservedBindings: samplePreview(1, now()).preservedBindings,
        },
      });
    },
    async return(input) {
      const open = current();
      if (
        !open ||
        open.state !== 'pending_confirmation' ||
        open.revision !== input.expectedRevision
      )
        return returnSelectionRevisionResultSchema.parse(conflict(input));
      const { submittedBy: _by, submittedAt: _at, ...rest } = open;
      void [_by, _at];
      const returned: SelectionRevision = {
        ...rest,
        revision: open.revision + 1,
        state: 'draft',
        lastReturn: {
          reason: input.reason,
          returnedBy: sampleManager,
          returnedAt: now(),
        },
      };
      commit({ ...state, revision: returned });
      return returnSelectionRevisionResultSchema.parse({
        status: 'success',
        replayed: false,
        result: managerView(returned),
      });
    },
  };

  return {
    attribution,
    hr,
    manager,
    snapshot: () => state,
    standard: sampleStandard,
  };
}
