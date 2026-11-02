import type { ShellData } from '@/contracts/shell';
import type {
  ExportScope,
  TodosView,
  VerifyKind,
  WorkbenchRole,
  WorkbenchView,
} from '@/features/workbench/view';

/**
 * Sample views for comparing workbench sections with prototype Y, in particular those
 * whose reads are not on main yet (material checks, node conclusions, export): /work
 * leaves those out. Demo pseudonyms and values from the prototype Y seed
 * (?as=ceo|hrbp|mentor at 2026-09-04); not real people and not a fallback for /work.
 */
const asOf = '2026-09-04';
const mentorTrainees: [string, string, string, string | null][] = [
  ['p-x06', '季思齐', '口语搭子 · 一组', 'he-yining'],
  ['p-x07', '孟映雪', '口语搭子 · 一组', null],
  ['p-x08', '谷嘉树', '口语搭子 · 一组', null],
  ['p-x09', '沈承宇', '口语搭子 · 一组', null],
  ['p-x10', '云致远', '口语搭子 · 一组', null],
  ['p-x11', '孟逸尘', '分镜工厂 · 二组', 'song-xiaoman'],
  ['p-x12', '沈亦初', '分镜工厂 · 二组', null],
  ['p-x13', '季叙白', '分镜工厂 · 二组', null],
  ['p-x14', '方景深', '分镜工厂 · 二组', null],
  ['p-x15', '周初晴', '分镜工厂 · 二组', null],
];

// prototype/y/app/js/data.js and data-intake.js INBOX, the four kinds HR checks.
const verify: [string, VerifyKind, string, string, string][] = [
  [
    'i-meng',
    'unknown_person',
    '录音里的「小孟」指的是谁',
    'W8 导师团复盘',
    '06:15',
  ],
  ['i-spk', 'speaker', '录像里的「说话人 2」是谁', '结营路演录像.mp4', '16:30'],
  [
    'i-xz',
    'unknown_person',
    '评审表第 14 行的「小周」指谁',
    '结营评审表.xlsx',
    '第 14 行',
  ],
  [
    'i-aze',
    'unknown_person',
    '意见表第 8 段的「阿泽」指谁',
    '结营评审意见表.docx',
    '第 8 段',
  ],
  [
    'i-region',
    'image_scope',
    '评审群截图里要整理哪几行',
    '评审群截图.png',
    '第 1 张图',
  ],
  [
    'i-int',
    'unknown_interviewer',
    '面评第 3 页的面试官「Kevin」是谁',
    '北森面评导出 · 2026-07.pdf',
    '第 3 页',
  ],
];
const hrTodos: TodosView = {
  verify: {
    status: 'ready',
    data: verify.map(([id, kind, question, source, location]) => ({
      id,
      kind,
      question,
      source,
      location,
      deferred: false,
      href: `/inbox#${id}`,
    })),
  },
  conclusion: {
    status: 'ready',
    data: [
      ['nc-fzx', '方知夏'],
      ['nc-glc', '顾临川'],
    ].map(([id, personName]) => ({
      id,
      nodeName: '转正答辩',
      personName,
      waitingJudges: ['叶青'],
      href: `/program-actions?node=pg-def:n0#${id}`,
    })),
  },
  reassign: { status: 'ready', data: { items: 4, evaluators: ['谷牧野'] } },
};

// Export scopes for the dialog sample. HR's first scope and its 近 12 个月 preview are
// what the prototype shows for 苏晚; the other values are sample values.
const preview = (people: number, rows: number, skipped = 0) => ({
  people,
  rows,
  skipped,
});
const exportScopes = (first: string, people: number): ExportScope[] => [
  {
    id: 'all',
    label: first,
    people,
    previews: {
      all: preview(95, 590, 16),
      last12Months: preview(95, 561, 16),
      last3Months: preview(60, 212, 9),
    },
  },
  {
    id: 'b-xe6',
    label: 'XEngineer 第六期',
    people: 93,
    previews: {
      all: preview(93, 580, 16),
      last12Months: preview(93, 552, 16),
      last3Months: preview(58, 205, 9),
    },
  },
  {
    id: 'follow',
    label: '我的关注',
    people: 0,
    previews: {
      all: preview(0, 0),
      last12Months: preview(0, 0),
      last3Months: preview(0, 0),
    },
  },
];

export const sampleViews: Record<WorkbenchRole, WorkbenchView> = {
  manager: {
    role: 'manager',
    displayName: '程远',
    asOf,
    entries: { record: true, findPeople: true },
    accountId: 'sample-ceo',
    namedExamples: true,
    exportable: {
      status: 'ready',
      data: { scopes: exportScopes('全公司范围内的人', 129) },
    },
  },
  hr: {
    role: 'hr',
    displayName: '苏晚',
    asOf,
    entries: { record: true, findPeople: true },
    accountId: 'sample-hrbp',
    namedExamples: true,
    todos: hrTodos,
    exportable: {
      status: 'ready',
      data: { scopes: exportScopes('我负责的人', 95) },
    },
  },
  mentor: {
    role: 'mentor',
    displayName: '叶青',
    asOf,
    entries: { record: true, findPeople: false },
    accountId: 'sample-mentor',
    namedExamples: true,
    exportable: { status: 'not_connected' },
    trainees: {
      status: 'ready',
      data: mentorTrainees.map(([id, name, topic, photo]) => ({
        id,
        name,
        hue: null,
        photo,
        topic,
        activity: {
          status: 'ready',
          data: { recordedThisWeek: 0, lastRecordedOn: '2026-08-28' },
        },
      })),
    },
  },
};

// Role line of the prototype shell (data.js ROLES), so the page above the workbench has
// the same height on both sides.
const roleLines: Record<WorkbenchRole, [label: string, scope: string]> = {
  manager: ['管理者', '公司层：看人、找人，确认规则与方案'],
  hr: ['HR', '人才项目：XEngineer、Landing、校招、黑客松'],
  mentor: ['导师', '分镜工厂 · 二组、口语搭子 · 一组的学员'],
};

export function sampleShell(role: WorkbenchRole): ShellData {
  const view = sampleViews[role];
  return {
    account: {
      id: view.accountId,
      name: view.displayName,
      email: `${role}@sample.test`,
      roles: [role],
      hue: 220,
      roleLabel: roleLines[role][0],
      scopeLabel: roleLines[role][1],
    },
    navigation: [
      { id: 'work', label: '工作台', href: '/work', icon: 'home', group: null },
    ],
    counts: { status: 'not_connected' },
    recent: { status: 'not_connected' },
    canSearch: false,
    isAdmin: false,
    role,
  };
}
