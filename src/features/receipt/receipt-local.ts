import type { MaterialBatchReceipt } from '@/contracts/materials';
import type { RecordBatchDraft } from '@/contracts/record';
import { matchesSave } from '@/features/record/record-flow';
import type { EditValues } from './receipt-model';

/*
 * 回执页的本地状态。卡片是已确认、待确认还是已撤销，只看最近一次成功读取的快照；
 * 本地每件事只留两样：至多一个进行中的操作，以及用来恢复的编辑输入。
 */

/** 一次保存成功后服务端给的结果，加上这次保存用的分和理由。 */
export type SavedRecord = {
  draft: RecordBatchDraft;
  values: EditValues;
  reason: string;
  by: string;
  /** 确认日期，MM-DD。 */
  on: string;
  saveId: string;
  /** 这次保存建的事件（人和事件编号，eventKey），用来和快照里的确认对上。 */
  events: string;
  /** 保存回执给的版本和事件映射，用来判断快照是否已前进到别的保存。 */
  receipt: {
    revision: number;
    events: { personId: string; eventId: string }[];
  };
};

/**
 * 进行中的操作。响应已成功、但还没有读取能说明它的这一段也算进行中。
 * `at`：操作产生时已经发起过几次读取；只有更晚发起的读取能说明它。
 */
export type Op =
  /** 保存成功，等读取说明。 */
  | { kind: 'saved'; at: number; save: SavedRecord }
  /** 撤销成功，等读取说明；draft 带着撤销回执给的版本，saveId 是被撤销的那次保存。 */
  | { kind: 'undone'; at: number; draft: RecordBatchDraft; saveId: string }
  /**
   * 撤销结果不知道。verify：之前不知道、重试又被拒，只能刷新回执核实；
   * failed：上一次刷新没读到结果。
   */
  | {
      kind: 'unknown';
      at: number;
      save: SavedRecord;
      busy: boolean;
      verify: boolean;
      failed: boolean;
    };

/** 用来恢复的编辑输入：保存时的分和理由。 */
export type EditInput = { values: EditValues; reason: string };

export type LocalItem = { op?: Op; edit?: EditInput };

export type LocalState = {
  items: Record<string, LocalItem>;
  /** 本页保存的显示信息，按事件编号对上快照里的确认后才用来补署名和分数。 */
  signed: Record<string, SavedRecord>;
  /** 每件事本页最近一次保存的 saveId；读取对账不清它，用来丢弃旧保存的迟到结果。 */
  latest: Record<string, string>;
};

export const emptyLocal: LocalState = { items: {}, signed: {}, latest: {} };

/** 写操作的结果属于这件事最近一次保存时才采用；这件事已经重新保存过，旧结果丢弃。 */
export const isLatestSave = (local: LocalState, id: string, saveId: string) =>
  (local.latest[id] ?? saveId) === saveId;

export const eventKey = (events: { personId: string; eventId: string }[]) =>
  events
    .map((e) => `${e.personId}:${e.eventId}`)
    .sort()
    .join('|');

/**
 * 一次成功读取（第 started 次发起）带回快照后，清掉它能说明的操作：
 * 快照里看得到这件事（待确认或已确认），而且读取发起在操作之后。看不到的不算说明，留着。
 * 读到待确认时，把那次保存的分和理由留作编辑输入；读到已确认、又没有进行中的操作时，丢掉编辑输入。
 */
export function reconcile(
  local: LocalState,
  started: number,
  receipt: MaterialBatchReceipt,
): LocalState {
  const pending = new Set(
    (receipt.draftSet?.drafts ?? []).map((d) => d.draftId),
  );
  const settled = new Set(receipt.confirmedDrafts.map((d) => d.draftId));
  const items: Record<string, LocalItem> = {};
  for (const [id, item] of Object.entries(local.items)) {
    let { op, edit } = item;
    if (op && op.at < started && (pending.has(id) || settled.has(id))) {
      if (pending.has(id) && op.kind !== 'undone')
        edit = { values: op.save.values, reason: op.save.reason };
      op = undefined;
    }
    if (!op && settled.has(id)) edit = undefined;
    if (op || edit)
      items[id] = { ...(op ? { op } : {}), ...(edit ? { edit } : {}) };
  }
  return { ...local, items };
}

/**
 * 撤销结果（包括重试的回放）到达时，快照是否已经前进到别的保存：这件事在已确认里，
 * 版本比这次保存的回执高（别处又确认过）。这时撤销结果丢弃，以快照为准。
 * 快照里的确认就是这次保存（matchesSave），或版本更低（读取停在更早的保存），
 * 或还没有这件事的确认，都不算前进。
 */
export function savedElsewhere(
  receipt: MaterialBatchReceipt,
  save: SavedRecord,
): boolean {
  const entry = receipt.confirmedDrafts.find(
    (d) => d.draftId === save.draft.draftId,
  );
  if (!entry || matchesSave(save.receipt, entry)) return false;
  return entry.revision > save.receipt.revision;
}

/** 卡片该怎么显示：只由快照和进行中的操作决定。 */
export type CardState =
  | { kind: 'saved'; save: SavedRecord }
  | { kind: 'unknown'; op: Extract<Op, { kind: 'unknown' }> }
  | { kind: 'pending'; draft: RecordBatchDraft; fromUndo: boolean }
  /** 快照里已确认；signed 是本页那次保存（事件编号对得上时）。 */
  | { kind: 'settled'; signed: SavedRecord | null }
  | { kind: 'none' };

export function cardState(
  local: LocalState,
  id: string,
  receipt: MaterialBatchReceipt,
): CardState {
  const op = local.items[id]?.op;
  const found = receipt.draftSet?.drafts.find((d) => d.draftId === id);
  if (op?.kind === 'saved') return { kind: 'saved', save: op.save };
  if (op?.kind === 'unknown') return { kind: 'unknown', op };
  if (op?.kind === 'undone')
    return {
      kind: 'pending',
      // 撤销回执给的版本；重读带回更高的版本时按它保存
      draft: found && found.revision > op.draft.revision ? found : op.draft,
      fromUndo: true,
    };
  if (found) return { kind: 'pending', draft: found, fromUndo: false };
  const entry = receipt.confirmedDrafts.find((d) => d.draftId === id);
  if (!entry) return { kind: 'none' };
  const signed = local.signed[eventKey(entry.events)];
  return {
    kind: 'settled',
    signed: signed && signed.draft.draftId === id ? signed : null,
  };
}
