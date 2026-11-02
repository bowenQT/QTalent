import {
  materialBatchReceiptSchema,
  type MaterialBatchInput,
  type MaterialBatchReceipt,
} from '@/contracts/materials';
import { materialReviewItemSchema } from '@/contracts/material-review';
import {
  RECORD_UNDO_WINDOW_MS,
  type RecordBatchDraft,
} from '@/contracts/record';
import type {
  AnchorMap,
  LoadAnchors,
  RecordActions,
} from '@/features/record/types';
import {
  sampleAnchors,
  sampleDimensions,
  sampleDraft,
  textReference,
  type SampleScene,
} from './samples';

/** One arranging step; the prototype's trail advances at about this pace. */
export const STEP_MS = 700;
const STAGES = 3;
export const SAMPLE_NODE = 'sample-node-xe6';

type Task = {
  input: MaterialBatchInput;
  attempt: number;
  startedAt: number;
  /** Drafts still awaiting confirmation, in batch order. */
  drafts: RecordBatchDraft[];
  confirmed: { draftId: string; revision: number; eventId: string }[];
};

/**
 * Stands in for the server behind the record page: material batches (BOW-897 receipts)
 * that finish arranging with time, save receipts with the five-second undo window
 * (BOW-844 / 846), and the failure paths each scene asks for. Every receipt is checked
 * against `materialBatchReceiptSchema` before it leaves.
 */
type Saved = {
  undoUntil: number;
  batchId: string;
  draft: RecordBatchDraft;
};
type Stored = {
  tasks: [string, Task][];
  saves: [string, Saved][];
  serial: number;
  offline: boolean;
  conflict: boolean;
  failing: boolean;
};

