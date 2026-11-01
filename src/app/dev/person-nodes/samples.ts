import type { Person } from '@/contracts/person';
import type { SourceReadResult, SourceReference } from '@/contracts/sources';
import {
  NODE_RECORDS_NOT_CONNECTED,
  type NodeRecords,
} from '@/features/person/node-records';

/**
 * `/dev/person-nodes` 的样例：一位演示员工的档案，加上三类节点记录。人和事都取自原型 Y
 * 的面评导入（`data-intake.js` 第 1–2 页那一行）与转正答辩节点，全部是化名并标「演示」。
 */
const asOf = '2026-09-04';
const doc = (id: string, page: number): SourceReference => ({
  fragmentId: `dev-fragment-${id}`,
  originalVersionId: `dev-version-${id}`,
  location: { kind: 'document', page, paragraph: '1' },
});
const recording = (id: string, startMs: number, endMs: number) => ({
  fragmentId: `dev-fragment-${id}`,
  originalVersionId: `dev-version-${id}`,
  location: { kind: 'recording' as const, startMs, endMs },
});
const interviewSource = doc('interview', 1);
const defenseSource = recording('defense', 370_000, 930_000);
const observationSource = doc('observation', 1);

const EXCERPTS: Record<string, [string, string]> = {
  [interviewSource.fragmentId]: [
    '项目经历讲得具体，能说清自己负责的部分',
    '北森面评导出 · 2026-07.pdf（演示）',
  ],
  [defenseSource.fragmentId]: [
    '我先在测试环境把客户的报错复现出来，再按时间线排除了网关和缓存，最后定位到重试配置',
    '转正答辩会议转录（演示）',
  ],
  [observationSource.fragmentId]: [
    '最近两次站会都主动接了别人卡住的工单，还把排查记录贴进了群里。',
    '一对一记录 · 9 月（演示）',
  ],
};

/** 样例的引用原文：按片段返回，未知片段按「不存在」处理。 */
export async function loadSampleSource(
  reference: Pick<SourceReference, 'fragmentId' | 'originalVersionId'>,
): Promise<SourceReadResult> {
  const known = [interviewSource, defenseSource, observationSource].find(
    (source) => source.fragmentId === reference.fragmentId,
  );
  const detail = EXCERPTS[reference.fragmentId];
  if (!known || !detail)
    return { status: 'not_found', message: '这段原文已不在档案里' };
  return {
    status: 'success',
    source: {
      ...known,
      excerpt: detail[0],
      originalTitle: detail[1],
      recordedByName: '苏晚演示',
      sourceType: known.location.kind,
      sourceCategory: 'original',
      demo: true,
    } as Extract<SourceReadResult, { status: 'success' }>['source'],
  };
}

