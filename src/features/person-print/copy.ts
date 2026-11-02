/**
 * Wording from prototype Y (prototype/y/app/js/pages/person.js, BOW-911) unless marked
 * new. New lines follow docs/ui-copy.md: what is true now and what to do next.
 */
import type { PrintPreview } from './ports';

export const printButton = '打印档案';
export const printTitle = (name: string) => `打印${name}的档案`;
export const printBody =
  '打印的是截至现在已确认的内容；盘点结论以冻结快照为准。打印会记入审计日志。';
export function printFacts(preview: PrintPreview): [string, string] {
  const will = `基本信息、${preview.eventCount} 件关键事件里 ${preview.scoreCount} 条已确认的维度分（附行为锚点、引用、评分人、规则版本和来源位置）${preview.hasSummary ? '、已采纳的 AI 摘要（标明 AI 生成和采纳人）' : ''}${preview.hasFormalPosition ? '、能力象限的正式位置' : ''}`;
  // The prototype counts the hidden material; docs/ui-copy.md (owner ruling) names no count.
  const stays = `${preview.skippedCount ? `跳过的 ${preview.skippedCount} 条分（待确认、待复核或还在评分复核里）、` : ''}待采纳的 AI 摘要、系统给的参考位置${preview.hasHidden ? '，以及按权限隐藏的资料' : ''}`;
  return [will, stays];
}
export const cancel = '取消';
export const printAction = '打印';

export const deniedTitle = '这份档案已移出你的导出范围';
export const deniedBody =
  '打印前按你现在的权限重新校验，这个人已移出你的导出范围，这次停在校验这一步。档案打印只对管理者和这个人的归属 HR 开放；这次尝试已记入审计日志。';
export const gotIt = '知道了';

// New: the server entry for the re-check and the audit is not on main yet.
export const notConnectedTitle = '档案打印待接通';
export const notConnectedBody =
  '打印前要按你现在的权限再校验一次，并记入审计日志。这一步接通后，就能在这里打印已确认的内容。';
// New: the preview or the print could not be read; the viewer can try again.
export const previewFailed = '打印内容读取失败，可以再点一次「打印档案」。';
export const printFailed = '打印稿生成失败，可以再点一次「打印」。';

export const printedToast = '已打开打印。只含已确认的内容，已记入审计日志';
export const idleWithEntry =
  '档案请用页面上的「打印档案」打印：打印内容只含已确认的部分，并记入审计日志。';
export const idleWithoutEntry =
  '档案打印只对管理者和这个人的归属 HR 开放，打印内容只含已确认的部分，并记入审计日志。';

export const sheetTerms =
  '截至打印时已确认的内容，按新版本复核过的取复核结果；AI 建议分、待按新版本复核的分、还在评分复核里的分、待采纳的 AI 摘要和参考位置留在系统里；盘点结论以冻结快照为准';
export const sheetFoot = (demo: boolean) =>
  `仅限内部使用 · 本次打印已记入审计日志${demo ? ' · 演示数据，人员均为化名' : ''}`;
