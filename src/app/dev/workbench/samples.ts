import type { ShellData } from '@/contracts/shell';
import type {
  ExportScope,
  ManagerBlocks,
  WatchPerson,
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

// prototype/y/app/index.html?as=ceo at 2026-09-04: 判断提醒, 值得关注的人 (the rows
// shown under 全部), 值得关注的项目 and 我的关注. Rendered only; following, the quick view
// and the project filter wait for their reads.
type WatchSeed = Omit<WatchPerson, 'hue' | 'photo' | 'verifiedBy' | 'concern'> &
  Partial<WatchPerson>;
const watchRow = (person: WatchSeed): WatchPerson => ({
  hue: null,
  photo: person.id === 'p-x06' ? 'he-yining' : null,
  verifiedBy: null,
  concern: null,
  ...person,
});
const managerBlocks: ManagerBlocks = {
  notes: {
    status: 'ready',
    data: [
      {
        kind: 'comparison',
        text: 'XEngineer 第六期 15 人前后判断不一致，HR 归因中',
        href: '/judge',
        detail:
          '综合判断：前段评为最高或最低一档的 50 人里，10 人前段偏高、5 人前段偏低（中间档另看）',
      },
    ],
  },
  watch: {
    status: 'ready',
    data: (
      [
        {
          id: 'p-x63',
          name: '谢云舒',
          title: '全栈方向',
          fate: { text: '去向 X3D', open: false },
          category: 'top',
          brief:
            '进入最佳 AI 探索实践答辩；从组装、走线到无线控制把硬件方案跑通，已能用手机 App 和语音控制小车',
        },
        {
          id: 'p-x86',
          name: '魏予安',
          title: '后端方向',
          fate: { text: '去向 X3D', open: false },
          category: 'top',
          brief:
            '进入最佳 AI 探索实践答辩；产品方向由其提出，中期起担任组长，把分散的挖孔路线收成一条主链',
        },
        {
          id: 'p-x53',
          name: '许承宇',
          title: '前端方向',
          fate: { text: '去向 灵矽', open: false },
          category: 'new',
          brief:
            'W7、W8 两周观察都写到语音核心模块由许承宇完成；黑客松赛前没有方言数据，自录样本当晚接通了方言识别',
          verifiedBy: '苏晚',
        },
        {
          id: 'p-x01',
          name: '苏少卿',
          title: '产品方向',
          fate: { text: '去向 业务成功部 TS', open: false },
          category: 'new',
          brief:
            '内生动力已有 3 件事印证，例如「当组长的同时，搭起线索到 CRM 准入的运营工作台」',
        },
        {
          id: 'p-x06',
          name: '季思齐',
          title: '产品方向',
          fate: { text: '未接受 offer', open: true },
          category: 'act',
          brief:
            '获优秀学员提名，没有接受正式 offer；「值得聊一聊」打开 15 天，还没有约谈记录',
          concern: '未接受 offer',
        },
      ] satisfies WatchSeed[]
    ).map(watchRow),
  },
  programs: {
    status: 'ready',
    data: [
      {
        id: 'pg-xe6',
        name: 'XEngineer 第六期',
        kind: 'XEngineer',
        href: '/programs',
        stage: '结营评审',
        notes: [],
        tags: [
          { text: '12 人新进入值得关注', href: null },
          { text: '留用与落位 47 人待 HR 确认', href: '/programs' },
        ],
      },
      {
        id: 'pg-land4',
        name: 'Landing 第四期',
        kind: 'Landing',
        href: '/programs',
        stage: '入营名单确定 · 35 人',
        notes: ['8 人部门待定'],
        tags: [{ text: '10 人新进入值得关注', href: null }],
      },
      {
        id: 'pg-campus27',
        name: '2027 届校招 · 提前批',
        kind: '校招',
        href: '/programs',
        stage: '提前批 offer 锁定 · 21 人',
        notes: [],
        tags: [{ text: '10 人新进入值得关注', href: null }],
      },
      {
        id: 'pg-hack',
        name: '夏季黑客松（演示）',
        kind: '黑客松',
        href: '/projects',
        stage: '评审结束',
        notes: [],
        tags: [{ text: '2 人新进入值得关注', href: null }],
      },
      {
        id: 'pg-def',
        name: '试用期转正答辩 · 9 月（演示）',
        kind: null,
        href: '/program-actions?node=pg-def:n0',
        stage: '转正答辩 · 2 人',
        notes: [],
        tags: [],
      },
    ],
  },
  follows: {
    status: 'ready',
    data: {
      people: [
        {
          id: 'p-x11',
          name: '孟逸尘',
          hue: null,
          photo: 'song-xiaoman',
          followedOn: '2026-08-20',
          latest: '09-02 叶青推荐适合做后端研发',
        },
        {
          id: 'p-x06',
          name: '季思齐',
          hue: null,
          photo: 'he-yining',
          followedOn: '2026-08-12',
          latest: '08-28 完成“最佳产品奖”申报 PPT 的内容',
        },
        {
          id: 'p-x01',
          name: '苏少卿',
          hue: null,
          photo: null,
          followedOn: '2026-08-05',
          latest: null,
        },
      ],
      updates: [
        {
          personId: 'p-x11',
          name: '孟逸尘',
          hue: null,
          photo: 'song-xiaoman',
          text: '叶青推荐适合做后端研发',
          on: '2026-09-02',
          kind: '推荐方向',
          by: '苏晚',
        },
        {
          personId: 'p-x06',
          name: '季思齐',
          hue: null,
          photo: 'he-yining',
          text: '完成“最佳产品奖”申报 PPT 的内容以及最终路演 …',
          on: '2026-08-28',
          kind: '关键事件',
          by: '叶青',
        },
      ],
    },
  },
};

export const sampleViews: Record<WorkbenchRole, WorkbenchView> = {
  manager: {
    role: 'manager',
    displayName: '程远',
    asOf,
    entries: { record: true, findPeople: true },
    accountId: 'sample-ceo',
    namedExamples: true,
    manager: managerBlocks,
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
