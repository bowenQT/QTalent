import type { SourceReference } from '../../src/contracts/sources';
import type { CapabilityScore, Person } from '../../src/contracts/person';
import type { PeopleList } from '../../src/contracts/people';
import type { Workbench } from '../../src/contracts/workbench';

// Entirely synthetic examples, not prototype import fallbacks or real evidence.
export const source = {
  fragmentId: 'test-source-001',
  originalVersionId: 'test-version-001',
  location: { kind: 'document', page: 1, paragraph: 'test-paragraph-001' },
} satisfies SourceReference;
export const identity = {
  id: 'test-person-001',
  demo: true,
  name: '演示测试甲',
  teamId: 'test-team-001',
  teamName: '演示团队',
  jobTitle: '演示岗位',
};
export const confirmedScore = {
  id: 'test-score-001',
  dimensionId: 'test-dimension-001',
  dimensionLabel: '演示维度',
  status: 'confirmed',
  sourceCategory: 'original',
  value: 3,
  anchor: '合成行为锚点，仅供测试',
  scoredBy: 'test-rater-001',
  ruleVersionId: 'test-rule-version-001',
  sources: [source],
} satisfies CapabilityScore;
const statement = {
  id: 'test-statement-001',
  text: '合成事实，仅供测试',
  nature: 'original_fact' as const,
  sources: [source],
};
const empty = { status: 'empty' as const };
const missing = {
  status: 'insufficient_evidence' as const,
  reason: '合成缺口：尚无可追溯的确认分',
};
const unknown = { status: 'unknown' as const, reason: '合成未知：尚不能确定' };
const notConnected = { status: 'not_connected' as const };
const mentor: Person = {
  role: 'mentor',
  person: identity,
  summary: { status: 'ready', data: [statement] },
  capabilityProfile: { status: 'ready', data: [confirmedScore] },
  timeline: {
    status: 'ready',
    data: [
      { id: 'test-event-001', occurredAt: '2026-09-04T00:00:00Z', statement },
    ],
  },
  projects: {
    status: 'ready',
    data: [
      { id: 'test-project-001', name: '演示项目', participation: 'member' },
    ],
  },
  aiInferences: empty,
};
const manager: Person = {
  ...mentor,
  role: 'manager',
  referencePosition: missing,
  managementObservations: {
    status: 'ready',
    data: [
      {
        id: 'test-observation-001',
        text: '合成管理观察',
        nature: 'management_observation',
        sources: [source],
      },
    ],
  },
  calibrationHistory: notConnected,
  versionsAndChanges: notConnected,
};
const mentorQuick = {
  role: 'mentor' as const,
  person: identity,
  summary: mentor.summary,
  capabilityProfile: missing,
  projects: mentor.projects,
};
const managerQuick = {
  ...mentorQuick,
  role: 'manager' as const,
  referencePosition: missing,
};
const people: PeopleList[] = [
  { role: 'manager', people: [managerQuick], total: 1 },
  { role: 'hr', people: [], total: 0 },
  { role: 'mentor', people: [mentorQuick], total: 1 },
];
const person: Person[] = [
  manager,
  mentor,
  {
    ...manager,
    role: 'hr',
    summary: empty,
    capabilityProfile: missing,
    timeline: unknown,
    projects: empty,
    aiInferences: {
      status: 'ready',
      data: [
        {
          id: 'test-inference-001',
          text: '合成 AI 推断，不是人工结论',
          nature: 'ai_inference',
          sources: [source],
        },
      ],
    },
  },
];
const workbench: Workbench[] = [
  {
    role: 'manager',
    greeting: { displayName: '演示管理者' },
    entries: ['people', 'projects', 'find_people'],
    findPeople: { status: 'ready', action: 'find_people' },
    judgmentReminders: notConnected,
    noteworthyPeople: notConnected,
    noteworthyProjects: notConnected,
    myWatch: notConnected,
  },
  {
    role: 'hr',
    greeting: { displayName: '演示 HR' },
    entries: ['people', 'projects'],
    changedPeople: notConnected,
    judgmentComparison: notConnected,
    todos: notConnected,
    materialTasks: notConnected,
  },
  {
    role: 'mentor',
    greeting: { displayName: '演示导师' },
    entries: ['people', 'record'],
    trainees: { status: 'ready', data: [mentorQuick] },
    todos: notConnected,
    recommendations: notConnected,
    materialTasks: notConnected,
  },
];
const sources = [
  {
    status: 'success',
    source: {
      ...source,
      excerpt: '合成原文，仅供测试',
      sourceCategory: 'original',
      sourceType: 'document',
      demo: true,
    },
  },
  {
    status: 'success',
    source: {
      fragmentId: 'test-source-002',
      originalVersionId: 'test-version-002',
      location: { kind: 'recording', startMs: 0, endMs: 1000 },
      excerpt: '合成录音原文',
      sourceCategory: 'original',
      sourceType: 'recording',
      demo: true,
    },
  },
  {
    status: 'success',
    source: {
      fragmentId: 'test-source-baseline',
      originalVersionId: 'test-version-baseline',
      location: {
        kind: 'snapshot_field',
        fieldPath: 'events[test-event-001].act',
      },
      excerpt: '合成的快照评语，仅供测试',
      sourceType: 'prototype_snapshot',
      sourceCategory: 'prototype_baseline',
      displayNotice: '原型基线 2e51b50，评语按原意压缩',
      demo: true,
    },
  },
  { status: 'forbidden', message: '当前无权读取该来源' },
  { status: 'not_found', message: '未找到该来源' },
  { status: 'conflict', message: '来源版本不匹配' },
  {
    status: 'validation_error',
    fieldErrors: { fragmentId: ['缺少片段标识'] },
    input: {},
  },
];
export const fixtures = { people, person, workbench, sources };
