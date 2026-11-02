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
  type RecordSaveInput,
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

/** processing 样张：读到第几次时录音转写完。 */
export const PROCESSING_READS = 2;

type Saved = {
  saveId: string;
  draft: RecordBatchDraft;
  events: { personId: string; eventId: string }[];
  savedAt: number;
  operationId: string;
  key: string;
  result: RecordSaveResult;
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
  const undone = new Set<string>();
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
    const live = drafts.map((d) => ({ ...d, revision }));
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

  const keyOf = (input: RecordSaveInput) => {
    return JSON.stringify({ ...input, operation_id: undefined });
  };

  return {
    async read(batchId): Promise<ReceiptReadResult> {
      reads += 1;
      if (batchId !== BATCH_ID)
        return { status: 'not_found', message: '回执链接失效' };
      return { status: 'success', view: view() };
    },

    async save(raw): Promise<RecordSaveResult> {
      const input = recordSaveInputSchema.parse(raw);
      const replay = [...saved.values()].find(
        (s) => s.operationId === input.operation_id,
      );
      if (replay) {
        if (replay.key === keyOf(input))
          return { ...replay.result, replayed: true } as RecordSaveResult;
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
      if (conflictPending || input.expected_revision !== revision) {
        if (conflictPending) {
          conflictPending = false;
          revision += 1;
        }
        return recordSaveResultSchema.parse({
          status: 'conflict',
          message: '这件事刚有新的版本，载入后再确认',
          input,
        });
      }
      const savedAt = now();
      const saveId = `save-${draft.draftId}-${saved.size + undone.size + 1}`;
      const events = draft.personIds.map((personId, i) => ({
        personId,
        eventId: `ev-${draft.draftId}-${i + 1}`,
      }));
      const result = recordSaveResultSchema.parse({
        status: 'success',
        replayed: false,
        result: {
          saveId,
          events,
          revision: revision + 1,
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
        draft,
        events,
        savedAt,
        operationId: input.operation_id,
        key: keyOf(input),
        result,
      });
      return result;
    },

    async undo(raw: RecordUndoInput): Promise<RecordUndoResult> {
      const input = recordUndoInputSchema.parse(raw);
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
      undone.add(input.saveId);
      revision += 1;
      const order = sampleDrafts.map((d) => d.draftId);
      drafts = [...drafts, entry.draft].sort(
        (a, b) => order.indexOf(a.draftId) - order.indexOf(b.draftId),
      );
      return recordUndoResultSchema.parse({
        status: 'success',
        replayed: false,
        result: {
          saveId: input.saveId,
          withdrawnEvents: entry.events,
          withdrawnConfirmationIds: [],
          withdrawnReviewItemIds: [],
          // 照 846（#289）：撤销回执不带原输入；回执页的事回到待确认，本来也不需要原话
          inputRestoration: 'unavailable',
          originalInput: null,
        },
      });
    },
  };
}
