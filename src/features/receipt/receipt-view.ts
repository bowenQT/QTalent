import type { IconName } from '@/components/ui/Icon';
import type {
  MaterialBatchReceipt,
  MaterialFileReceipt,
} from '@/contracts/materials';
import type {
  MaterialReviewItem,
  MaterialReviewResolvedItem,
} from '@/contracts/material-review';
import type { RecordBatchDraft } from '@/contracts/record';
import type { MaterialSourceLocation } from '@/contracts/sources';

/**
 * What the receipt page shows, with every name already resolved. The 897 receipt
 * carries identifiers only (people, dimensions, projects); whoever reads it on the
 * server maps them through `ReceiptLookup` before the page sees anything.
 */
export type ReceiptLookup = {
  person: (id: string) => { name: string; meta?: string } | null;
  dimension: (id: string) => string | null;
  project: (id: string) => string | null;
};

export type BatchState =
  'processing' | 'verify' | 'confirm' | 'done' | 'failed';
export type FileLine = {
  key: string;
  name: string;
  icon: IconName;
  label: string;
  meta: string;
  tone: 'err' | 'ok' | null;
  busy: boolean;
};
export type ReviewLine = {
  key: string;
  kind: string;
  question: string;
  /** Present once resolved: what the question was answered with. */
  result: string | null;
};
export type DraftScore =
  | {
      key: string;
      dimension: string;
      state: 'suggested';
      value: number;
      /** The behaviour anchor the suggestion rests on, as 锚点 N · text. */
      anchor: string;
    }
  | { key: string; dimension: string; state: 'unknown'; reason: string };
export type DraftCard = {
  key: string;
  people: string[];
  title: string;
  quote: { text: string; where: string } | null;
  scores: DraftScore[];
  /** Why this event cannot be confirmed yet, if anything holds it. */
  held: string | null;
};
export type ReceiptView = {
  batchId: string;
  title: string;
  state: [BatchState, string];
  error: string | null;
  files: FileLine[];
  stillReading: boolean;
  summary: {
    files: number;
    processing: number;
    failed: number;
    unsupported: number;
    // Unknown while files are still being read: never drawn as 0.
    people: number | null;
    events: number | null;
    reviews: number | null;
    awaiting: number;
    confirmed: number;
  };
  reviews: ReviewLine[];
  drafts: DraftCard[];
  people: { id: string; name: string; meta?: string }[];
  hidden: boolean;
};

export const HIDDEN = '部分内容已按权限隐藏';

const STATE: Record<MaterialBatchReceipt['status'], [BatchState, string]> = {
  processing: ['processing', '处理中'],
  needs_review: ['verify', '待核对'],
  awaiting_confirmation: ['confirm', '待确认'],
  completed: ['done', '已完成'],
  failed: ['failed', '整理失败'],
};

/** Same words as the upload area's receipt lines (BOW-861 `materials-model.ts`). */
export function fileLine(file: MaterialFileReceipt): FileLine {
  const base = { key: file.materialId, name: file.filename };
  switch (file.status) {
    case 'processing':
      return {
        ...base,
        icon: 'spark',
        label: '解析中',
        meta: '读取文字和位置',
        tone: null,
        busy: true,
      };
    case 'parsed':
      return {
        ...base,
        icon: 'check',
        label: '已解析',
        meta: '可以定位到原文',
        tone: 'ok',
        busy: false,
      };
    case 'needs_review':
      return {
        ...base,
        icon: 'info',
        label: '待核对',
        meta: `${file.reviewItemIds.length} 处`,
        tone: null,
        busy: false,
      };
    case 'unsupported':
      return {
        ...base,
        icon: 'x',
        label: '待换文件',
        meta: file.message,
        tone: 'err',
        busy: false,
      };
    case 'failed':
      return {
        ...base,
        icon: 'x',
        label: '处理中断',
        meta: file.message,
        tone: 'err',
        busy: false,
      };
    case 'original_only':
      return {
        ...base,
        icon: 'archive',
        label: '只保留原件',
        meta: '原件已保存',
        tone: null,
        busy: false,
      };
    case 'attachment_only':
      return {
        ...base,
        icon: 'archive',
        label: '只作附件',
        meta: '只给对整份材料有权限的人看',
        tone: null,
        busy: false,
      };
  }
}

function clock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Where in the original a cited piece sits, in the same words as the source viewer. */
export function where(location: MaterialSourceLocation): string {
  switch (location.kind) {
    case 'document':
      return location.page === undefined
        ? `第 ${location.paragraph} 段`
        : `第 ${location.page} 页 · 第 ${location.paragraph} 段`;
    case 'pdf':
      return `PDF 第 ${location.page} 页`;
    case 'spreadsheet':
      return `「${location.sheet}」${location.cell}`;
    case 'presentation':
      return `演示文稿第 ${location.slide} 页`;
    case 'recording':
    case 'video':
      return `${location.kind === 'video' ? '视频' : '录音'} ${clock(location.startMs)}–${clock(location.endMs)}`;
    case 'image':
      return '截图框选区域';
    case 'code':
      return `${location.path} 第 ${location.startLine}–${location.endLine} 行`;
  }
}

const KIND: Record<MaterialReviewItem['kind'], string> = {
  speaker: '说话人',
  unknown_person: '未知人员',
  image_scope: '图片范围',
  unknown_project: '课题',
  unknown_interviewer: '面试官',
  unknown_interview_candidate: '候选人',
};

