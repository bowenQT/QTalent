import { expect } from 'vitest';
import type { SourceReference } from '../../src/contracts/sources';
import type {
  CapabilityScore,
  EventScore,
  Person,
  PersonIdentity,
} from '../../src/contracts/person';
import type { PeopleList, QuickView } from '../../src/contracts/people';
import type { Workbench } from '../../src/contracts/workbench';

// Entirely synthetic examples, not prototype import fallbacks or real evidence.
export const asOf = '2026-09-04';
// asOf minus 365 days, boundary day included.
export const windowFrom = '2025-09-04';
export const source = {
  fragmentId: 'test-source-001',
  originalVersionId: 'test-version-001',
  location: { kind: 'document', page: 1, paragraph: 'test-paragraph-001' },
} satisfies SourceReference;
export const source2 = {
  fragmentId: 'test-source-002',
  originalVersionId: 'test-version-002',
  location: { kind: 'spreadsheet', sheet: '演示表', cell: 'B2' },
} satisfies SourceReference;
export const identity: PersonIdentity = {
  id: 'test-person-001',
  name: '演示测试甲',
  hue: 220,
  photo: null,
  demo: true,
  teamId: 'test-team-001',
  teamName: '演示团队',
  teamPath: '演示期 / 演示团队',
  jobTitle: '演示岗位',
  level: '2028 届',
  batch: { id: 'test-batch-001', name: '演示期' },
  tenureLabel: '入营 3 个月',
};
export const identityWithPhoto: PersonIdentity = {
  ...identity,
  photo: 'test-avatar-01',
};
// A person with no batch, no level and no known start date: unknown, not zero.
export const identityNoBatch: PersonIdentity = {
  ...identity,
  id: 'test-person-002',
  level: null,
  batch: null,
  tenureLabel: null,
};

// Profile-side confirmed score (the spectrum projection).
export const confirmedScore = {
  id: 'test-score-001',
  dimensionId: 'test-dimension-001',
  dimensionLabel: '演示维度',
  status: 'confirmed',
  sourceCategory: 'original',
  value: 3,
  anchor: '合成行为锚点，仅供测试',
  scoredByName: '演示评价人',
  ruleVersionId: 'test-rule-version-001',
  eventId: 'test-event-001',
  eventTitle: '合成事件一',
  occurredOn: '2026-08-28',
  sources: [source],
} satisfies CapabilityScore;
// The same score as it appears on its event card.
export const eventConfirmedScore = {
  state: 'confirmed',
  scoreId: 'test-score-001',
  dimensionId: 'test-dimension-001',
  dimensionLabel: '演示维度',
  value: 3,
  anchor: '合成行为锚点，仅供测试',
  scoredByName: '演示评价人',
  ruleVersionId: 'test-rule-version-001',
  sourceCategory: 'original',
  sources: [source],
} satisfies EventScore;
export const conflictScore = {
  state: 'conflict',
  dimensionId: 'test-dimension-004',
  dimensionLabel: '演示冲突维度',
  ratings: [
    {
      scoreId: 'test-score-401',
      value: 4,
      anchor: '合成锚点（较高）',
      scoredByName: '演示评价人甲',
      ruleVersionId: 'test-rule-version-001',
      sourceCategory: 'prototype_baseline',
      sources: [source],
    },
    {
      scoreId: 'test-score-402',
      value: 2,
      anchor: '合成锚点（较低）',
      scoredByName: '演示评价人乙',
      ruleVersionId: 'test-rule-version-001',
      sourceCategory: 'prototype_baseline',
      sources: [source2],
    },
  ],
} satisfies EventScore;

const missing = {
  status: 'insufficient_evidence' as const,
  reason: '合成缺口：尚无可追溯的确认分',
};
const unknown = { status: 'unknown' as const, reason: '合成未知：尚不能确定' };
const empty = { status: 'empty' as const };
const notConnected = { status: 'not_connected' as const };

