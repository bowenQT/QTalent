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
