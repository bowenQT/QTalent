import type { RecordDraft, RecordInput } from '@/contracts/record';
import {
  initEdit,
  isEdited,
  resolvedPersonIds,
  type EditState,
  type OperationId,
} from './build-save-input';
import { failureKindOf, type FailureKind, type SaveProblems } from './errors';
import type {
  RecordJob,
  RecordSaveReceipt,
  RecordSelection,
  ScoreKey,
} from './types';

/**
 * 记一件事的流程状态机（纯函数）。
 * write → submitting → organizing → selecting / review → saving → saved，
 * 失败、断网、冲突都是旁路：输入（原话、人员、附件、已改的 SBI 与分数）一律保留。
 */
export type Phase =
  | 'write'
  | 'submitting'
  | 'organizing'
  | 'selecting'
  | 'review'
  | 'saving'
  | 'saved';

export type Banner =
  | { kind: 'who' }
  | { kind: 'offline'; scope: 'start' | 'select' | 'save' }
  | { kind: 'conflict'; message: string }
  | { kind: 'forbidden'; message: string }
  | { kind: 'refused'; message: string }
  | { kind: 'saveProblems' };

/** 等待用户选人或选项目。候选与原因都来自服务端，页面不自己拼。 */
export type SelectionState = {
  draftId: string;
  inputVersion: string;
  people: RecordSelection[];
  project: RecordSelection;
};

export type Connection = 'connected' | 'error' | 'gone';

export type RecordState = {
  phase: Phase;
  text: string;
  personId: string | null;
  attachmentIds: string[];
  startOp: OperationId | null;
  jobId: string | null;
  job: RecordJob | null;
  failure: FailureKind | null;
  connection: Connection;
  selection: SelectionState | null;
  draft: RecordDraft | null;
  edit: EditState | null;
  saveOp: OperationId | null;
  receipt: RecordSaveReceipt | null;
  replayed: boolean;
  banner: Banner | null;
  problems: SaveProblems | null;
};

export type StartInit = {
  text?: string;
  personId?: string | null;
  attachmentIds?: string[];
  draft?: RecordDraft;
  jobId?: string;
};

type Interpreted =
  | { kind: 'organizing' }
  | { kind: 'draft'; draft: RecordDraft }
  | { kind: 'failed'; failure: FailureKind };

const blank: RecordState = {
  phase: 'write',
  text: '',
  personId: null,
  attachmentIds: [],
  startOp: null,
  jobId: null,
  job: null,
  failure: null,
  connection: 'connected',
  selection: null,
  draft: null,
  edit: null,
  saveOp: null,
  receipt: null,
  replayed: false,
  banner: null,
  problems: null,
};

export function initialState(init: StartInit = {}): RecordState {
  const base: RecordState = {
    ...blank,
    text: init.text ?? '',
    personId: init.personId ?? null,
    attachmentIds: init.attachmentIds ?? [],
  };
  if (init.draft) return withDraft(base, init.draft);
  if (init.jobId) return { ...base, phase: 'organizing', jobId: init.jobId };
  return base;
}

/** 草稿 → 状态。人和项目还有待选择时先选；识别不到人时回到输入。 */
function withDraft(state: RecordState, draft: RecordDraft): RecordState {
  const input = draft.originalInput;
  const base: RecordState = {
    ...state,
    text: input.text,
    personId: input.personId,
    attachmentIds: input.attachmentIds,
    failure: null,
    draft,
    edit: initEdit(draft),
    saveOp: null,
    receipt: null,
    replayed: false,
    problems: null,
    banner: null,
    selection: null,
  };
  const pending =
    draft.people.some((person) => person.state === 'needs_selection') ||
    draft.project.state === 'needs_selection';
  const identified = resolvedPersonIds(draft).length > 0;
  if (!pending && !identified) {
    return {
      ...base,
      phase: 'write',
      draft: null,
      edit: null,
      banner: { kind: 'who' },
    };
  }
  return {
    ...base,
    phase: 'review',
    selection: pending
      ? {
          draftId: draft.draftId,
          // 草稿内的待选择取草稿版本；契约尚未单独给出（缺口 G3）。
          inputVersion: String(draft.revision),
          people: draft.people,
          project: draft.project,
        }
      : null,
  };
}

