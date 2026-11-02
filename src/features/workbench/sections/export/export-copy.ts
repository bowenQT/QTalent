import type { ExportRange } from '../../view';

export const exportRanges: readonly ExportRange[] = [
  'all',
  'last12Months',
  'last3Months',
];

export const rangeLabel: Record<ExportRange, string> = {
  all: '全部时间',
  last12Months: '近 12 个月',
  last3Months: '近 3 个月',
};

// Verbatim from prototype/y/app/js/pages/workbench.js (export), except the failure
// line, which names the reason the run reports instead of always a timeout.
export const exportCopy = {
  basis:
    '截至导出时已确认的关键事件与维度分，按新版本复核过的取复核结果；AI 建议分、待按新版本复核的分和还在评分复核里的分留在系统里；盘点结论以冻结快照为准',
  caption:
    '每行是一条已确认的维度分，附行为锚点、原文引用、评分人、规则版本和来源位置。只含你查看范围内的人；象限位置和盘点结论以盘点冻结快照为准，到盘点里查看。导出会记入审计日志。',
  skipped: (count: number) =>
    `已跳过 ${count} 条待确认、待复核或还在评分复核里的分`,
  pickAnother: '换一个范围或时间再生成',
  busy: (label: string) => `正在生成「${label}」的表格，只取已确认的内容…`,
  denied:
    '生成前按你现在的视角重新校验，批量导出只对管理者和 HR 开放；这次尝试已记入审计日志。',
  empty: (label: string) =>
    `生成时「${label}」里已确认的内容 0 条，换一个范围或时间再导出。`,
  failed: (reason: string) =>
    `${reason}，文件待重新生成；这次失败已记入审计日志。`,
  unreachable: '连接中断',
  done: (label: string, people: number, rows: number, at: string) =>
    `${label}，${people} 人、${rows} 条已确认的维度分。表头写明了导出时间 ${at} 和口径，盘点结论以冻结快照为准；已记入审计日志。`,
} as const;
