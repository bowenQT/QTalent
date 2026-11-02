import type { RecordBatchDraft } from '@/contracts/record';
import {
  initEdit,
  isEdited,
  type EditState,
  type OperationId,
} from './build-save-input';
import { routeBatch, type HandoffReason } from './batch-route';
import type { FailureKind, SaveProblems } from './errors';
import type { BatchReceipt, RecordSaveReceipt, ScoreKey } from './types';

/**
 * 记一件事的流程状态机（纯函数）。
 * write → submitting → organizing → review → saving → saved；
 * 整理出多件事或有核对项时转到 handoff，链接回执页。
 * 失败、断网、冲突都是旁路：输入（原话、人员、已改的 SBI 与分数）一律保留。
 */
export type Phase =
  | 'write'
  | 'submitting'
  | 'organizing'
  | 'handoff'
  | 'review'
  | 'saving'
  | 'saved';

export type Banner =
  /** picked：是否选了人；没选人时提示先选，选了人时写明节点待确认的原因。 */
  | { kind: 'node'; reason: NodeIssue; picked: boolean }
  | { kind: 'offline'; scope: 'start' | 'save' }
  /** 服务端这次没完成保存（不是网络）：改动保留，可以再保存或复制留存。 */
  | { kind: 'saveUnavailable' }
  | { kind: 'conflict'; message: string }
  | { kind: 'forbidden'; message: string }
  | { kind: 'refused'; message: string }
  | { kind: 'saveProblems' };

/** 撤销后重新读取这件事的上限：读满还没读到，就只给回执入口。 */
export const REREAD_LIMIT = 3;

/**
 * 撤销之后、读到这件事的现状之前，保存暂停。独立于提示条：提示条可以被别的提示替换，
 * 保存的暂停只有读到对应的待确认草稿（或确认撤销没生效）才解除。
 * - pending：撤销请求出过错，这条记录可能已撤回，也可能仍在档案里；
 * - refresh：撤销已完成，但回执没给可用的草稿版本。
 * read 是最近一次重新读取的结果：读到已在别处再次确认（confirmed），或读到了批次却
 * 没有这件事（missing），都继续暂停，交给回执页看。
 * saveId 是暂停所属的那次保存；attempts 是已发起的重读次数，不论结果，到 REREAD_LIMIT 为止。
 */
export type Hold = {
  kind: 'pending' | 'refresh';
  saveId: string;
  read: 'reading' | 'failed' | 'confirmed' | 'missing' | null;
  attempts: number;
};

/**
 * 页面当前代表的那次保存：有回执时是回执的 saveId，撤销后暂停时是暂停所属的 saveId，
 * 回到待确认后为空。撤销和重读的异步结果只在归属等于它时生效。
 */
export function currentSaveId(state: RecordState): string | null {
  return state.receipt?.saveId ?? state.hold?.saveId ?? null;
}

/** 批次读回的一条已确认：当前版本与人员到事件的映射。 */
export type ConfirmedDraft = BatchReceipt['confirmedDrafts'][number];

/**
 * 结果不明的撤销读到这件事仍在已确认里时，只有读回的版本和事件映射都和这次保存的回执
 * 一致，才能证明原保存仍然有效。别处撤销后又确认过同一份草稿，版本和事件都会变。
 */
export function confirmsSave(
  state: RecordState,
  saveId: string,
  entry: ConfirmedDraft,
): boolean {
  const receipt = state.receipt;
  if (
    !receipt ||
    receipt.saveId !== saveId ||
    state.hold?.saveId !== saveId ||
    state.hold.kind !== 'pending' ||
    entry.revision !== receipt.revision ||
    entry.events.length !== receipt.events.length
  )
    return false;
  return receipt.events.every((saved) =>
    entry.events.some(
      (read) =>
        read.personId === saved.personId && read.eventId === saved.eventId,
    ),
  );
}

export type Connection = 'connected' | 'error' | 'gone';
/** 评价节点为什么没法定下来：多个、没有，或推导入口待接通。 */
export type NodeIssue = 'multiple' | 'none' | 'pending' | 'unavailable';

export type RecordState = {
  phase: Phase;
  text: string;
  personId: string | null;
  startOp: OperationId | null;
  batchId: string | null;
  batch: BatchReceipt | null;
  failure: { kind: FailureKind; retryable: boolean } | null;
  handoff: HandoffReason | null;
  connection: Connection;
  draft: RecordBatchDraft | null;
  edit: EditState | null;
  saveOp: OperationId | null;
  receipt: RecordSaveReceipt | null;
  replayed: boolean;
  banner: Banner | null;
  problems: SaveProblems | null;
  hold: Hold | null;
};

export type StartInit = {
  text?: string;
  personId?: string | null;
  batchId?: string;
};

const blank: RecordState = {
  phase: 'write',
  text: '',
  personId: null,
  startOp: null,
  batchId: null,
  batch: null,
  failure: null,
  handoff: null,
  connection: 'connected',
  draft: null,
  edit: null,
  saveOp: null,
  receipt: null,
  replayed: false,
  banner: null,
  problems: null,
  hold: null,
};

