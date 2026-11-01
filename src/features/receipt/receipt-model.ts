import type {
  MaterialBatchReceipt,
  MaterialFileReceipt,
} from '@/contracts/materials';
import type {
  MaterialReviewItem,
  MaterialReviewResolvedItem,
} from '@/contracts/material-review';
import type { RecordBatchDraft, RecordSaveInput } from '@/contracts/record';
import type { MaterialSourceReference } from '@/contracts/sources';
import type { ScoreValue } from '@/components/ui/Score';
import { copy } from './copy';
import type { ReceiptView } from './types';

/** 批次状态标签的图形，照原型 `.n-rstate[data-s]`：处理中、待核对、待确认、已完成。 */
export const statusKey = {
  processing: 'processing',
  needs_review: 'verify',
  awaiting_confirmation: 'confirm',
  completed: 'done',
  failed: 'failed',
} as const satisfies Record<MaterialBatchReceipt['status'], string>;

const two = (n: number) => String(n).padStart(2, '0');
const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${two(Math.floor(s / 60))}:${two(s % 60)}`;
};

/** 出处在原件里的位置：第几段、第几页、哪个单元格、哪段时间。 */
export function formatLocation(ref: MaterialSourceReference): string {
  const loc = ref.location;
  switch (loc.kind) {
    case 'document':
      return `第 ${loc.paragraph} 段`;
    case 'pdf':
      return `第 ${loc.page} 页`;
    case 'spreadsheet':
      return `${loc.sheet} ${loc.cell}`;
    case 'presentation':
      return `第 ${loc.slide} 页`;
    case 'recording':
    case 'video':
      return `${clock(loc.startMs)}–${clock(loc.endMs)}`;
    case 'image':
      return '图中区域';
    case 'code':
      return `${loc.path} 第 ${loc.startLine}–${loc.endLine} 行`;
  }
}

/** 原件版本对应的文件名；文字投递的原文叫「原话」。 */
export function materialLabel(
  receipt: MaterialBatchReceipt,
  originalVersionId: string,
): string {
  const file = receipt.files.find(
    (entry) => entry.originalVersionId === originalVersionId,
  );
  if (file) return file.filename;
  return receipt.textMaterial?.originalVersionId === originalVersionId
    ? '原话'
    : '原件';
}

export const sourceLine = (
  receipt: MaterialBatchReceipt,
  ref: MaterialSourceReference,
) =>
  `${materialLabel(receipt, ref.originalVersionId)} · ${formatLocation(ref)}`;

/** 文件格式角标：扩展名大写，最多四个字母。 */
export function extLabel(filename: string): string {
  const dot = filename.lastIndexOf('.');
  const ext = dot > 0 ? filename.slice(dot + 1) : '';
  return ext ? ext.slice(0, 4).toUpperCase() : '文件';
}

export type FileState = {
  icon: 'clock' | 'check' | 'x' | 'user' | 'doc';
  label: string;
  tone: 'ok' | 'err' | null;
  /** 失败、不支持时写原因和下一步。 */
  message: string | null;
  busy: boolean;
};

/** 文件一行的状态，按 897 的文件终态说；已解析只表示读完了，不表示有人确认过。 */
export function fileState(file: MaterialFileReceipt): FileState {
  const f = copy.files;
  switch (file.status) {
    case 'processing':
      return {
        icon: 'clock',
        label: f.processing,
        tone: null,
        message: null,
        busy: true,
      };
    case 'parsed':
      return {
        icon: 'check',
        label: f.parsed,
        tone: 'ok',
        message: null,
        busy: false,
      };
    case 'needs_review':
      return {
        icon: 'user',
        label: f.needsReview,
        tone: null,
        message: null,
        busy: false,
      };
    case 'original_only':
      return {
        icon: 'doc',
        label: f.originalOnly,
        tone: null,
        message: null,
        busy: false,
      };
    case 'attachment_only':
      return {
        icon: 'doc',
        label: f.attachmentOnly,
        tone: null,
        message: null,
        busy: false,
      };
    case 'unsupported':
      return {
        icon: 'x',
        label: f.unsupported,
        tone: 'err',
        message: file.message,
        busy: false,
      };
    case 'failed':
      return {
        icon: 'x',
        label: f.failed,
        tone: 'err',
        message: file.message,
        busy: false,
      };
  }
}

const quoted = (name: string | null) => (name ? `「${name}」` : null);

/** 待核对一处的问题，用原件名和位置说清是哪里；不出现候选人。 */
export function reviewQuestion(
  receipt: MaterialBatchReceipt,
  item: MaterialReviewItem | MaterialReviewResolvedItem,
): string {
  const file = materialLabel(receipt, item.originalVersionId);
  const at = item.source ? ` ${formatLocation(item.source)}` : '';
  switch (item.kind) {
    case 'speaker':
      return `${file}${at}的说话人是谁`;
    case 'unknown_person':
      return item.observedName
        ? `${file}${at}的${quoted(item.observedName)}指谁`
        : `${file}${at}提到的人是谁`;
    case 'image_scope':
      return `${file}里要整理哪几行`;
    case 'unknown_project':
      return item.observedName
        ? `${quoted(item.observedName)}是哪个课题`
        : `${file}属于哪个课题`;
    case 'unknown_interviewer':
      return item.observedName
        ? `面试官${quoted(item.observedName)}是谁`
        : `${file}${at}的面试官是谁`;
    case 'unknown_interview_candidate':
      return item.observedName
        ? `候选人${quoted(item.observedName)}是谁`
        : `${file}${at}的候选人是谁`;
  }
}

/** 已核对一处的结果，只读展示「问题 → 结果」；按权限看不到的名字不写也不猜，返回 null。 */
export function resolvedResult(
  item: MaterialReviewResolvedItem,
  people: ReceiptView['people'],
): string | null {
  const names = (ids: readonly string[]) =>
    ids
      .map((id) => people[id]?.name)
      .filter(Boolean)
      .join('、') || null;
  const r = item.resolution;
  switch (r.action) {
    case 'bind':
    case 'link_existing_interviewer':
    case 'link_existing_candidate':
      return names([r.personId]);
    case 'bind_people':
      return names(r.personIds);
    case 'confirm_scope':
      return '整理范围内的部分';
    case 'keep_original_only':
      return copy.confirm.skipped;
    case 'keep_attachment_only':
      return '只作附件';
    case 'mark_irrelevant':
      return '与这次无关';
    case 'link_existing_project':
      return null;
    case 'mark_no_project':
      return '明确无课题';
  }
}

/** 还没认出是谁的一处：只给原件里的这一处，不显示 AI 草拟的标题和建议分。 */
export type HeldEntry = {
  itemId: string;
  who: string | null;
  quote: string | null;
  source: string | null;
};

export function heldEntries(receipt: MaterialBatchReceipt): HeldEntry[] {
  return receipt.items.flatMap((item) => {
    if (item.kind !== 'speaker' && item.kind !== 'unknown_person') return [];
    return [
      {
        itemId: item.itemId,
        who:
          item.kind === 'unknown_person'
            ? quoted(item.observedName)
            : item.source
              ? `「说话人 · ${formatLocation(item.source)}」`
              : null,
        quote: item.kind === 'speaker' ? item.quote : null,
        source: item.source ? sourceLine(receipt, item.source) : null,
      },
    ];
  });
}

/** 已标为名单外的人：没有人和事件，也照原型列一张卡说明只保留在原件里。 */
export function skippedEntries(receipt: MaterialBatchReceipt) {
  return receipt.resolvedItems.flatMap((item) =>
    item.kind === 'unknown_person' &&
    item.resolution.action === 'keep_original_only'
      ? [
          {
            itemId: item.itemId,
            who: quoted(item.observedName),
            source: item.source ? sourceLine(receipt, item.source) : null,
          },
        ]
      : [],
  );
}

/** 一件事最先出现的原话引文，放在标题下面。 */
export function leadQuote(draft: RecordBatchDraft) {
  for (const score of draft.scores)
    if (score.state === 'suggested' && score.citations[0])
      return score.citations[0];
  return null;
}

/** 合成自几份材料：按原件版本去重。 */
export const materialCount = (draft: RecordBatchDraft) =>
  new Set(draft.sourceReferences.map((ref) => ref.originalVersionId)).size;

/** 改分表里每一维的取值：只有 AI 建议分能改，资料不足的维度不出分。 */
export type EditValues = Record<string, ScoreValue>;
const scoreKey = (personId: string, dimensionId: string) =>
  `${personId}:${dimensionId}`;
export const draftScoreKey = (score: {
  personId: string;
  dimensionId: string;
}) => scoreKey(score.personId, score.dimensionId);

export function suggestedValues(draft: RecordBatchDraft): EditValues {
  return Object.fromEntries(
    draft.scores.flatMap((score) =>
      score.state === 'suggested'
        ? [[draftScoreKey(score), score.value as ScoreValue]]
        : [],
    ),
  );
}

export function isEdited(draft: RecordBatchDraft, values: EditValues) {
  return draft.scores.some(
    (score) =>
      score.state === 'suggested' &&
      values[draftScoreKey(score)] !== undefined &&
      values[draftScoreKey(score)] !== score.value,
  );
}

/**
 * 按 844 把一件事的确认写成保存输入：没改的建议分是确认，改过的是改分并带理由，
 * 资料不足的维度原样带上原因；不出分。
 */
export function saveInput(
  draft: RecordBatchDraft,
  values: EditValues,
  reason: string,
  operationId: string,
): RecordSaveInput {
  return {
    operation_id: operationId,
    expected_revision: draft.revision,
    draftId: draft.draftId,
    personIds: draft.personIds,
    projectId: draft.projectId,
    sbi: draft.sbi,
    decisions: draft.scores.map((score) => {
      const base = { personId: score.personId, dimensionId: score.dimensionId };
      if (score.state === 'unknown')
        return { ...base, action: 'unknown' as const, reason: score.reason };
      const value = values[draftScoreKey(score)] ?? score.value;
      return value === score.value
        ? { ...base, action: 'confirm' as const }
        : { ...base, action: 'edit' as const, value, reason };
    }),
  };
}

/** 同一件事、同样的内容重发时沿用同一个 operation_id，服务端据此重放而不是重复保存。 */
export function saveKey(input: RecordSaveInput) {
  return JSON.stringify({ ...input, operation_id: undefined });
}

export function people(view: ReceiptView, ids: readonly string[]) {
  return ids
    .map((id) => view.people[id]?.name ?? '')
    .filter(Boolean)
    .join('、');
}
