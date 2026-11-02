import {
  materialBatchReceiptSchema,
  type MaterialFileReceipt,
} from '@/contracts/materials';
import {
  RECORD_UNDO_WINDOW_MS,
  recordSaveInputSchema,
  recordSaveResultSchema,
  recordUndoInputSchema,
  recordUndoResultSchema,
  type RecordBatchDraft,
  type RecordSaveResult,
  type RecordUndoInput,
  type RecordUndoResult,
} from '@/contracts/record';
import type {
  ReceiptActions,
  ReceiptReadResult,
  ReceiptView,
} from '@/features/receipt/types';
import {
  BATCH_ID,
  dimensions,
  extraFiles,
  NODE_ID,
  parsedAudio,
  people,
  sampleAccount,
  sampleDrafts,
  sampleFiles,
  sampleItems,
  sampleMeta,
  type SampleRole,
  type SampleScene,
} from './sample-data';
import { ledgerKey, requestKey } from '../record/sample-ledger';

/** processing 样张：读到第几次时录音转写完。 */
export const PROCESSING_READS = 2;

type Saved = {
  saveId: string;
  draft: RecordBatchDraft;
  events: { personId: string; eventId: string }[];
  savedAt: number;
};
/**
 * 操作台账，和当前有效的保存分开（照 846）：按账号、动作、operation_id 分开记，同样的
 * 请求（归一化后）重放第一次的结果，撤销之后、过了撤销时间也一样；请求变了就是冲突。
 */
type Operation = {
  request: string;
  result: RecordSaveResult | RecordUndoResult;
};

/**
 * 回执页开发样张的服务端替身：按 897 回执快照和 844 保存、撤销契约应答，每次返回都经契约
 * schema 校验。只在开发样张里用，生产 404；不是真实页面的兜底。
 */
