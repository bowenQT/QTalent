import type { MaterialSource, Source } from '@/contracts/sources';
import type { AnyLocation } from './source-format';

/** 这条出处属于哪一类，决定查看器上的来源标签和提示。 */
export type ViewerProvenance =
  | { kind: 'original' }
  | { kind: 'historical_evaluation' }
  | { kind: 'submitted_code_snapshot'; notice: string }
  | { kind: 'prototype_baseline'; notice: string };

/** 查看器只认这一种形状：P0 读取结果和 BOW-897 材料来源都先转成它。 */
export type ViewerSource = {
  fragmentId: string;
  originalVersionId: string;
  location: AnyLocation;
  excerpt: string;
  /** P0 读取带原件标题；897 的材料来源不带，查看器改用类型名。 */
  title: string | null;
  /** null 表示记录人未知，不拿事件记录人代替。 */
  recordedByName: string | null;
  demo: boolean;
  provenance: ViewerProvenance;
};

export function fromSource(source: Source): ViewerSource {
  return {
    fragmentId: source.fragmentId,
    originalVersionId: source.originalVersionId,
    location: source.location,
    excerpt: source.excerpt,
    title: source.originalTitle,
    recordedByName: source.recordedByName,
    demo: source.demo,
    provenance:
      source.sourceCategory === 'prototype_baseline'
        ? { kind: 'prototype_baseline', notice: source.displayNotice }
        : { kind: 'original' },
  };
}

export function fromMaterialSource(source: MaterialSource): ViewerSource {
  return {
    fragmentId: source.fragmentId,
    originalVersionId: source.originalVersionId,
    location: source.location,
    excerpt: source.excerpt,
    title: null,
    recordedByName: null,
    demo: source.demo,
    provenance:
      source.sourceCategory === 'submitted_code_snapshot'
        ? { kind: 'submitted_code_snapshot', notice: source.displayNotice }
        : { kind: source.sourceCategory },
  };
}

export type TranscriptSegment = {
  startMs: number;
  endMs: number;
  speaker?: string;
  text: string;
};
type Media = {
  segments: TranscriptSegment[];
  /** 短时有效的授权播放地址；转写已有、播放还没接入时为 null。 */
  playback: { url: string } | null;
};

/**
 * 查看器打开原件需要的内容。这是前端对原件读取（BOW-873 授权读取、866 等解析结果）
 * 的接口假设，契约冻结前只由样张和测试提供；服务端只在来源读取通过授权后才给它。
 * 代码出处只有提交的摘录，基线来源只有快照，两者都直接用来源本身，不需要这一份。
 */
export type OriginalContent =
  | {
      kind: 'document';
      paragraphs: { paragraph: string; page?: number; text: string }[];
    }
  /** textRange 是该页提取文字里从 0 起、左闭右开的 UTF-16 偏移，和契约一致。 */
  | { kind: 'pdf'; pages: { page: number; text: string }[] }
  | {
      kind: 'spreadsheet';
      sheet: string;
      cells: { cell: string; text: string }[];
    }
  | { kind: 'presentation'; slides: { slide: number; text: string }[] }
  | ({ kind: 'recording' } & Media)
  | ({ kind: 'video' } & Media)
  | {
      kind: 'image';
      image: { url: string; width: number; height: number };
    };

export type Content<K extends OriginalContent['kind']> = Extract<
  OriginalContent,
  { kind: K }
>;
export type At<K extends AnyLocation['kind']> = Extract<
  AnyLocation,
  { kind: K }
>;

export type OriginalState =
  { status: 'not_connected' } | { status: 'ready'; content: OriginalContent };

/** 内容种类和出处位置对不上时不展示，按原件待接入处理，不在别的原件上标位置。 */
export function contentFor<K extends OriginalContent['kind']>(
  original: OriginalState,
  kind: K,
): Content<K> | null {
  return original.status === 'ready' && original.content.kind === kind
    ? (original.content as Content<K>)
    : null;
}

/** 文字切成引用前、引用、引用后三段；找不到或范围越界时返回 null，不猜位置。 */
export function splitAt(
  text: string,
  start: number,
  end: number,
): [string, string, string] | null {
  if (start < 0 || end > text.length || end <= start) return null;
  return [text.slice(0, start), text.slice(start, end), text.slice(end)];
}

/** 在段落里找引用的原文；段落就是引用本身或找不到时返回 null，整段标出。 */
export function splitExcerpt(
  text: string,
  excerpt: string,
): [string, string, string] | null {
  const start = text.indexOf(excerpt);
  if (start < 0 || excerpt.length === text.length) return null;
  return splitAt(text, start, start + excerpt.length);
}

/** A1 写法的单元格（列字母加行号，从 1 起）；不是单个单元格时返回 null。 */
export function cellPosition(
  cell: string,
): { row: number; column: number } | null {
  const match = /^([A-Z]{1,3})([1-9]\d*)$/i.exec(cell.trim());
  if (!match) return null;
  let column = 0;
  for (const letter of match[1]!.toUpperCase())
    column = column * 26 + (letter.charCodeAt(0) - 64);
  return { row: Number(match[2]), column };
}

export function columnName(column: number): string {
  let name = '';
  for (let rest = column; rest > 0; rest = Math.floor((rest - 1) / 26))
    name = String.fromCharCode(65 + ((rest - 1) % 26)) + name;
  return name;
}

/** 把已有单元格排成网格：行列取所有单元格的最小到最大范围，缺的格留空。 */
export function sheetGrid(cells: { cell: string; text: string }[]): {
  rows: number[];
  columns: number[];
  text: Map<string, string>;
} {
  const text = new Map<string, string>();
  const placed = cells.flatMap((entry) => {
    const position = cellPosition(entry.cell);
    if (!position) return [];
    text.set(`${position.row}:${position.column}`, entry.text);
    return [position];
  });
  const range = (values: number[]) =>
    values.length === 0
      ? []
      : Array.from(
          { length: Math.max(...values) - Math.min(...values) + 1 },
          (_, i) => Math.min(...values) + i,
        );
  return {
    rows: range(placed.map((p) => p.row)),
    columns: range(placed.map((p) => p.column)),
    text,
  };
}

/** 转写的一段和引用的时间段有重叠就算引用到了。 */
export function overlaps(
  segment: { startMs: number; endMs: number },
  startMs: number,
  endMs: number,
): boolean {
  return segment.startMs < endMs && segment.endMs > startMs;
}