const identity = {
  id: 'dev-person-001',
  name: '孟逸尘演示',
  hue: 150,
  photo: null,
  demo: true,
  teamId: 'dev-team-001',
  teamName: '业务成功部',
  teamPath: '业务成功部',
  jobTitle: 'TS 工程师',
  level: 'N3',
  batch: null,
  tenureLabel: '入职 2 个月',
};
const eventScore = {
  state: 'confirmed' as const,
  scoreId: 'dev-score-001',
  dimensionId: 'prof',
  dimensionLabel: '专业度',
  value: 4,
  anchor: '锚点 4 · 先复现、再按时间线排除',
  scoredByName: '叶青演示',
  ruleVersionId: 'dev-rule-version-001',
  sourceCategory: 'original' as const,
  sources: [defenseSource],
};
const mentor: Extract<Person, { role: 'mentor' }> = {
  role: 'mentor',
  person: identity,
  asOf,
  landing: null,
  summary: { status: 'empty' },
  capabilityProfile: {
    status: 'ready',
    data: {
      windowFrom: '2025-09-04',
      dimensions: [
        { id: 'prof', label: '专业度', group: 'professional', state: 'scored' },
        {
          id: 'mot',
          label: '内生动力',
          group: 'potential_core',
          state: 'insufficient',
          missing: '待补主动推进的事件',
        },
      ],
      scores: [
        {
          id: 'dev-score-001',
          dimensionId: 'prof',
          dimensionLabel: '专业度',
          status: 'confirmed',
          sourceCategory: 'original',
          value: 4,
          anchor: '锚点 4 · 先复现、再按时间线排除',
          scoredByName: '叶青演示',
          ruleVersionId: 'dev-rule-version-001',
          eventId: 'dev-event-001',
          eventTitle: '讲清楚一次线上排障：先复现、再缩小范围，最后补了监控',
          occurredOn: '2026-09-02',
          sources: [defenseSource],
        },
      ],
    },
  },
  timeline: {
    status: 'ready',
    data: [
      {
        kind: 'key_event',
        id: 'dev-event-001',
        title: '讲清楚一次线上排障：先复现、再缩小范围，最后补了监控',
        occurredOn: '2026-09-02',
        label: 'observation',
        category: 'evaluation',
        sources: [defenseSource],
        recorderName: '叶青演示',
        situation: '试用期转正答辩',
        behavior:
          '我先在测试环境把客户的报错复现出来，再按时间线排除了网关和缓存，最后定位到重试配置',
        impact: null,
        scores: [eventScore],
      },
    ],
  },
  projects: { status: 'empty' },
  aiInferences: { status: 'empty' },
};
const manager: Extract<Person, { role: 'manager' | 'hr' }> = {
  ...mentor,
  role: 'manager',
  referencePosition: {
    status: 'insufficient_evidence',
    reason: '潜力核心还差内生动力的事件',
  },
  calibrationHistory: { status: 'not_connected' },
  versionsAndChanges: { status: 'not_connected' },
};

export const SAMPLE_PEOPLE: Record<'manager' | 'hr' | 'mentor', Person> = {
  manager,
  hr: { ...manager, role: 'hr' },
  mentor,
};

export const SAMPLE_NODE_RECORDS: NodeRecords = {
  interviews: {
    status: 'ready',
    data: [
      {
        kind: 'interview',
        id: 'dev-interview-001',
        title: '校招专业面试通用评价表（北森）',
        occurredOn: '2026-05-08',
        interviewerName: '叶青演示',
        interviewerUnconfirmed: false,
        importedByName: '苏晚演示',
        importedOn: '2026-09-04',
        scale: [
          ['专业基础', '4'],
          ['项目经历', '4'],
          ['学习能力', '5'],
          ['沟通表达', '3'],
          ['管理能力', '非管理岗免评'],
          ['面试结论', '通过'],
        ],
        sources: [interviewSource],
      },
    ],
  },
  conclusions: {
    status: 'ready',
    data: [
      {
        kind: 'node_conclusion',
        id: 'dev-conclusion-001',
        occurredOn: '2026-09-03',
        nodeName: '试用期转正答辩 · 9 月（演示）',
        conclusion: '建议转正',
        basis:
          '两位评委都已确认本人评分；排障和值班两件事都有可见结果，组里沿用了交接文档。',
        version: 1,
        confirmedByName: '苏晚演示',
        sources: [defenseSource],
      },
    ],
  },
  observations: {
    status: 'ready',
    data: [
      {
        kind: 'management_observation',
        id: 'dev-observation-001',
        occurredOn: '2026-08-27',
        text: '最近两次站会都主动接了别人卡住的工单，还把排查记录贴进了群里。',
        authorName: '叶青演示',
        recordedOn: '2026-08-28',
        sources: [observationSource],
      },
    ],
  },
};

/** `records=pending` 看接通前的样子：三类都写「待接入」。 */
export const sampleNodeRecords = (records: string | undefined) =>
  records === 'pending' ? NODE_RECORDS_NOT_CONNECTED : SAMPLE_NODE_RECORDS;