/** 任务快照 → 页面该显示什么。失败、取消和拿不到结果都不渲染任何 SBI 或分数。 */
export function interpretSnapshot(job: RecordJob):
  | Interpreted
  | {
      kind: 'selection';
      selection: SelectionState;
      originalInput: RecordInput;
    } {
  if (job.status === 'failed' || job.status === 'cancelled')
    return { kind: 'failed', failure: failureKindOf(job) };
  if (job.status === 'awaiting_manual' || job.status === 'completed') {
    const result = job.result;
    if (!result) return { kind: 'failed', failure: 'processing_failed' };
    if ('state' in result) {
      return {
        kind: 'selection',
        selection: {
          draftId: result.draftId,
          inputVersion: result.inputVersion,
          people: result.people,
          project: result.project,
        },
        originalInput: result.originalInput,
      };
    }
    return { kind: 'draft', draft: result };
  }
  return { kind: 'organizing' };
}

export type Action =
  | { type: 'text'; text: string }
  | { type: 'person'; personId: string | null }
  | { type: 'submit_begin'; op: OperationId }
  | { type: 'submit_offline' }
  | { type: 'submit_refused'; message: string; forbidden?: boolean }
  | { type: 'job'; job: RecordJob }
  | { type: 'job_begin'; jobId: string; job: RecordJob }
  | { type: 'select_begin' }
  | { type: 'banner'; banner: Banner | null }
  | { type: 'connection'; connection: Connection }
  /** basis：发起读取时的修改；之后又改过就不再用读取结果覆盖。 */
  | { type: 'draft_loaded'; draft: RecordDraft; basis?: EditState | null }
  | { type: 'edit_sbi'; field: keyof EditState['sbi']; value: string }
  | { type: 'edit_score'; key: ScoreKey; value: number }
  | { type: 'edit_reason'; key: ScoreKey; reason: string }
  | { type: 'save_begin'; op: OperationId }
  | { type: 'save_saved'; receipt: RecordSaveReceipt; replayed: boolean }
  | { type: 'save_offline' }
  | { type: 'save_problems'; problems: SaveProblems }
  | { type: 'save_conflict'; message: string }
  | { type: 'save_forbidden'; message: string }
  | { type: 'save_blocked' }
  | { type: 'back_to_write' }
  | { type: 'undone'; originalInput: RecordInput };

function applyJob(state: RecordState, job: RecordJob): RecordState {
  const next = { ...state, job, jobId: job.jobId };
  const view = interpretSnapshot(job);
  if (view.kind === 'failed')
    return {
      ...next,
      phase: 'organizing',
      failure: view.failure,
      selection: null,
    };
  if (view.kind === 'selection')
    return {
      ...next,
      // 刷新后从任务恢复时页面里没有原话，取任务记下的原始输入
      text: view.originalInput.text,
      personId: view.originalInput.personId,
      attachmentIds: view.originalInput.attachmentIds,
      phase: 'selecting',
      failure: null,
      selection: view.selection,
    };
  if (view.kind === 'draft') return withDraft({ ...next, job }, view.draft);
  return { ...next, phase: 'organizing', failure: null, selection: null };
}

// 提交途中（含提交选人）不接收旧任务的快照，新任务由 job_begin 接管。
const listening: ReadonlySet<Phase> = new Set(['organizing', 'selecting']);