type Asked = Pick<MaterialReviewItem, 'kind'> & {
  observedName?: string | null;
  quote?: string | null;
};
/** The question an item asks; a hidden or missing name is left out, never guessed. */
export function question(item: Asked): string {
  const name = item.observedName ? `「${item.observedName}」` : null;
  switch (item.kind) {
    case 'speaker':
      return item.quote ? `「${item.quote}」是谁说的` : '这段话是谁说的';
    case 'unknown_person':
      return name ? `${name}指谁` : '材料里提到的这位是谁';
    case 'image_scope':
      return '截图里要整理哪几行';
    case 'unknown_project':
      return name ? `${name}是哪个课题` : '这件事属于哪个课题';
    case 'unknown_interviewer':
      return name ? `面试官${name}是谁` : '面试官是谁';
    case 'unknown_interview_candidate':
      return name ? `候选人${name}是谁` : '候选人是谁';
  }
}

function names(ids: readonly string[], lookup: ReceiptLookup): string {
  return ids
    .map((id) => lookup.person(id)?.name)
    .filter(Boolean)
    .join('、');
}

/** The answer a resolved item records; a name hidden by permission shows as 已核对 only. */
export function answer(
  item: MaterialReviewResolvedItem,
  lookup: ReceiptLookup,
): string {
  const r = item.resolution;
  switch (r.action) {
    case 'bind':
      return lookup.person(r.personId)?.name ?? '已核对';
    case 'bind_people':
      return names(r.personIds, lookup) || '已核对';
    case 'link_existing_interviewer':
    case 'link_existing_candidate':
      return lookup.person(r.personId)?.name ?? '已核对';
    case 'link_existing_project':
      return lookup.project(r.projectId) ?? '已核对';
    case 'mark_irrelevant':
      return '与这次评价无关';
    case 'keep_original_only':
      return '名单外的人';
    case 'confirm_scope':
      return '整理范围内的部分';
    case 'keep_attachment_only':
      return '只作附件';
    case 'mark_no_project':
      return '明确无课题';
  }
}

function draftCard(
  draft: RecordBatchDraft,
  blocked: ReadonlySet<string>,
  fileNames: ReadonlyMap<string, string>,
  lookup: ReceiptLookup,
): DraftCard {
  const cited = draft.scores.flatMap((score) =>
    score.state === 'suggested' ? score.citations : [],
  );
  const quoted = cited.find((citation) => citation.kind === 'source');
  return {
    key: draft.draftId,
    people: draft.personIds
      .map((id) => lookup.person(id)?.name ?? '')
      .filter(Boolean),
    title: draft.sbi.title,
    quote:
      quoted?.kind === 'source'
        ? {
            text: quoted.quote,
            where: [
              fileNames.get(quoted.reference.originalVersionId),
              where(quoted.reference.location),
            ]
              .filter(Boolean)
              .join(' · '),
          }
        : null,
    scores: draft.scores.map((score) => {
      const key = `${score.personId}:${score.dimensionId}`;
      const dimension = lookup.dimension(score.dimensionId) ?? '维度';
      return score.state === 'suggested'
        ? {
            key,
            dimension,
            state: 'suggested',
            value: score.value,
            anchor: `锚点 ${score.value} · ${score.anchor.text}`,
          }
        : { key, dimension, state: 'unknown', reason: score.reason };
    }),
    held: blocked.has(draft.draftId)
      ? '可能和这次的另一件是同一件事，先决定合并还是分开'
      : null,
  };
}

/** The page's view of one receipt snapshot. Counts come from the receipt only. */
export function receiptView(
  receipt: MaterialBatchReceipt,
  lookup: ReceiptLookup,
): ReceiptView {
  const { files, events, reviewItems } = receipt.counts;
  const reading = receipt.status === 'processing';
  // While files are still read, a zero only means "not yet": leave it out.
  const notYet = (value: number) => (reading && value === 0 ? null : value);
  const blocked = new Set(
    receipt.draftSet?.duplicateCandidates.flatMap((c) => c.draftIds) ?? [],
  );
  // A citation names its original version; the receipt's file line gives it a name.
  const fileNames = new Map(
    receipt.files.flatMap((file) =>
      file.originalVersionId ? [[file.originalVersionId, file.filename]] : [],
    ),
  );
  const people = receipt.personIds.flatMap((id) => {
    const found = lookup.person(id);
    return found ? [{ id, ...found }] : [];
  });
  return {
    batchId: receipt.batchId,
    title:
      files.total > 0
        ? `本次投递 · ${files.total} 个文件`
        : '本次投递 · 一段文字',
    state: STATE[receipt.status],
    error: receipt.error?.message ?? null,
    files: receipt.files.map(fileLine),
    stillReading: reading,
    summary: {
      files: files.total,
      processing: files.processing,
      failed: files.failed,
      unsupported: files.unsupported,
      people: notYet(people.length),
      events: notYet(events.total),
      reviews: notYet(reviewItems),
      awaiting: events.awaiting_confirmation,
      confirmed: events.confirmed,
    },
    reviews: [
      ...receipt.items.map((item) => ({
        key: item.itemId,
        kind: KIND[item.kind],
        question: question(item),
        result: null,
      })),
      ...receipt.resolvedItems.map((item) => ({
        key: item.itemId,
        kind: KIND[item.kind],
        question: question(item),
        result: answer(item, lookup),
      })),
    ],
    drafts: (receipt.draftSet?.drafts ?? []).map((draft) =>
      draftCard(draft, blocked, fileNames, lookup),
    ),
    people,
    hidden: receipt.hasHiddenContent,
  };
}
