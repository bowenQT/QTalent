import type { SourceReference } from '@/contracts/sources';

/**
 * 档案里与评价节点相关的三类记录。`contracts/person.ts` 还没有它们的字段，这里是本页对
 * 读取的假设，形状取自后端在做的三张卡：北森面评按原量表保存、面试官与导入人分开署名
 * （BOW-906，导入后是 BOW-904 的管理观察）；节点结论按版本保存、HR 署名确认（BOW-902）；
 * 独立管理观察写明谁、何时，不出分（BOW-904）。接通时以服务端最终契约为准。
 *
 * 读取只返回当前视角有权看到的条目；导师视角没有这三类，前端不做权限判断。
 */
export type InterviewRecord = {
  kind: 'interview';
  id: string;
  /** 面评模板名，例如「专业面试（北森）」。 */
  title: string;
  /** 面试日期，不是导入日期。 */
  occurredOn: string;
  interviewerName: string;
  /** 面试官只按面评上的名字记下，系统里还没有确认是哪个人。 */
  interviewerUnconfirmed: boolean;
  importedByName: string;
  importedOn: string;
  /** 原量表，按原文逐项保存，不换算成 1–5。 */
  scale: Array<[string, string]>;
  sources: SourceReference[];
};

export type NodeConclusionRecord = {
  kind: 'node_conclusion';
  id: string;
  /** 当前版本的确认日期。 */
  occurredOn: string;
  /** 节点所在的项目与节点，例如「试用期转正答辩」。 */
  nodeName: string;
  /** 结论类型，例如「建议转正」。 */
  conclusion: string;
  /** HR 确认时写的依据原文。 */
  basis: string;
  version: number;
  confirmedByName: string;
  sources: SourceReference[];
};

export type ObservationRecord = {
  kind: 'management_observation';
  id: string;
  /** 观察发生的日期。 */
  occurredOn: string;
  text: string;
  authorName: string;
  recordedOn: string;
  sources: SourceReference[];
};

export type NodeRecord =
  InterviewRecord | NodeConclusionRecord | ObservationRecord;

type Block<T> = { status: 'not_connected' } | { status: 'ready'; data: T[] };

/** 三类各自接通：哪一类的读取先合入，就先换掉哪一类的「待接入」。 */
export type NodeRecords = {
  interviews: Block<InterviewRecord>;
  conclusions: Block<NodeConclusionRecord>;
  observations: Block<ObservationRecord>;
};

/** 正式路由在三张后端卡合入前的状态。 */
export const NODE_RECORDS_NOT_CONNECTED: NodeRecords = {
  interviews: { status: 'not_connected' },
  conclusions: { status: 'not_connected' },
  observations: { status: 'not_connected' },
};

const LABELS: Record<keyof NodeRecords, string> = {
  interviews: '北森面评',
  conclusions: '节点结论',
  observations: '独立管理观察',
};

/** 还没接通的类别，写成「待接入」，不当作没有记录。 */
export function pendingNodeRecords(records: NodeRecords): string[] {
  return (Object.keys(LABELS) as (keyof NodeRecords)[])
    .filter((key) => records[key].status === 'not_connected')
    .map((key) => LABELS[key]);
}

/** 已接通的条目，和契约里的时间线条目一起按日期排。 */
export function readyNodeRecords(records: NodeRecords): NodeRecord[] {
  return [
    ...(records.interviews.status === 'ready' ? records.interviews.data : []),
    ...(records.conclusions.status === 'ready' ? records.conclusions.data : []),
    ...(records.observations.status === 'ready'
      ? records.observations.data
      : []),
  ];
}
