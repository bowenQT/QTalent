import {
  RECORD_UNDO_WINDOW_MS,
  recordJobSchema,
  type RecordArrangeResult,
  type RecordDraft,
  type RecordInput,
} from '@/contracts/record';
import type {
  AnchorMap,
  LoadAnchors,
  PersonOption,
  RecordActions,
  RecordJob,
} from '@/features/record/types';
import type { ReadRecordJob } from '@/features/record/use-record-job';
import {
  sampleAnchors,
  sampleDimensions,
  sampleDraft,
  type SampleScene,
} from './samples';

/** One arranging step; the prototype's trail advances at about this pace. */
export const STEP_MS = 700;
const STAGES = 3;

type Task = {
  input: RecordInput;
  personId: string | null;
  draftId: string;
  attempt: number;
  /** Revision before this attempt started; every stage adds one. */
  base: number;
  startedAt: number;
};

/**
 * Stands in for the server behind the record page: arranging jobs that advance with
 * time, save receipts with the five-second undo window, and the failure paths each
 * scene asks for. Every answer follows the BOW-844 / BOW-897 record contract; the job
 * snapshots are checked against `recordJobSchema` before they leave.
 */
type Saved = { undoUntil: number; input: RecordInput };
type Stored = {
  tasks: [string, Task][];
  drafts: [string, RecordDraft][];
  saves: [string, Saved][];
  serial: number;
  offline: boolean;
  conflict: boolean;
  failing: boolean;
};

export function sampleServer({
  scene,
  accountId,
  people,
  storage,
  now = () => Date.now(),
}: {
  scene: SampleScene;
  accountId: string;
  people: readonly PersonOption[];
  /** Keeps jobs and drafts across reloads, as the server would (`?job=` resumes). */
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  now?: () => number;
}): {
  actions: RecordActions;
  readJob: ReadRecordJob;
  loadAnchors: LoadAnchors;
} {
  const key = `qtalent-dev-record:${accountId}:${scene}`;
  const loaded = load();
  const tasks = new Map<string, Task>(loaded?.tasks);
  const drafts = new Map<string, RecordDraft>(loaded?.drafts);
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
      drafts: [...drafts],
      saves: [...saves],
      serial,
      offline,
      conflict,
      failing,
    };
    storage?.setItem(key, JSON.stringify(value));
  }
  const iso = (ms: number) => new Date(ms).toISOString();

  /** The person the sentence names, when the input did not choose one. */
  function resolve(input: RecordInput): string | null {
    if (input.personId) return input.personId;
    if (scene === 'selection') return null;
    return people.find((p) => input.text.includes(p.name))?.id ?? null;
  }

  function result(task: Task): RecordArrangeResult {
    if (!task.personId)
      return {
        state: 'selection_required',
        draftId: task.draftId,
        inputVersion: `${task.draftId}:1`,
        originalInput: task.input,
        people: [
          {
            state: 'needs_selection',
            candidates: people
              .slice(0, 3)
              .map((p) => ({ id: p.id, label: `${p.name} · ${p.orgShort}` })),
            reason: '原话里没有写名字',
          },
        ],
        project: { state: 'none' },
      };
    const draft = sampleDraft(task.input, task.personId, task.draftId);
    drafts.set(draft.draftId, draft);
    return draft;
  }

  function snapshot(jobId: string): RecordJob {
    const task = tasks.get(jobId);
    if (!task) throw new Error('任务不存在');
    const stage = Math.min(
      STAGES,
      Math.floor((now() - task.startedAt) / STEP_MS),
    );
    const failed = failing && task.attempt === 1 && stage >= 2;
    const done = !failed && stage === STAGES;
    return recordJobSchema.parse({
      schemaVersion: 1,
      jobId,
      kind: 'record_organize',
      status: failed
        ? 'failed'
        : done
          ? 'awaiting_manual'
          : stage === 0
            ? 'queued'
            : 'running',
      attempt: task.attempt,
      revision: task.base + (failed ? 3 : stage + 1),
      updatedAt: iso(task.startedAt + (failed ? 2 : stage) * STEP_MS),
      progress:
        stage === 0 || done || failed
          ? null
          : { completed: stage, total: STAGES },
      result: done ? result(task) : null,
      error: failed
        ? { code: 'processing_failed', message: '整理中断，原话已保留' }
        : null,
      canRetry: failed,
      canCancel: false,
      cancelRequestedAt: null,
    }) as RecordJob;
  }

  function begin(input: RecordInput, personId: string | null) {
    const jobId = id('sample-job');
    tasks.set(jobId, {
      input,
      personId,
      draftId: id('sample-draft'),
      attempt: 1,
      base: 0,
      startedAt: now(),
    });
    return snapshot(jobId);
  }

  const actions: RecordActions = {
    async start(input) {
      if (offline) {
        offline = false;
        throw new TypeError('Failed to fetch');
      }
      return {
        status: 'success',
        replayed: false,
        result: begin(input, resolve(input)),
      };
    },
    async selectPeople(input) {
      const task = [...tasks.values()].find((t) => t.draftId === input.draftId);
      if (!task)
        return { status: 'not_found', message: '这条记录已失效，请重新整理' };
      return {
        status: 'success',
        replayed: false,
        result: begin(
          { ...task.input, personId: input.personIds[0] },
          input.personIds[0],
        ),
      };
    },
    async openDraft({ draftId }) {
      const draft = drafts.get(draftId);
      return draft
        ? { status: 'success', replayed: false, result: draft }
        : { status: 'not_found', message: '这条记录已失效，请重新整理' };
    },
    async save(input) {
      const draft = drafts.get(input.draftId);
      if (!draft)
        return { status: 'not_found', message: '这条记录已失效，请重新整理' };
      if (conflict) {
        // Someone else changed the draft: the stored copy moves on, the edits come back.
        conflict = false;
        drafts.set(draft.draftId, { ...draft, revision: draft.revision + 1 });
        return {
          status: 'conflict',
          message: '这条记录刚被更新，你的修改已保留',
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
      saves.set(saveId, {
        undoUntil: savedAt + RECORD_UNDO_WINDOW_MS,
        input: draft.originalInput,
      });
      return {
        status: 'success',
        replayed: false,
        result: {
          saveId,
          events: input.personIds.map((personId) => ({
            personId,
            eventId: id('sample-event'),
          })),
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
      return {
        status: 'success',
        replayed: false,
        result: {
          saveId,
          withdrawnEvents: [],
          withdrawnConfirmationIds: [],
          withdrawnReviewItemIds: [],
          originalInput: saved.input,
        },
      };
    },
    async retryJob(command) {
      const task = tasks.get(command.jobId);
      if (!task || command.action !== 'retry') return { status: 'not_found' };
      const current = snapshot(command.jobId);
      if (!current.canRetry) return { status: 'conflict' };
      failing = false;
      tasks.set(command.jobId, {
        ...task,
        attempt: task.attempt + 1,
        base: current.revision,
        startedAt: now(),
      });
      return { status: 'success', snapshot: snapshot(command.jobId) };
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
  const readJob: ReadRecordJob = async (jobId) => {
    const value = snapshot(jobId);
    persist();
    return value;
  };
  const loadAnchors: LoadAnchors = async ({ personIds }) => {
    const map: AnchorMap = {};
    for (const personId of personIds)
      map[personId] = Object.fromEntries(
        sampleDimensions.map((d) => [d.id, sampleAnchors(d.id)]),
      );
    return map;
  };
  return { actions, readJob, loadAnchors };
}