export function sampleServer({
  scene,
  accountId,
  storage,
  now = () => Date.now(),
}: {
  scene: SampleScene;
  accountId: string;
  /** Keeps batches across reloads, as the server would (`?batch=` resumes). */
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  now?: () => number;
}): {
  actions: RecordActions;
  loadAnchors: LoadAnchors;
} {
  const key = `qtalent-dev-record:${accountId}:${scene}`;
  const loaded = load();
  const tasks = new Map<string, Task>(loaded?.tasks);
  const saves = new Map<string, Saved>(loaded?.saves);
  let serial = loaded?.serial ?? 0;
  let offline = loaded?.offline ?? scene === 'offline';
  let conflict = loaded?.conflict ?? scene === 'conflict';
  let failing = loaded?.failing ?? scene === 'fail';
  const id = (prefix: string) => `${prefix}-${++serial}`;

  function load(): Stored | null {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Stored;
    } catch {
      return null;
    }
  }
  function persist() {
    const value: Stored = {
      tasks: [...tasks],
      saves: [...saves],
      serial,
      offline,
      conflict,
      failing,
    };
    storage?.setItem(key, JSON.stringify(value));
  }
  const iso = (ms: number) => new Date(ms).toISOString();

  function arranged(batchId: string, input: MaterialBatchInput) {
    const [personId] = input.personIds;
    if (!personId || scene === 'review') return [];
    const base = {
      batchId,
      evaluationNodeId: input.evaluationNodeId,
      personId,
      text: input.text,
    };
    const first = sampleDraft({ ...base, draftId: id('sample-draft') });
    if (scene !== 'many') return [first];
    const second = sampleDraft({ ...base, draftId: id('sample-draft') });
    return [
      first,
      {
        ...second,
        sbi: {
          ...second.sbi,
          title: '下午组员接上任务后，分工比之前清楚',
        },
      },
    ];
  }

  function receipt(batchId: string): MaterialBatchReceipt {
    const task = tasks.get(batchId);
    if (!task) throw new Error('批次不存在');
    const stage = Math.min(
      STAGES,
      Math.floor((now() - task.startedAt) / STEP_MS),
    );
    const failed = failing && task.attempt === 1 && stage >= 2;
    const done = !failed && stage === STAGES;
    const text = textReference(batchId);
    // The review scene leaves a speaker to identify, as a recording would.
    const unknown =
      done && (task.input.personIds.length === 0 || scene === 'review');
    const items = unknown
      ? [
          materialReviewItemSchema.parse({
            itemId: `${batchId}-who`,
            batchId,
            evaluationNodeId: task.input.evaluationNodeId,
            materialId: text.fragmentId,
            originalVersionId: text.originalVersionId,
            revision: 1,
            state: 'pending',
            source: null,
            kind: 'unknown_person',
            observedName: null,
            candidates: [],
          }),
        ]
      : [];
    const drafts = done ? task.drafts : [];
    const revision = 1 + stage + task.confirmed.length * 2;
    return materialBatchReceiptSchema.parse({
      batchId,
      revision,
      evaluationNodeId: task.input.evaluationNodeId,
      personIds: task.input.personIds,
      projectId: task.input.projectId,
      hasHiddenContent: false,
      status: failed
        ? 'failed'
        : !done
          ? 'processing'
          : items.length
            ? 'needs_review'
            : drafts.length
              ? 'awaiting_confirmation'
              : 'completed',
      jobId: !failed && !done ? `${batchId}-job` : null,
      files: [],
      textMaterial: {
        materialId: text.fragmentId,
        originalVersionId: text.originalVersionId,
      },
      items,
      resolvedItems: [],
      draftSet: drafts.length
        ? { batchId, revision, drafts, duplicateCandidates: [] }
        : null,
      confirmedDrafts: task.confirmed.map((entry) => ({
        draftId: entry.draftId,
        revision: entry.revision,
        events: [
          { personId: task.input.personIds[0]!, eventId: entry.eventId },
        ],
      })),
      counts: {
        files: {
          total: 0,
          processing: 0,
          parsed: 0,
          needs_review: 0,
          unsupported: 0,
          failed: 0,
          original_only: 0,
          attachment_only: 0,
        },
        events: {
          total: drafts.length + task.confirmed.length,
          awaiting_confirmation: drafts.length,
          confirmed: task.confirmed.length,
        },
        reviewItems: items.length,
      },
      error: failed
        ? {
            code: 'processing_failed',
            message: '整理中断，原话已保留',
            retryable: true,
          }
        : null,
    });
  }

  function findDraft(draftId: string) {
    for (const [batchId, task] of tasks) {
      const draft = task.drafts.find((item) => item.draftId === draftId);
      if (draft) return { batchId, task, draft };
    }
    return null;
  }

  const actions: RecordActions = {
    // Like BOW-845 (#327): an empty selection has no owner-approved meaning.
    async resolveNode({ personIds }) {
      if (personIds.length === 0) return { status: 'none' };
      if (scene === 'node-multiple') return { status: 'multiple' };
      if (scene === 'node-none') return { status: 'none' };
      return { status: 'unique', evaluationNodeId: SAMPLE_NODE };
    },
    async submit(input) {
      if (offline) {
        offline = false;
        throw new TypeError('Failed to fetch');
      }
      const replay = [...tasks].find(
        ([, task]) => task.input.operationId === input.operationId,
      );
      if (replay)
        return {
          status: 'success',
          replayed: true,
          result: receipt(replay[0]),
        };
      // A later attempt after a failed one arranges cleanly.
      if ([...tasks.values()].length > 0) failing = false;
      const batchId = id('sample-batch');
      tasks.set(batchId, {
        input,
        attempt: tasks.size + 1,
        startedAt: now(),
        drafts: arranged(batchId, input),
        confirmed: [],
      });
      return { status: 'success', replayed: false, result: receipt(batchId) };
    },
    async readBatch({ batchId }) {
      return tasks.has(batchId)
        ? { status: 'success', replayed: false, result: receipt(batchId) }
        : { status: 'not_found', message: '批次不存在或当前不可见' };
    },
    async save(input) {
      const found = findDraft(input.draftId);
      if (!found)
        return { status: 'not_found', message: '这条记录已失效，请重新整理' };
      const { batchId, task, draft } = found;
      if (conflict) {
        // Someone else changed the draft: the stored copy moves on, the edits come back.
        conflict = false;
        task.drafts = task.drafts.map((item) =>
          item.draftId === draft.draftId
            ? { ...item, revision: item.revision + 1 }
            : item,
        );
        return {
          status: 'conflict',
          message: '另一处刚保存了新版本',
          input,
        };
      }
      if (input.expected_revision !== draft.revision)
        return {
          status: 'conflict',
          message: '这条记录刚被更新，你的修改已保留',
          input,
        };
      const savedAt = now();
      const saveId = id('sample-save');
      const eventId = id('sample-event');
      task.drafts = task.drafts.filter(
        (item) => item.draftId !== draft.draftId,
      );
      task.confirmed.push({
        draftId: draft.draftId,
        revision: draft.revision + 1,
        eventId,
      });
      saves.set(saveId, {
        undoUntil: savedAt + RECORD_UNDO_WINDOW_MS,
        batchId,
        draft,
      });
      return {
        status: 'success',
        replayed: false,
        result: {
          saveId,
          events: input.personIds.map((personId) => ({ personId, eventId })),
          revision: draft.revision + 1,
          confirmationIds: input.decisions
            .filter((d) => d.action !== 'unknown')
            .map(() => id('sample-confirmation')),
          reviewItemIds: [],
          savedBy: accountId,
          savedAt: iso(savedAt),
          undoUntil: iso(savedAt + RECORD_UNDO_WINDOW_MS),
        },
      };
    },
    async undo({ saveId }) {
      const saved = saves.get(saveId);
      if (!saved || now() >= saved.undoUntil)
        return {
          status: 'conflict',
          message: '已超过撤销时间，这条记录已保存',
          input: { operation_id: 'sample', saveId },
        };
      saves.delete(saveId);
      const task = tasks.get(saved.batchId);
      if (task) {
        task.confirmed = task.confirmed.filter(
          (entry) => entry.draftId !== saved.draft.draftId,
        );
        task.drafts = [...task.drafts, saved.draft];
      }
      return {
        status: 'success',
        replayed: false,
        result: {
          saveId,
          withdrawnEvents: [],
          withdrawnConfirmationIds: [],
          withdrawnReviewItemIds: [],
          // 照 846（#289）：撤销回执不带原输入，页面用自己保存时的原话回到待确认
          inputRestoration: 'unavailable',
          originalInput: null,
        },
      };
    },
    // Citations here quote the typed sentence only; nothing points at a stored source.
    loadSource: async () => ({
      status: 'not_found',
      message: '来源读取待接通',
    }),
  };

  for (const name of Object.keys(actions) as (keyof RecordActions)[]) {
    const call = actions[name] as (...args: never[]) => Promise<unknown>;
    (actions[name] as typeof call) = async (...args) => {
      try {
        return await call(...args);
      } finally {
        persist();
      }
    };
  }
  const loadAnchors: LoadAnchors = async ({ personIds }) => {
    const map: AnchorMap = {};
    for (const personId of personIds)
      map[personId] = Object.fromEntries(
        sampleDimensions.map((d) => [d.id, sampleAnchors(d.id)]),
      );
    return map;
  };
  return { actions, loadAnchors };
}
