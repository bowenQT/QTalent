import type { SourceLocation } from '@/contracts/sources';

const KIND_NAME: Record<SourceLocation['kind'], string> = {
  document: '文档',
  spreadsheet: '表格',
  recording: '录音',
  snapshot_field: '原型基线',
};

/** 来源类型名，只由位置种类推出：契约里 sourceType 与 location.kind 一致，基线来源固定是快照字段。 */
export function sourceTypeName(kind: SourceLocation['kind']): string {
  return KIND_NAME[kind];
}

function clock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** 位置文字。基线来源只显示原文位置（有才显示），字段路径不对用户展示。 */
export function formatLocation(location: SourceLocation): string {
  switch (location.kind) {
    case 'document':
      return location.page === undefined
        ? `第 ${location.paragraph} 段`
        : `第 ${location.page} 页 · 第 ${location.paragraph} 段`;
    case 'spreadsheet':
      return `「${location.sheet}」${location.cell}`;
    case 'recording':
      return `${clock(Math.floor(location.startMs / 1000))}–${clock(Math.ceil(location.endMs / 1000))}`;
    case 'snapshot_field':
      return location.originalLocation ?? '快照字段';
  }
}
