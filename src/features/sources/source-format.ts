import type {
  MaterialSourceLocation,
  SourceLocation,
} from '@/contracts/sources';

/** P0 读取的四种位置，加上 BOW-897 采集契约的 PDF、演示文稿、视频、图片与代码。 */
export type AnyLocation = SourceLocation | MaterialSourceLocation;
export type LocationKind = AnyLocation['kind'];

const KIND_NAME: Record<LocationKind, string> = {
  document: '文档',
  pdf: 'PDF',
  spreadsheet: '表格',
  presentation: '演示文稿',
  recording: '录音',
  video: '视频',
  image: '图片',
  code: '代码',
  snapshot_field: '原型基线',
};

/** 来源类型名，只由位置种类推出：契约里 sourceType 与 location.kind 一致，基线来源固定是快照字段。 */
export function sourceTypeName(kind: LocationKind): string {
  return KIND_NAME[kind];
}

/** 毫秒按整秒写成 mm:ss；分钟不折算成小时，和原型的录音时间一致。 */
export function clock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** 时间段向外取整：起点向下、终点向上，保证引用的那几秒都在范围里。 */
export function timeRange(startMs: number, endMs: number): string {
  return `${clock(Math.floor(startMs / 1000))}–${clock(Math.ceil(endMs / 1000))}`;
}

function lines(startLine: number, endLine: number): string {
  return startLine === endLine
    ? `第 ${startLine} 行`
    : `第 ${startLine}–${endLine} 行`;
}

/**
 * 位置文字。基线来源只显示原文位置（有才显示），字段路径不对用户展示。PDF 的文字范围
 * 和图片的坐标由查看器标在原件上，文字里只写页和「框选区域」。
 */
export function formatLocation(location: AnyLocation): string {
  switch (location.kind) {
    case 'document':
      return location.page === undefined
        ? `第 ${location.paragraph} 段`
        : `第 ${location.page} 页 · 第 ${location.paragraph} 段`;
    case 'pdf':
      return `第 ${location.page} 页`;
    case 'spreadsheet':
      return `「${location.sheet}」${location.cell}`;
    case 'presentation':
      return `第 ${location.slide} 页`;
    case 'recording':
    case 'video':
      return timeRange(location.startMs, location.endMs);
    case 'image':
      return '框选区域';
    case 'code':
      return `${location.path} ${lines(location.startLine, location.endLine)}`;
    case 'snapshot_field':
      return location.originalLocation ?? '快照字段';
  }
}
