import type {
  MaterialReviewCommand,
  MaterialReviewItem,
  MaterialReviewResolvedItem,
} from '@/contracts/material-review';
import type { MaterialSourceLocation } from '@/contracts/sources';

export type ReviewKind = MaterialReviewItem['kind'];
/** The four kinds this page handles (BOW-862). Projects (BOW-845) and interview
 * candidates (BOW-906's import preview) are resolved on their own pages. */
export const PAGE_KINDS = [
  'speaker',
  'unknown_person',
  'image_scope',
  'unknown_interviewer',
] as const satisfies readonly ReviewKind[];
export type PageKind = (typeof PAGE_KINDS)[number];
export type PageItem = Extract<MaterialReviewItem, { kind: PageKind }>;
export type PageResolved = Extract<
  MaterialReviewResolvedItem,
  { kind: PageKind }
>;

/** Labels from prototype Y `intake.js` (INBOX_KINDS). */
export const KIND_LABEL: Record<PageKind, string> = {
  speaker: '说话人',
  unknown_person: '未知人员',
  image_scope: '图片范围',
  unknown_interviewer: '面试官',
};

export function isPageItem(item: MaterialReviewItem): item is PageItem {
  return (PAGE_KINDS as readonly string[]).includes(item.kind);
}
export function isPageResolved(
  item: MaterialReviewResolvedItem,
): item is PageResolved {
  return (PAGE_KINDS as readonly string[]).includes(item.kind);
}

/** Names the page may show: the candidates it was handed plus the people the
 * resolved items point at. A person missing here reads「已选的人」, never an id. */
export type People = Readonly<Record<string, string>>;

function clock(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Where in the original the question sits, as the card header shows it. */
export function placeText(location: MaterialSourceLocation): string {
  switch (location.kind) {
    case 'document':
      return location.page === undefined
        ? `第 ${location.paragraph} 段`
        : `第 ${location.page} 页 · 第 ${location.paragraph} 段`;
    case 'spreadsheet':
      return `「${location.sheet}」${location.cell}`;
    case 'recording':
    case 'video':
      return clock(location.startMs);
    case 'pdf':
      return `第 ${location.page} 页`;
    case 'presentation':
      return `第 ${location.slide} 页幻灯片`;
    case 'image':
      return '截图';
    case 'code':
      return `${location.path} 第 ${location.startLine}–${location.endLine} 行`;
  }
}

type Asked = Pick<PageItem, 'kind' | 'source'> & {
  observedName?: string | null;
};

/** The one question a card asks, written from contract fields only: no material
 * title, submitter or speaker label is invented. */
export function question(item: Asked): string {
  switch (item.kind) {
    case 'speaker':
      return item.source?.location.kind === 'video'
        ? '录像里的这位说话人是谁？'
        : '录音里的这位说话人是谁？';
    case 'unknown_person':
      return item.observedName
        ? `「${item.observedName}」指谁？`
        : '这一处说的是谁？';
    case 'image_scope':
      return '这张图里要整理哪一部分？';
    case 'unknown_interviewer':
      return item.observedName
        ? `面评里的面试官「${item.observedName}」是谁？`
        : '面评里的这位面试官是谁？';
  }
}

const nameOf = (people: People, id: string) => people[id] ?? '已选的人';

/** The result line in「已核对」: who it went to, or how the material is kept. */
export function resultText(item: PageResolved, people: People): string {
  switch (item.kind) {
    case 'speaker':
      return item.resolution.action === 'bind'
        ? nameOf(people, item.resolution.personId)
        : '与这份材料无关';
    case 'unknown_person':
      return item.resolution.action === 'bind_people'
        ? item.resolution.personIds.map((id) => nameOf(people, id)).join('、')
        : '名单外的人，只留在原件里';
    case 'image_scope':
      return item.resolution.action === 'confirm_scope'
        ? '整理框出的范围'
        : '整张只作附件';
    case 'unknown_interviewer':
      return `关联到${nameOf(people, item.resolution.personId)}`;
  }
}

/** Why a resolved item stays as it is; wording from prototype `LOCK_TEXT`. */
export const LOCK_TEXT = {
  dependent_draft_confirmed: '建议分已确认',
  interview_row_imported: '已随导入写进档案',
} as const;

export type Resolution = Extract<
  MaterialReviewCommand,
  { kind: PageKind }
>['resolution'];

/** The toast after a choice took effect; wording from prototype `inbox.js`. */
export function doneText(resolution: Resolution, people: People): string {
  switch (resolution.action) {
    case 'defer':
      return '已放到稍后处理，待办里仍会保留';
    case 'keep_original_only':
      return '已记下：名单外的人，只留在原件里';
    case 'keep_attachment_only':
      return '这张图只作附件保存';
    case 'link_existing_interviewer':
      return `已关联到${nameOf(people, resolution.personId)}，面评那一行可以导入了`;
    case 'bind':
      return `已归到${nameOf(people, resolution.personId)}`;
    case 'bind_people':
      return `已归到${resolution.personIds.map((id) => nameOf(people, id)).join('、')}`;
    case 'confirm_scope':
      return '已整理框出的范围';
    case 'mark_irrelevant':
      return '已记下：与这份材料无关';
    case 'unbind':
      return '已解除这位说话人的绑定';
  }
}

/**
 * Kinds that still have open items, in the prototype's order, for the filter chips.
 * `isOpen` lets the page count deferred items brought back with「继续核对」.
 */
export function openKinds(
  items: readonly PageItem[],
  isOpen: (item: PageItem) => boolean = (item) => item.state === 'pending',
): PageKind[] {
  return PAGE_KINDS.filter((kind) =>
    items.some((item) => item.kind === kind && isOpen(item)),
  );
}

/** A stable avatar hue for a person id; the contract carries no colour. */
export function hueOf(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}