export function initialState(init: StartInit = {}): RecordState {
  const base: RecordState = {
    ...blank,
    text: init.text ?? '',
    personId: init.personId ?? null,
  };
  if (init.batchId)
    return { ...base, phase: 'organizing', batchId: init.batchId };
  return base;
}

/** 草稿 → 待确认。原话一直是本页的输入，不从草稿里取。 */
function withDraft(state: RecordState, draft: RecordBatchDraft): RecordState {
  return {
    ...state,
    phase: 'review',
    failure: null,
    handoff: null,
    draft,
    edit: initEdit(draft),
    saveOp: null,
    receipt: null,
    replayed: false,
    problems: null,
    banner: null,
  };
}

function applyBatch(state: RecordState, batch: BatchReceipt): RecordState {
  const next = { ...state, batch, batchId: batch.batchId };
  const view = routeBatch(batch);
  switch (view.kind) {
    case 'processing':
      return { ...next, phase: 'organizing', failure: null, handoff: null };
    case 'failed':
      return {
        ...next,
        phase: 'organizing',
        failure: { kind: view.failure, retryable: view.retryable },
        handoff: null,
      };
    case 'receipt':
      return {
        ...next,
        phase: 'handoff',
        failure: null,
        handoff: view.reason,
        draft: null,
        edit: null,
      };
    case 'draft':
      return withDraft(next, view.draft);
  }
}

