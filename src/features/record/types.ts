import type { z } from 'zod';
import type { JobCommand, JobResponse } from '@/contracts/jobs';
import type {
  recordJobSchema,
  recordOpenDraftResultSchema,
  recordSelectionResultSchema,
  recordStartResultSchema,
  RecordArrangeResult,
  RecordDraft,
  RecordInput,
  RecordSaveInput,
  RecordSaveResult,
  RecordSelectionInput,
  RecordUndoInput,
  RecordUndoResult,
} from '@/contracts/record';
import type { LoadSource } from '@/features/sources/SourceCite';

export type RecordJob = z.infer<typeof recordJobSchema>;
export type RecordStartResult = z.infer<typeof recordStartResultSchema>;
export type RecordSelectionResult = z.infer<typeof recordSelectionResultSchema>;
export type RecordOpenDraftResult = z.infer<typeof recordOpenDraftResultSchema>;
export type RecordSaveReceipt = Extract<
  RecordSaveResult,
  { status: 'success' }
>['result'];
export type RecordScore = RecordDraft['scores'][number];
export type RecordSelection = RecordDraft['project'];
export type RecordSbi = RecordDraft['sbi'];
export type RecordSelectionRequired = Extract<
  RecordArrangeResult,
  { state: 'selection_required' }
>;

/** 页面读取给出的、当前账号有记录权限的人。草稿里只有 id，姓名和头像都从这里翻译。 */
export type PersonOption = {
  id: string;
  name: string;
  hue: number;
  photo: string | null;
  orgShort: string;
};
export type ProjectOption = {
  id: string;
  name: string;
  kind: 'project' | 'topic';
};
export type DimensionOption = { id: string; name: string };

/** 一个维度在某个规则版本、某位被记录人岗位族下的五档锚点（缺口 G6）。 */
export type AnchorSet = {
  ruleVersion: string;
  /** 专业度的岗位族说明，例如「某某属于研发族 · 研发族锚点」；其他维度为 null。 */
  family: string | null;
  levels: readonly [string, string, string, string, string];
};
/** personId → dimensionId → 锚点 */
export type AnchorMap = Record<string, Record<string, AnchorSet>>;
export type LoadAnchors = (input: {
  personIds: string[];
  ruleVersions: string[];
}) => Promise<AnchorMap>;

/**
 * 服务端能力以函数属性从页面传入；这里不引用 server/。
 * 网络失败时这些函数应当 reject，页面据此保留输入并提供重试。
 */
export type RecordActions = {
  start(input: RecordInput): Promise<RecordStartResult>;
  selectPeople(input: RecordSelectionInput): Promise<RecordSelectionResult>;
  openDraft(input: { draftId: string }): Promise<RecordOpenDraftResult>;
  save(input: RecordSaveInput): Promise<RecordSaveResult>;
  undo(input: RecordUndoInput): Promise<RecordUndoResult>;
  retryJob(command: JobCommand): Promise<JobResponse<RecordArrangeResult>>;
  loadSource: LoadSource;
};

/** 由页面的 URL 与会话暂存解析出的进入方式（原话永远不进 URL）。 */
export type RecordEntry = {
  /** `?person=`：预选的人；不在可记录选项里则忽略。 */
  personId?: string | null;
  /** `?draft=work`：读取工作台交接的会话暂存。 */
  handoff?: boolean;
  /** `?draftId=`：长任务整理出的待确认草稿，页面已读取好。 */
  draft?: RecordDraft;
  /** `?job=`：整理进行中刷新或返回，重新订阅这个任务。 */
  jobId?: string;
};

export type EditScore = {
  value: number;
  /** 用户已点击确认（保存时未点击的建议分一并确认）。 */
  touched: boolean;
  reason: string;
};
export type ScoreKey = string;
export function scoreKey(personId: string, dimensionId: string): ScoreKey {
  return `${personId}\u0000${dimensionId}`;
}
