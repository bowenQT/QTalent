import type {
  MaterialBatchInput,
  MaterialBatchReadResult,
  MaterialBatchReceipt,
  MaterialBatchSubmitResult,
} from '@/contracts/materials';
import type {
  RecordBatchDraft,
  RecordSaveInput,
  RecordSaveResult,
  RecordUndoInput,
  RecordUndoResult,
} from '@/contracts/record';
import type { LoadSource } from '@/features/sources/SourceCite';

export type RecordSaveReceipt = Extract<
  RecordSaveResult,
  { status: 'success' }
>['result'];
export type RecordScore = RecordBatchDraft['scores'][number];
export type RecordSbi = RecordBatchDraft['sbi'];
export type BatchReceipt = MaterialBatchReceipt;

/**
 * 服务端按「当前账号对所选人员唯一有效的评价节点」推导的结果（所有者裁决 #248 6564917769）。
 * 页面不猜节点、不取第一个：只有 unique 才提交，其余写明原因。
 */
export type NodeResolution =
  | { status: 'unique'; evaluationNodeId: string }
  | { status: 'multiple' }
  | { status: 'none' }
  /** 服务端这次读不到关系（不说原因），稍后再试。 */
  | { status: 'unavailable' };

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
  /** null：服务端推导入口待接通（845），页面写明待接通，不提交。 */
  resolveNode:
    | ((input: {
        personIds: string[];
        projectId: string | null;
      }) => Promise<NodeResolution>)
    | null;
  submit(input: MaterialBatchInput): Promise<MaterialBatchSubmitResult>;
  readBatch(input: { batchId: string }): Promise<MaterialBatchReadResult>;
  save(input: RecordSaveInput): Promise<RecordSaveResult>;
  undo(input: RecordUndoInput): Promise<RecordUndoResult>;
  loadSource: LoadSource;
};

/** 由页面的 URL 与会话暂存解析出的进入方式（原话永远不进 URL）。 */
export type RecordEntry = {
  /** `?person=`：预选的人；不在可记录选项里则忽略。 */
  personId?: string | null;
  /** `?draft=work`：读取工作台交接的会话暂存。 */
  handoff?: boolean;
  /** `?batch=`：整理进行中刷新或返回，继续读这个批次。 */
  batchId?: string;
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
