import type { WorkbenchRole } from './view';

// Verbatim from prototype/y/app/js/pages/workbench.js (SUGGEST and placeholders).
// HR's "为 XEngineer 第六期发起结营盘点" is left out: inventory stays in the prototype.
const suggestions = {
  manager: [
    'MaaS 智能体平台要一个能牵头应用后端的人，10 月到岗',
    'TS 新人组还缺一个懂测试和部署、能带大家对齐节奏的人',
  ],
  hr: ['谷嘉树这周把 CI 覆盖率补到了 80%，还写了一份排障手册'],
  mentor: [
    '孟逸尘今天主动把任务池同步给了全组，下午组员就接上了',
    '周初晴这周先画了接口图，再去找后端对齐',
  ],
} as const satisfies Record<WorkbenchRole, readonly string[]>;

/**
 * Example sentences. The HR and mentor ones name demo people, so they are shown only
 * outside production; the manager ones name no one.
 */
export function suggestionsFor(
  role: WorkbenchRole,
  namedExamples: boolean,
): readonly string[] {
  return role === 'manager' || namedExamples ? suggestions[role] : [];
}

export const composerPlaceholder = {
  record: '说一件事，或描述一个项目要找谁。输入 / 查看命令',
  mentor:
    '按情境、行为、影响说一件学员做的事：在什么情况下、做了什么、带来什么影响',
} as const;

export const findPlaceholder = '描述你需要什么样的人：业务目标、必须项和加分项';

export const studentsCaption =
  '每件事按情境、行为、影响记下来；分数在事件里给，对照行为锚点。';
export const studentsEmpty = '分配给你的学员会出现在这里。';
export const handoffFailed = '转交失败，请再点一次发送';

export const todosDone = {
  title: '待办都处理完了',
  text: '新的待核对、校准和到期的跟踪会出现在这里。',
} as const;

/** Manager home blocks whose reads are not on main yet (版本 Y DY-04). */
export const managerPending = {
  watch: '接通后，近期值得关注的人会出现在这里，最新的在前。',
  programs: '接通后，刚过关键节点、留用或落位还没定的期次会出现在这里。',
  follows: '接通后，你关注的人和他们的新进展会出现在这里，只有你自己看得到。',
} as const;

// Verbatim from prototype/y/app/js/pages/workbench.js (CAT_NOTE and empty states).
export const watchCategories = [
  ['top', '突出表现', '导师提名或推荐，HR 已核实'],
  ['new', '新发现', '近期有多件事印证，或 AI 线索经 HR 核实'],
  ['act', '需要介入', '约定的跟进没有按时发生，HR 在跟'],
] as const;
export const watchEmpty = '这一类入选的人会出现在这里。';
export const programsEmpty = '近两周没有需要留意的期次。';
export const followsEmpty =
  '在值得关注或速览里点「加关注」，之后他们的新进展会出现在这里。';
export const followUpdatesEmpty = '关注以来的新进展会出现在这里。';