const keyEvent = <C extends 'evaluation' | 'management-observation'>(
  category: C,
  extra: Partial<{
    id: string;
    title: string;
    occurredOn: string;
    projectName: string | undefined;
    participants: Array<{ name: string; role?: string }>;
    selfRole: string;
    pendingScoreCount: number;
    scores: EventScore[];
  }> = {},
) => ({
  kind: 'key_event' as const,
  id: 'test-event-001',
  title: '合成事件一',
  occurredOn: '2026-08-28',
  // The display label (界面「管理观察」) is independent of the authorization category.
  label: 'observation' as const,
  category,
  sources: [source],
  recorderName: '演示记录人',
  projectName: '演示项目',
  situation: '合成情境，仅供测试',
  behavior: '合成行为，仅供测试',
  impact: null,
  scores: [
    eventConfirmedScore,
    {
      state: 'insufficient' as const,
      dimensionId: 'test-dimension-002',
      dimensionLabel: '演示资料不足维度',
    },
    {
      state: 'absent' as const,
      dimensionId: 'test-dimension-003',
      dimensionLabel: '演示未体现维度',
    },
  ],
  ...extra,
});
export const conflictEvent = (category: 'evaluation' = 'evaluation') => ({
  ...keyEvent(category, {
    id: 'test-event-002',
    title: '合成冲突事件',
    occurredOn: '2026-07-20',
    projectName: undefined,
    participants: [
      { name: '演示参与人甲', role: '负责人' },
      { name: '演示参与人乙' },
    ],
    selfRole: '负责人',
    pendingScoreCount: 1,
    scores: [conflictScore],
  }),
});
export const selfReport = <C extends 'evaluation'>(category: C) => ({
  kind: 'self_report' as const,
  id: 'test-event-003',
  title: '合成自述',
  occurredOn: '2026-06-01',
  label: 'self' as const,
  category,
  sources: [source2],
});
export const history = <C extends 'evaluation' | 'performance'>(
  category: C,
) => ({
  kind: 'history' as const,
  id: `test-history-${category}`,
  title: '合成历史评审',
  occurredOn: '2025-12-31',
  label: 'history' as const,
  category,
  sources: [source],
  scale: [['综合表现', '良好']] as Array<[string, string]>,
});
const profile = {
  status: 'ready' as const,
  data: {
    windowFrom,
    dimensions: [
      {
        id: 'test-dimension-001',
        label: '演示维度',
        group: 'professional' as const,
        state: 'scored' as const,
      },
      {
        id: 'test-dimension-002',
        label: '演示资料不足维度',
        group: 'potential_core' as const,
        state: 'insufficient' as const,
        missing: '近 12 个月没有新的确认分',
      },
    ],
    scores: [confirmedScore],
  },
};
const conclusion = <C extends 'evaluation' | 'quadrant'>(category: C) => ({
  id: 'test-conclusion-001',
  text: '合成人工结论，仅供测试',
  authorName: '演示署名人',
  at: '2026-08-30',
  category,
  sources: [source],
});
const inference = <C extends 'evaluation' | 'quadrant'>(category: C) => ({
  id: 'test-inference-001',
  text: '合成 AI 推断，不是人工结论',
  nature: 'ai_inference' as const,
  category,
  sources: [source],
});
const projects = {
  status: 'ready' as const,
  data: [
    {
      id: 'test-project-001',
      name: '演示项目',
      role: '成员',
      mode: '全职',
      from: '2026-07-01',
      to: null,
    },
    {
      id: 'test-project-002',
      name: '演示已结束项目',
      role: '负责人',
      mode: '兼职',
      from: '2026-03-01',
      to: '2026-06-30',
    },
  ],
};
const landing = { topicName: '演示课题', mentorNames: ['演示导师'] };
const mentor: Person = {
  role: 'mentor',
  person: identity,
  asOf,
  landing,
  summary: { status: 'ready', data: [conclusion('evaluation')] },
  capabilityProfile: profile,
  timeline: {
    status: 'ready',
    data: [
      keyEvent('evaluation'),
      conflictEvent(),
      selfReport('evaluation'),
      history('evaluation'),
    ],
  },
  projects,
  aiInferences: empty,
};
const manager: Person = {
  ...mentor,
  role: 'manager',
  timeline: {
    status: 'ready',
    data: [
      keyEvent('evaluation'),
      keyEvent('management-observation', {
        id: 'test-event-009',
        title: '合成管理观察',
        occurredOn: '2026-08-01',
        scores: [],
      }),
      conflictEvent(),
      selfReport('evaluation'),
      history('performance'),
    ],
  },
  summary: { status: 'ready', data: [conclusion('quadrant')] },
  aiInferences: { status: 'ready', data: [inference('quadrant')] },
  referencePosition: {
    status: 'ready',
    data: {
      kind: 'reference',
      quadrant: 'high_professional_high_potential',
      bonus: true,
    },
  },
  calibrationHistory: notConnected,
  versionsAndChanges: notConnected,
};
const person: Person[] = [
  manager,
  mentor,
  {
    ...manager,
    role: 'hr',
    person: identityNoBatch,
    landing: null,
    summary: empty,
    capabilityProfile: missing,
    timeline: unknown,
    projects: empty,
    aiInferences: { status: 'ready', data: [inference('evaluation')] },
    referencePosition: missing,
  },
];