export function createSampleServer(
  role: SampleRole,
  scene: SampleScene,
  now: () => number = Date.now,
): ReceiptActions {
  let revision = 1;
  let reads = 0;
  let conflictPending = scene === 'conflict';
  let drafts = scene === 'empty' ? [] : sampleDrafts.map((d) => ({ ...d }));
  const saved = new Map<string, Saved>();
  const operations = new Map<string, Operation>();
  let serial = 0;
  const items = scene === 'empty' ? [] : sampleItems;
  const me = sampleAccount(role);

  const files = (): MaterialFileReceipt[] => {
    if (scene !== 'processing') return sampleFiles;
    const audio = reads > PROCESSING_READS ? parsedAudio : extraFiles[0]!;
    return [...sampleFiles, audio, extraFiles[1]!];
  };

  function view(): ReceiptView {
    const list = files();
    const count = (status: MaterialFileReceipt['status']) =>
      list.filter((f) => f.status === status).length;
    const processing = count('processing') > 0;
    const confirmedDrafts = [...saved.values()].map((s) => ({
      draftId: s.draft.draftId,
      revision: s.draft.revision,
      events: s.events,
    }));
    // 每张草稿有自己的 revision，只在这件事本身变了时前进；确认别的事不影响它
    const live = drafts;
    const personIds = scene === 'empty' ? [] : Object.keys(people);
    const receipt = materialBatchReceiptSchema.parse({
      batchId: BATCH_ID,
      revision,
      evaluationNodeId: NODE_ID,
      personIds,
      projectId: 't-scene-b',
      hasHiddenContent: scene === 'hidden',
      status: processing
        ? 'processing'
        : items.length
          ? 'needs_review'
          : live.length
            ? 'awaiting_confirmation'
            : 'completed',
      jobId: null,
      files: list,
      textMaterial: null,
      items,
      resolvedItems: [],
      draftSet: live.length
        ? { batchId: BATCH_ID, revision, drafts: live, duplicateCandidates: [] }
        : null,
      confirmedDrafts,
      counts: {
        files: {
          total: list.length,
          processing: count('processing'),
          parsed: count('parsed'),
          needs_review: count('needs_review'),
          unsupported: count('unsupported'),
          failed: count('failed'),
          original_only: count('original_only'),
          attachment_only: count('attachment_only'),
        },
        events: {
          total: live.length + confirmedDrafts.length,
          awaiting_confirmation: live.length,
          confirmed: confirmedDrafts.length,
        },
        reviewItems: items.length,
      },
      error: null,
    });
    return {
      receipt,
      ...sampleMeta,
      people,
      dimensions,
      confirmers: Object.fromEntries(
        live.map((d) => [d.draftId, { mine: role === 'mentor', name: '叶青' }]),
      ),
    };
  }

  return {
    async read(batchId): Promise<ReceiptReadResult> {
      reads += 1;
      if (batchId !== BATCH_ID)
        return { status: 'not_found', message: '回执链接失效' };
      return { status: 'success', view: view() };
    },

    async save(raw): Promise<RecordSaveResult> {
      const input = recordSaveInputSchema.parse(raw);
      const ledger = ledgerKey(me.id, 'save', input.operation_id);
      const known = operations.get(ledger);
      if (known) {
        if (known.request === requestKey('save', input))
          return { ...known.result, replayed: true } as RecordSaveResult;
        return recordSaveResultSchema.parse({
          status: 'conflict',
          message: '同一次操作的内容变了，请重新确认',
          input,
        });
      }
      const draft = drafts.find((d) => d.draftId === input.draftId);
      if (!draft)
        return recordSaveResultSchema.parse({
          status: 'not_found',
          message: '这件事已经确认过了',
        });
      if (conflictPending || input.expected_revision !== draft.revision) {
        if (conflictPending) {
          conflictPending = false;
          revision += 1;
          drafts = drafts.map((d) =>
            d.draftId === draft.draftId
              ? { ...d, revision: d.revision + 1 }
              : d,
          );
        }
        return recordSaveResultSchema.parse({
          status: 'conflict',
          message: '这件事刚有新的版本，载入后再确认',
          input,
        });
      }
      const savedAt = now();
      serial += 1;
      const saveId = `save-${draft.draftId}-${serial}`;
      // 每次保存逐人新建事件：撤销后再保存是新事件，编号不复用
      const events = draft.personIds.map((personId, i) => ({
        personId,
        eventId: `ev-${draft.draftId}-${serial}-${i + 1}`,
      }));
      // 照 846：保存推进这件事的 revision，回执给出保存后的版本
      const savedDraft = { ...draft, revision: draft.revision + 1 };
      const result = recordSaveResultSchema.parse({
        status: 'success',
        replayed: false,
        result: {
          saveId,
          events,
          revision: savedDraft.revision,
          confirmationIds: input.decisions.map(
            (_, i) => `cf-${saveId}-${i + 1}`,
          ),
          reviewItemIds: [],
          savedBy: me.id,
          savedAt: new Date(savedAt).toISOString(),
          undoUntil: new Date(savedAt + RECORD_UNDO_WINDOW_MS).toISOString(),
        },
      });
      revision += 1;
      drafts = drafts.filter((d) => d.draftId !== draft.draftId);
      saved.set(saveId, {
        saveId,
        draft: savedDraft,
        events,
        savedAt,
      });
      operations.set(ledger, {
        request: requestKey('save', input),
        result,
      });
      return result;
    },

    async undo(raw: RecordUndoInput): Promise<RecordUndoResult> {
      const input = recordUndoInputSchema.parse(raw);
      const ledger = ledgerKey(me.id, 'undo', input.operation_id);
      const known = operations.get(ledger);
      if (known) {
        if (known.request === requestKey('undo', input))
          return { ...known.result, replayed: true } as RecordUndoResult;
        return recordUndoResultSchema.parse({
          status: 'conflict',
          message: '同一次操作的内容变了',
          input,
        });
      }
      const entry = saved.get(input.saveId);
      if (!entry)
        return recordUndoResultSchema.parse({
          status: 'not_found',
          message: '这次保存已撤回或已过期',
        });
      if (now() - entry.savedAt >= RECORD_UNDO_WINDOW_MS)
        return recordUndoResultSchema.parse({
          status: 'conflict',
          message: '已超过撤销时间，这条记录已保存',
          input,
        });
      saved.delete(input.saveId);
      revision += 1;
      const order = sampleDrafts.map((d) => d.draftId);
      // 照 846（#317）：撤销把草稿恢复成可确认，revision 再前进一次
      const restored = { ...entry.draft, revision: entry.draft.revision + 1 };
      drafts = [...drafts, restored].sort(
        (a, b) => order.indexOf(a.draftId) - order.indexOf(b.draftId),
      );
      const result = recordUndoResultSchema.parse({
        status: 'success',
        replayed: false,
        result: {
          saveId: input.saveId,
          withdrawnEvents: entry.events,
          withdrawnConfirmationIds: [],
          withdrawnReviewItemIds: [],
          // 回执给出再确认要用的新版本
          draftRestoration: {
            status: 'available',
            draftId: restored.draftId,
            draftRevision: restored.revision,
          },
          // 照 846（#289）：撤销回执不带原输入；回执页的事回到待确认，本来也不需要原话
          inputRestoration: 'unavailable',
          originalInput: null,
        },
      });
      operations.set(ledger, {
        request: requestKey('undo', input),
        result,
      });
      return result;
    },
  };
}
