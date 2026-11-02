import type { ShellData } from '@/contracts/shell';
import type {
  PersonPrintPorts,
  PersonPrintSheet,
  PrintPreview,
  PrintScore,
} from '@/features/person-print/ports';

/**
 * Development samples of the profile print, transcribed from prototype Y's print of the
 * same people (prototype/y/app/js/pages/person.js on the demo seed, #260): pseudonyms
 * only, all marked 演示. `x07` writes one source per event and has no formal position
 * yet; `x03` writes sources per score, one of them for the whole event.
 */
export type SampleRole = 'manager' | 'hr' | 'mentor';
export type SamplePerson = 'x07' | 'x03';
export type SampleMode = 'ok' | 'deny' | 'fail' | 'live';

const rule = '评价规则 v1';
const anchors = {
  pro2: '部分达到本届学员预期',
  pro3: '达到本届学员预期',
  pro4: '超出本届学员预期',
  pro5: '可以承担正式岗位的职责',
  core2: '相关行为偶发，需要他人推动才发生',
  core3: '常规情境下稳定表现出该维度的行为',
  core4: '有难度或模糊的情境下主动表现，并有可见结果',
  core5: '高难情境下表现突出，并带动他人或形成可复用的方法',
};
let next = 0;
function score(
  dimensionLabel: string,
  value: PrintScore['value'],
  anchor: string,
  scoredByName: string,
  quote: string,
  source: string,
  exact = true,
): PrintScore {
  next += 1;
  return {
    id: `sample-score-${next}`,
    dimensionLabel,
    value,
    anchor,
    quote: `引用「${quote}」`,
    scoredByName,
    ruleVersionLabel: rule,
    source: { exact, text: source },
  };
}
const sheetOf = (at: string) => `XEngineer 第六期观察表 · ${at}`;

const x07Sources = {
  w78: sheetOf('W7–W8 · 突出表现 · 第 12 行'),
  hack: '夏季黑客松评审表（演示） · 第 4 行',
  w45: sheetOf('W4–W5 · 突出表现 · 第 12 行'),
  w13: sheetOf('W1–W3 · 待改进 · 第 12 行'),
};
const x07Quotes = {
  lead: '主要负责服务端的主架构，整体代码结构、接口、雅思场景，其他人在TA的基础上去添加',
  wake: '把唤醒词和打断做成两个独立开关',
  arch: '技术架构能力突出，输出的技术方案稳定性强',
  mvp: '独立完成全链路Java架构梳理落地，从零到一实现服务端主流程MVP功能开发，是项…',
  core: '架构能力这一块在组内承担了核心工作',
};

const x03Sources = {
  w78: sheetOf('W7–W8 · 待改进 · 第 8 行'),
  w45good: sheetOf('W4–W5 · 突出表现 · 第 8 行'),
  w45bad: sheetOf('W4–W5 · 待改进 · 第 8 行'),
  w13good: sheetOf('W1–W3 · 突出表现 · 第 8 行'),
  w13both: `${sheetOf('W1–W3 · 突出表现 · 第 8 行')}；${sheetOf('W1–W3 · 待改进 · 第 8 行')}`,
};

const people: Record<
  SamplePerson,
  {
    id: string;
    sheet: Omit<PersonPrintSheet, 'printedByName'>;
    preview: PrintPreview;
  }