const quickBody = {
  person: identity,
  projectLoad: { current: 1, ever: 2 },
  recentFacts: {
    status: 'ready' as const,
    data: [
      {
        eventId: 'test-event-001',
        occurredOn: '2026-08-28',
        title: '合成事件一',
        projectName: '演示项目',
        recorderName: '演示记录人',
        sources: [source],
      },
    ],
  },
  capabilityLines: {
    status: 'ready' as const,
    data: {
      lines: [
        {
          dimensionId: 'test-dimension-001',
          dimensionLabel: '演示维度',
          eventCount: 2,
          topAnchor: '合成行为锚点，仅供测试',
        },
      ],
      uncoveredCount: 5,
    },
  },
};
const mentorQuick = { role: 'mentor' as const, ...quickBody };
const managerQuick = {
  role: 'manager' as const,
  ...quickBody,
  referencePosition: {
    status: 'ready' as const,
    data: {
      kind: 'reference' as const,
      quadrant: 'high_professional_low_potential' as const,
    },
  },
};
// Several teams, a repeated name and a polyphonic family name, already in the
// directory order: team name then name by pinyin, then id by code point.
const roster = (
  id: string,
  teamName: string,
  name: string,
): QuickView & { role: 'manager' } => ({
  ...managerQuick,
  person: {
    ...identity,
    id,
    name,
    teamId: `test-team-${teamName}`,
    teamName,
    teamPath: `演示期 / ${teamName}`,
  },
});
export const directoryList: QuickView[] = [
  roster('test-person-101', '丙组演示', '曾演示'),
  roster('test-person-102', '甲组演示', '演示测试甲'),
  roster('test-person-103', '甲组演示', '演示测试甲'),
  roster('test-person-104', '甲组演示', '增演示'),
  roster('test-person-105', '乙组演示', '重演示'),
];
const people: PeopleList[] = [
  { role: 'manager', people: [managerQuick], total: 1 },
  { role: 'hr', people: [], total: 0 },
  { role: 'mentor', people: [mentorQuick], total: 1 },
];

const workbench: Workbench[] = [
  {
    role: 'manager',
    greeting: { displayName: '演示管理者' },
    asOf,
    entries: ['find_people'],
    judgmentReminders: notConnected,
    noteworthyPeople: notConnected,
    noteworthyProjects: notConnected,
    myWatch: notConnected,
  },
  {
    role: 'hr',
    greeting: { displayName: '演示 HR' },
    asOf,
    entries: ['record', 'find_people'],
    changedPeople: notConnected,
    judgmentComparison: notConnected,
    todos: notConnected,
    materialTasks: notConnected,
  },
  {
    role: 'mentor',
    greeting: { displayName: '演示导师' },
    asOf,
    entries: ['record'],
    trainees: {
      status: 'ready',
      data: [
        {
          person: {
            id: identity.id,
            name: identity.name,
            hue: identity.hue,
            photo: null,
          },
          topic: '演示课题',
          activity: {
            status: 'ready',
            data: { recordedThisWeek: 2, lastRecordedOn: '2026-09-03' },
          },
        },
        {
          person: {
            id: 'test-person-201',
            name: '演示学员乙',
            hue: 40,
            photo: 'test-avatar-01',
          },
          // Several topic projects in the batch: the page does not guess.
          topic: null,
          // Known to be zero, as opposed to unknown below.
          activity: {
            status: 'ready',
            data: { recordedThisWeek: 0, lastRecordedOn: null },
          },
        },
        {
          person: {
            id: 'test-person-202',
            name: '演示学员丙',
            hue: 300,
            photo: null,
          },
          topic: '演示课题',
          activity: unknown,
        },
      ],
    },
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
      originalTitle: '合成原件标题',
      recordedByName: '演示记录人',
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
      originalTitle: '合成录音标题',
      // Unknown recorder: null, never the event's recorder.
      recordedByName: null,
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
      originalTitle: '合成基线标题',
      recordedByName: null,
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
export const fixtures = {
  people,
  person,
  workbench,
  sources,
  mentor,
  manager,
  mentorQuick,
  managerQuick,
};

const collator = new Intl.Collator('zh');
/** Directory order: team name then name by pinyin, then id by code point. */
export function expectDirectoryOrder(
  list: ReadonlyArray<{
    person: { id: string; teamName: string; name: string };
  }>,
) {
  const key = (x: { id: string; teamName: string; name: string }) => x;
  const compare = (
    a: { id: string; teamName: string; name: string },
    b: { id: string; teamName: string; name: string },
  ) =>
    collator.compare(a.teamName, b.teamName) ||
    collator.compare(a.name, b.name) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const actual = list.map((x) => key(x.person));
  expect(actual).toEqual([...actual].sort(compare));
}
/** True when none of the key names appears anywhere in the serialized value. */
export function serializedHasNoKeys(value: unknown, keys: readonly string[]) {
  const json = JSON.stringify(value);
  return keys.every((k) => !json.includes(`"${k}"`));
}