export type Action =
  | { type: 'text'; text: string }
  | { type: 'person'; personId: string | null }
  /** 先推导节点再提交：推导时还没有 operation_id，不带 op。 */
  | { type: 'submit_begin'; op?: OperationId }
  | { type: 'submit_offline' }
  | { type: 'submit_refused'; message: string; forbidden?: boolean }
  | { type: 'node_unresolved'; reason: NodeIssue }
  | { type: 'batch_begin'; batch: BatchReceipt }
  | { type: 'batch'; batch: BatchReceipt }
  | { type: 'banner'; banner: Banner | null }
  | { type: 'connection'; connection: Connection }
  /** basis：发起读取时的修改；之后又改过就不再用读取结果覆盖。 */
  | { type: 'draft_loaded'; draft: RecordBatchDraft; basis?: EditState | null }
  | { type: 'edit_sbi'; field: keyof EditState['sbi']; value: string }
  | { type: 'edit_score'; key: ScoreKey; value: number }
  | { type: 'edit_reason'; key: ScoreKey; reason: string }
  | { type: 'save_begin'; op: OperationId }
  | { type: 'save_saved'; receipt: RecordSaveReceipt; replayed: boolean }
  | { type: 'save_offline' }
  | { type: 'save_unavailable' }
  | { type: 'save_problems'; problems: SaveProblems }
  | { type: 'save_conflict'; message: string }
  | { type: 'save_forbidden'; message: string }
  | { type: 'back_to_write' }
  /** draftRevision: the version the undo receipt hands back for saving again; null to reload. */
  | { type: 'undone'; saveId: string; draftRevision: number | null }
  /** 撤销请求出错或超时，结果不明。 */
  | { type: 'undo_unknown'; saveId: string }
  | { type: 'undo_reread_begin'; saveId: string }
  /** 撤销后重新读到了这件事、仍待确认：用读到的版本，修改保留，解除暂停。 */
  | { type: 'undo_reread'; saveId: string; draft: RecordBatchDraft }
  /** 重新读取发现这件事在已确认里；entry 是读回的版本和事件映射。 */
  | { type: 'undo_reread_confirmed'; saveId: string; entry: ConfirmedDraft }
  /** 读到了批次，但待确认和已确认里都没有这件事。 */
  | { type: 'undo_reread_missing'; saveId: string }
  /** 重新读取失败或超时。 */
  | { type: 'undo_reread_failed'; saveId: string };

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
        startOp: action.op ?? state.startOp,
        banner: null,
        failure: null,
      };
    case 'submit_offline':
      return {
        ...state,
        phase: 'write',
        banner: { kind: 'offline', scope: 'start' },
      };
    case 'submit_refused':
      return {
        ...state,
        phase: 'write',
        banner: action.forbidden
          ? { kind: 'forbidden', message: action.message }
          : { kind: 'refused', message: action.message },
      };
    case 'node_unresolved':
      // 没有提交：operation_id 也没用掉，留着下次同样的内容复用。
      return {
        ...state,
        phase: 'write',
        banner: {
          kind: 'node',
          reason: action.reason,
          picked: state.personId !== null,
        },
      };
    case 'batch_begin':
      return applyBatch(
        { ...state, batchId: action.batch.batchId, connection: 'connected' },
        action.batch,
      );
    case 'batch':
      // 只在整理中接收进度；别的批次、迟到的旧修订不覆盖当前状态。
      if (state.phase !== 'organizing') return state;
      if (state.batchId !== null && state.batchId !== action.batch.batchId)
        return state;
      if (state.batch && action.batch.revision < state.batch.revision)
        return state;
      return applyBatch(state, action.batch);
    case 'banner':
      return { ...state, banner: action.banner };
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
    case 'save_unavailable':
      return {
        ...state,
        phase: 'review',
        banner: { kind: 'saveUnavailable' },
      };
    case 'save_problems':
      return {
        ...state,
        phase: 'review',
        problems: action.problems,
        banner: { kind: 'saveProblems' },
      };
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
      return resetToWrite(state);
    case 'undone':
      // 照原型撤销后回到待确认：整理结果和改过的文字、分数都还在，可以改完再保存。
      // 846 的撤销回执不带原输入（originalInput 为 null），原话用本页 state 里的。
      // 保存用过的 operation_id 作废，再保存必须换新，否则服务端会重放撤销掉的那次。
      // 846 的撤销推进了草稿版本：再保存用回执给的新版本，不然会被当成冲突。
      // 回执要求重读（refresh_required）时手里的版本已经过时：先重读，读到新版本再保存。
      // 只认当前这次保存的撤销回执：旧保存的回执（服务端按原 operation_id 重放）原样丢弃。
      if (currentSaveId(state) !== action.saveId) return state;
      if (!state.draft || !state.edit) return resetToWrite(state);
      return {
        ...state,
        draft:
          action.draftRevision === null
            ? state.draft
            : { ...state.draft, revision: action.draftRevision },
        phase: 'review',
        saveOp: null,
        receipt: null,
        replayed: false,
        banner: null,
        problems: null,
        hold:
          action.draftRevision === null
            ? {
                kind: 'refresh',
                saveId: action.saveId,
                read: null,
                // 同一次保存从结果不明转为已撤销：已经读过的次数照算
                attempts:
                  state.hold?.saveId === action.saveId
                    ? state.hold.attempts
                    : 0,
              }
            : null,
      };
    case 'undo_unknown':
      if (
        state.phase !== 'saved' ||
        state.hold ||
        state.receipt?.saveId !== action.saveId
      )
        return state;
      return {
        ...state,
        hold: {
          kind: 'pending',
          saveId: action.saveId,
          read: null,
          attempts: 0,
        },
      };
    case 'undo_reread_begin':
      // 重读按发起次数计，不论结果；到上限后不再发起
      if (
        state.hold?.saveId !== action.saveId ||
        state.hold.read === 'reading' ||
        state.hold.attempts >= REREAD_LIMIT
      )
        return state;
      return {
        ...state,
        hold: {
          ...state.hold,
          read: 'reading',
          attempts: state.hold.attempts + 1,
        },
      };
    case 'undo_reread':
      // 只有读到对应的待确认草稿才解除暂停
      if (state.hold?.saveId !== action.saveId || !state.edit) return state;
      return {
        ...state,
        draft: action.draft,
        phase: 'review',
        saveOp: null,
        receipt: null,
        replayed: false,
        banner: null,
        problems: null,
        hold: null,
      };
    case 'undo_reread_confirmed':
      if (state.hold?.saveId !== action.saveId) return state;
      // 读回的版本和事件就是这次保存：结果不明的撤销没生效，仍是已保存，解除暂停
      if (confirmsSave(state, action.saveId, action.entry))
        return { ...state, hold: null };
      // 撤销生效后又被再次确认（版本或事件变了）：这次保存的回执已不是事实，
      // 不再显示它的署名和事件；修改留在页面上，保存继续暂停，交给回执页
      return {
        ...state,
        phase: state.edit ? 'review' : state.phase,
        receipt: state.edit ? null : state.receipt,
        saveOp: null,
        replayed: false,
        banner: null,
        problems: null,
        hold: { ...state.hold, kind: 'refresh', read: 'confirmed' },
      };
    case 'undo_reread_missing':
      if (state.hold?.saveId !== action.saveId) return state;
      return { ...state, hold: { ...state.hold, read: 'missing' } };
    case 'undo_reread_failed':
      if (state.hold?.saveId !== action.saveId) return state;
      return { ...state, hold: { ...state.hold, read: 'failed' } };
  }
}

function clearInputBanner(state: RecordState): Banner | null {
  return state.banner?.kind === 'node' || state.banner?.kind === 'refused'
    ? null
    : state.banner;
}

function resetToWrite(
  input: Pick<RecordState, 'text' | 'personId'>,
): RecordState {
  // 已提交批次之后回到输入（重写、撤销后放弃、批次不可用）：原 operation_id 已用于那个批次，
  // 再提交必须换新，否则服务端会重放旧批次。断网未送达时不经过这里，仍复用。
  return { ...blank, text: input.text, personId: input.personId };
}

/** 输入内容的签名：一样则复用同一个 operation_id（服务端按它重放，不会产生两个批次）。 */
export function inputKey(
  state: Pick<RecordState, 'text' | 'personId'>,
): string {
  return JSON.stringify([state.text.trim(), state.personId]);
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