> = {
  x07: {
    id: 'p-x07',
    sheet: {
      person: {
        name: '孟映雪',
        demo: true,
        teamPath: 'XEngineer 第六期 / 口语搭子 · 一组',
        jobTitle: '后端方向',
        level: '2027 届',
        tenureLabel: '入营 2 个月',
        batchName: 'XEngineer 第六期',
      },
      printedAt: '2026-09-04 15:00',
      summary: null,
      formalPosition: { status: 'pending' },
      events: [
        {
          id: 'e-x07-4',
          occurredOn: '2026-08-28',
          title: '搭建并优化数据可视化面板',
          projectName: '口语搭子 · 一组',
          recorderName: '叶青',
          scores: [
            score(
              '专业度',
              4,
              anchors.pro4,
              '叶青',
              x07Quotes.lead,
              x07Sources.w78,
            ),
            score(
              '智慧力',
              4,
              anchors.core4,
              '叶青',
              x07Quotes.lead,
              x07Sources.w78,
            ),
          ],
        },
        {
          id: 'e-x07-h',
          occurredOn: '2026-08-21',
          title: '负责语音唤醒与打断，现场演示一次跑通',
          projectName: '夏季黑客松 · 语音助手赛道（演示）',
          recorderName: '许致远',
          scores: [
            score(
              '专业度',
              4,
              anchors.pro4,
              '许致远',
              x07Quotes.wake,
              x07Sources.hack,
            ),
            score(
              '内生动力',
              4,
              anchors.core4,
              '许致远',
              x07Quotes.wake,
              x07Sources.hack,
            ),
          ],
        },
        {
          id: 'e-x07-2',
          occurredOn: '2026-08-07',
          title: '从零搭起服务端主流程 MVP，是核心框架的主要搭建者',
          projectName: '口语搭子 · 一组',
          recorderName: '魏闻笛',
          scores: [
            score(
              '专业度',
              5,
              anchors.pro5,
              '魏闻笛',
              x07Quotes.arch,
              x07Sources.w45,
            ),
            score(
              '智慧力',
              5,
              anchors.core5,
              '魏闻笛',
              x07Quotes.arch,
              x07Sources.w45,
            ),
            score(
              '坚毅力',
              5,
              anchors.core5,
              '魏闻笛',
              x07Quotes.arch,
              x07Sources.w45,
            ),
            score(
              '内生动力',
              4,
              anchors.core4,
              '魏闻笛',
              x07Quotes.mvp,
              x07Sources.w45,
            ),
          ],
        },
        {
          id: 'e-x07-1',
          occurredOn: '2026-07-24',
          title: '架构能力这一块在组内承担了核心工作',
          projectName: '口语搭子 · 一组',
          recorderName: '魏闻笛',
          scores: [
            score(
              '专业度',
              4,
              anchors.pro4,
              '魏闻笛',
              x07Quotes.core,
              x07Sources.w13,
            ),
          ],
        },
      ],
    },
    preview: {
      eventCount: 4,
      scoreCount: 9,
      skippedCount: 0,
      hasSummary: false,
      hasFormalPosition: true,
      hasHidden: false,
    },
  },
  x03: {
    id: 'p-x03',
    sheet: {
      person: {
        name: '谢怀瑾',
        demo: true,
        teamPath: 'XEngineer 第六期 / 线索雷达',
        jobTitle: '全栈方向',
        level: '2028 届',
        tenureLabel: '入营 2 个月',
        batchName: 'XEngineer 第六期',
      },
      printedAt: '2026-09-04 15:00',
      summary: null,
      formalPosition: {
        status: 'ready',
        quadrantLabel: '待观察',
        calibrationLabel: '中期',
        frozenOn: '2026-08-10',
        confirmedByName: '苏晚',
      },
      events: [
        {
          id: 'e-x03-4',
          occurredOn: '2026-08-28',
          title: '移动端发布 CI 问题修复',
          projectName: '线索雷达',
          recorderName: '任辞远',
          scores: [
            score(
              '专业度',
              2,
              anchors.pro2,
              '任辞远',
              '技术基础偏弱，架构设计多次评审后仍需改进',
              x03Sources.w78,
            ),
          ],
        },
        {
          id: 'e-x03-2',
          occurredOn: '2026-08-07',
          title: '技术选型：输出跨端框架选型对比 Issue（Flut…',
          projectName: '线索雷达',
          recorderName: '苏鹤年',
          scores: [
            score(
              '专业度',
              3,
              anchors.pro3,
              '苏鹤年',
              '虽然对于移动端开发不熟悉，或者说对软件开发的基础也十分薄弱，但是仍然在两天内也指…',
              x03Sources.w45good,
            ),
            score(
              '内生动力',
              3,
              anchors.core3,
              '苏鹤年',
              'MVP 搭建态度积极',
              x03Sources.w45good,
            ),
            score(
              '智慧力',
              2,
              anchors.core2,
              '苏鹤年',
              '实现先于架构和 API，对 AI 产出的接口设计内容理解不到位',
              x03Sources.w45bad,
            ),
          ],
        },
        {
          id: 'e-x03-1',
          occurredOn: '2026-07-24',
          title: '完成数据标签分析报告',
          projectName: '线索雷达',
          recorderName: '苏鹤年',
          scores: [
            score(
              '智慧力',
              3,
              anchors.core3,
              '苏鹤年',
              '能在标签和移动端设计中提出想法，并与陆晚晴形成良好协作',
              x03Sources.w13good,
            ),
            score(
              '专业度',
              3,
              anchors.pro3,
              '苏鹤年',
              '完成数据标签分析报告，参与前期标签设计、移动端方案设计和 Live Demo 推…',
              x03Sources.w13both,
              false,
            ),
          ],
        },
      ],
    },
    preview: {
      eventCount: 3,
      scoreCount: 6,
      skippedCount: 0,
      hasSummary: false,
      hasFormalPosition: true,
      hasHidden: false,
    },
  },
};

const roleLines: Record<SampleRole, [string, string, string]> = {
  manager: ['程远', '管理者', '公司层：看人、找人，确认规则与方案'],
  hr: ['苏晚', 'HR', '人才项目：XEngineer、Landing、校招、黑客松'],
  mentor: ['叶青', '导师', '分镜工厂 · 二组、口语搭子 · 一组的学员'],
};

export function sampleShell(role: SampleRole): ShellData {
  const [name, roleLabel, scopeLabel] = roleLines[role];
  return {
    account: {
      id: `sample-${role}`,
      name,
      email: `${role}@sample.test`,
      roles: [role],
      hue: 220,
      roleLabel,
      scopeLabel,
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

export const samplePerson = (key: SamplePerson) => ({
  id: people[key].id,
  name: people[key].sheet.person.name,
});

/**
 * In-memory print for the sample: `deny` refuses on opening (the prototype's
 * `?print=deny`), `fail` loses the first print and keeps the second.
 */
export function samplePorts(
  key: SamplePerson,
  role: SampleRole,
  mode: Exclude<SampleMode, 'live'>,
): PersonPrintPorts {
  const { sheet, preview } = people[key];
  let failures = mode === 'fail' ? 1 : 0;
  return {
    preview: async () =>
      mode === 'deny' ? { status: 'denied' } : { status: 'ready', preview },
    print: async () => {
      if (failures > 0) {
        failures -= 1;
        throw new Error('sample print lost');
      }
      return {
        status: 'printed',
        sheet: { ...sheet, printedByName: roleLines[role][0] },
      };
    },
  };
}