export function recordReducer(state: RecordState, action: Action): RecordState {
  switch (action.type) {
    case 'text':
      return { ...state, text: action.text, banner: clearInputBanner(state) };
    case 'person':
      return {
        ...state,
        personId: action.personId,
        banner: clearInputBanner(state),
      };
    case 'submit_begin':
      return {
        ...state,
        phase: 'submitting',
        startOp: action.op,
        banner: null,
        failure: null,
      };
    case 'submit_offline':
      return {
        ...state,
        phase: state.selection ? 'selecting' : 'write',
        banner: {
          kind: 'offline',
          scope: state.selection ? 'select' : 'start',
        },
      };
    case 'submit_refused':
      return {
        ...state,
        phase: state.selection ? 'selecting' : 'write',
        banner: action.forbidden
          ? { kind: 'forbidden', message: action.message }
          : { kind: 'refused', message: action.message },
      };
    case 'job_begin':
      return applyJob(
        { ...state, jobId: action.jobId, connection: 'connected' },
        action.job,
      );
    case 'job':
      if (!listening.has(state.phase)) return state;
      if (state.jobId !== null && state.jobId !== action.job.jobId)
        return state;
      // 迟到的旧快照（如重试成功后才返回的上一轮读取）不覆盖更新的状态
      if (
        state.job?.jobId === action.job.jobId &&
        action.job.revision < state.job.revision
      )
        return state;
      return applyJob(state, action.job);
    case 'banner':
      return { ...state, banner: action.banner };
    case 'select_begin':
      return { ...state, phase: 'submitting', banner: null };
    case 'connection':
      return { ...state, connection: action.connection };
    case 'draft_loaded':
      if (action.basis !== undefined && action.basis !== state.edit)
        return state;
      return withDraft(state, action.draft);
    case 'edit_sbi':
      if (!state.edit || state.phase !== 'review') return state;
      return {
        ...state,
        edit: {
          ...state.edit,
          sbi: { ...state.edit.sbi, [action.field]: action.value },
        },
        problems: null,
        banner: state.banner?.kind === 'saveProblems' ? null : state.banner,
      };
    case 'edit_score': {
      const current = state.edit?.scores[action.key];
      // 只有待确认时能改：保存中改的值不会被提交，保存后显示的必须是提交的值
      if (!state.edit || !current || state.phase !== 'review') return state;
      return {
        ...state,
        edit: {
          ...state.edit,
          scores: {
            ...state.edit.scores,
            [action.key]: { ...current, value: action.value, touched: true },
          },
        },
      };
    }
    case 'edit_reason': {
      const current = state.edit?.scores[action.key];
      if (!state.edit || !current || state.phase !== 'review') return state;
      return {
        ...state,
        edit: {
          ...state.edit,
          scores: {
            ...state.edit.scores,
            [action.key]: { ...current, reason: action.reason },
          },
        },
      };
    }
    case 'save_begin':
      return { ...state, phase: 'saving', saveOp: action.op, banner: null };
    case 'save_saved':
      return {
        ...state,
        phase: 'saved',
        receipt: action.receipt,
        replayed: action.replayed,
        banner: null,
        problems: null,
      };
    case 'save_offline':
      return {
        ...state,
        phase: 'review',
        banner: { kind: 'offline', scope: 'save' },
      };
    case 'save_problems':
      return {
        ...state,
        phase: 'review',
        problems: action.problems,
        banner: { kind: 'saveProblems' },
      };
    case 'save_blocked':
      return { ...state, banner: null };
    case 'save_conflict':
      return {
        ...state,
        phase: 'review',
        banner: { kind: 'conflict', message: action.message },
      };
    case 'save_forbidden':
      return {
        ...state,
        phase: 'review',
        banner: { kind: 'forbidden', message: action.message },
      };
    case 'back_to_write':
      return resetToWrite({
        text: state.text,
        personId: state.personId,
        attachmentIds: state.attachmentIds,
      });
    case 'undone':
      // 照原型撤销后回到待确认：整理结果和改过的文字、分数都还在，可以改完再保存。
      // 保存用过的 operation_id 作废，再保存必须换新，否则服务端会重放撤销掉的那次。
      if (!state.draft || !state.edit)
        return resetToWrite({
          text: action.originalInput.text,
          personId: action.originalInput.personId,
          attachmentIds: action.originalInput.attachmentIds,
        });
      return {
        ...state,
        phase: 'review',
        text: action.originalInput.text,
        personId: action.originalInput.personId,
        attachmentIds: action.originalInput.attachmentIds,
        startOp: null,
        saveOp: null,
        receipt: null,
        replayed: false,
        banner: null,
        problems: null,
      };
  }
}

function clearInputBanner(state: RecordState): Banner | null {
  return state.banner?.kind === 'who' || state.banner?.kind === 'refused'
    ? null
    : state.banner;
}

function resetToWrite(
  input: Pick<RecordState, 'text' | 'personId' | 'attachmentIds'>,
): RecordState {
  // 已有任务之后回到输入（取消、撤销、任务不可用）：原 operation_id 已用于那次整理，
  // 再提交必须换新，否则服务端会重放旧任务。断网未送达时不经过这里，仍复用。
  return { ...blank, ...input };
}

/** 输入内容的签名：一样则复用同一个 operation_id（服务端按它重放，不会产生两个任务）。 */
export function inputKey(
  state: Pick<RecordState, 'text' | 'personId' | 'attachmentIds'>,
): string {
  return JSON.stringify([
    state.text.trim(),
    state.personId,
    state.attachmentIds,
  ]);
}

/** 未保存的内容：输入态已写下的原话，已改过的 SBI 或分数，以及请求在途时。 */
export function isDirty(state: RecordState): boolean {
  switch (state.phase) {
    case 'write':
      return state.text.trim() !== '';
    case 'submitting':
    case 'saving':
      return true;
    case 'review':
      return Boolean(
        state.draft && state.edit && isEdited(state.draft, state.edit),
      );
    default:
      return false;
  }
}
