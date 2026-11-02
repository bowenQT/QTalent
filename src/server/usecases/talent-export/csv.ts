import { TalentExportError, type ExportProjection } from './types';
export const EXPORT_BASIS =
  '截至导出时已确认的关键事件与维度分；AI 建议分、待确认、待复核和仍在评分复核队列的分不进入表格；盘点结论以冻结快照为准。';
/** Quote every cell and neutralize spreadsheet formulas, including invisible
 * prefix characters. No text from a record may become executable cell content.
 */
export function csvCell(value: string | number | null) {
  let text = value === null ? '' : String(value);
  if (
    /^[\p{White_Space}\p{Cf}\p{Cc}]*[=+\-@]/u.test(text) ||
    /^[\t\r\n]/u.test(text)
  )
    text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function exportTimestamp(now: Date) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw new TalentExportError('unavailable');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}
export function buildExportCsv(projection: ExportProjection, now: Date) {
  const at = exportTimestamp(now);
  const range = {
    all: '全部时间',
    last12Months: '近12个月',
    last3Months: '近3个月',
  }[projection.range];
  const lines: (string | number | null)[][] = [
    ['导出时间（Asia/Shanghai）', at],
    ['导出人', projection.actorName],
    ['口径', EXPORT_BASIS],
    ['范围', `${projection.scopeLabel} · ${range}`],
    ['业务口径截至', projection.asOf],
    ['导出人数', projection.people],
    ['已确认维度分条数', projection.rows],
    ['已跳过（仅权限内）', projection.skipped],
    [
      '说明',
      projection.data.every((r) => r.demo)
        ? '演示数据，人员均为化名'
        : '演示记录在各行单独标记',
    ],
    [],
    [
      '人员',
      '组织',
      '事件日期',
      '关键事件',
      '情境',
      '行为',
      '影响',
      '维度',
      '分数',
      '行为锚点',
      '原文引用',
      '评分人',
      '评价规则版本',
      '确认时间',
      '确认性质',
      '数据标记',
      '来源位置',
    ],
    ...projection.data.map((r) => [
      r.personName,
      r.organization,
      r.eventDate,
      r.title,
      r.situation,
      r.behavior,
      r.impact,
      r.dimension,
      r.value,
      r.anchor,
      r.quote,
      r.evaluatorName,
      r.ruleVersionId.replace(/^rubric-(v[1-9]\d*)$/, '评价规则 $1'),
      r.confirmedAt,
      r.sourceCategory === 'prototype_baseline'
        ? '演示基线（无人工确认时刻）'
        : '人工确认',
      r.demo ? '演示' : '业务原件',
      (r.sources.length === 1 && r.exactSource ? '来源：' : '全部来源：') +
        JSON.stringify(
          r.sources.map((s) => ({
            originalTitle: s.originalTitle,
            originalVersionId: s.originalVersionId,
            fragmentId: s.fragmentId,
            location: s.location,
          })),
        ),
    ]),
  ];
  return {
    csv:
      '\ufeff' +
      lines.map((row) => row.map(csvCell).join(',')).join('\r\n') +
      '\r\n',
    at,
    fileName: `confirmed-content-${now.toISOString().replaceAll(/[-:.]/g, '')}.csv`,
  };
}
