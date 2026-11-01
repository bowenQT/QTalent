import type { BadgeTone } from '@/components/ui/Badge';
import type { CandidateStatus, RowState, UnreadReason } from './model';

/** Row state badges (prototype Y import.js STATE). */
export const stateBadge: Record<
  Exclude<RowState, 'skip' | 'dup'>,
  [string, BadgeTone | undefined]
> = {
  confirm: ['待确认是谁', undefined],
  confirmed: ['已确认', 'yes'],
  verify: ['面试官待核对', 'ai'],
  unread: ['有分待补录', 'unknown'],
  unknown: ['待认人', 'unknown'],
  sent: ['已放进待核对', 'ai'],
};

/** The application status as Beisen shows it. */
export const candidateStatusLabel: Record<CandidateStatus, string> = {
  hired: '已录用',
  rejected: '淘汰',
  offer_pending: '已发 offer · 未入职',
  offer_declined: '放弃录用',
};

/** What the page image shows for an unread item. */
export const unreadReasonText: Record<UnreadReason, string> = {
  missing_selection: '这一栏空着',
  multiple_selections: '勾了两个选项',
  options_mismatch: '选项和模板有出入',
  unsupported_graphics: '勾选标记读取失败',
  applicability_unknown: '是否免评待确认',
};

export const notApplicableText = '非管理岗免评';
export const scaleTag = '原量表 · 单独保存';
export const sentToast = '已放进待核对，北森同步后再确认是谁';
/** Not hired: once in review, HR keeps the original only there and nothing is filed. */
export const sentToastNotHired = '已放进待核对，在那里选「只保留原件」，不入档';
export const unknownHired = '同步后再核对一次';
export const unknownNotHired = '放进待核对后选「只保留原件」，不入档';
export const skippedNote =
  '确认是谁以后，淘汰和未入职的候选人跳过，只导入已入职的人';
export const importPending = '导入待接通';
export const actionFailed = '保存失败，已保留当前内容，请稍后再试';
/** A fill-in HR chose that did not reach the server; it stays in the field. */
export const unsavedFill = (item: string, value: string) =>
  value ? `「${item}」选的 ${value} 还没保存` : `「${item}」的清空还没保存`;
export const retrySave = '重试保存';

/** `2026-09-04` or `2026-09-04T09:30` → `09-04`. */
export const monthDay = (iso: string) => iso.slice(5, 10);
/** `2026-09-04T09:30:00` → `09-04 09:30`. */
export const monthDayTime = (iso: string) =>
  `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
export const pagesText = ({ from, to }: { from: number; to: number }) =>
  from === to ? `第 ${from} 页` : `第 ${from}–${to} 页`;
