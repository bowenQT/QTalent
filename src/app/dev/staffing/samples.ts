import type { ShellData } from '@/contracts/shell';
import type { Source } from '@/contracts/sources';
import type {
  StaffingCandidate,
  StaffingDemand,
  StaffingPage,
} from '@/contracts/staffing';
import type { ProjectHead } from '@/features/staffing/view';

/**
 * Sample data for comparing the find-people page with prototype Y while the real reads
 * (BOW-852 demands, BOW-854 matching) are not on main. Demo pseudonyms, wording and
 * evidence from the prototype Y seed (staffing.js SCEN, ?as=ceo|hrbp at 2026-09-04); not
 * real people and not a fallback for the real page. Every source is marked as the
 * prototype baseline, because that is where it comes from.
 */
export type SampleRole = 'manager' | 'hr';
export type SampleScene = 'ts' | 'agent' | 'new';

type Conclusion = 'yes' | 'no' | 'unknown';
/** [requirement id, state, what the evidence says, observation table location, quote]. */
type Row = [string, Conclusion, string, string?, string?];

const conclusion = {
  yes: 'supported',
  no: 'not_supported',
  unknown: 'insufficient',
} as const;

export const sampleSources = new Map<string, Source>();

function source(id: string, location: string, excerpt: string): Source {
  const value: Source = {
    fragmentId: `sample-fragment-${id}`,
    originalVersionId: `sample-version-${id}`,
    location: {
      kind: 'snapshot_field',
      fieldPath: `staffing.${id}`,
      originalLocation: location,
    },
    excerpt,
    sourceType: 'prototype_snapshot',
    sourceCategory: 'prototype_baseline',
    displayNotice: '演示：取自原型 Y 的演示数据。',
    demo: true,
  };
  sampleSources.set(value.fragmentId, value);
  return value;
}

function candidate(
  revision: number,
  [id, name, orgName]: [string, string, string],
  rows: Row[],
): StaffingCandidate {
  return {
    person: { id, name, orgName },
    demandRevision: revision,
    requirements: rows.map(([requirementId, state, rationale, at, quote]) => ({
      requirementId,
      progress: 'completed',
      aiJudgment: {
        conclusion: conclusion[state],
        rationale,
        // The prototype cites the observation table where it has one; its other explicit
        // states have no citation, but the contract asks a source for each of them.
        sources:
          state === 'unknown'
            ? []
            : [
                at && quote
                  ? source(`${id}-${requirementId}`, at, quote)
                  : source(
                      `${id}-${requirementId}`,
                      '原型 Y 演示数据 · 找人核对结果',
                      rationale,
                    ),
              ],
      },
      humanJudgment: null,
    })),
  };
}

const sheet = (weeks: string, row: number) =>
  `XEngineer 第六期观察表 · ${weeks} · 突出表现 · 第 ${row} 行`;

export const sampleProjects: Record<SampleScene, ProjectHead> = {
  ts: {
    id: 'pr-ts',
    name: '业务成功部 TS 新人组',
    goal: '第六期留用进业务成功部 TS 的同学组成新人组，跟一线客户问题，三个月后独立值班。',
    status: '进行中',
  },
  agent: {
    id: 'pr-agent',
    name: 'MaaS 智能体平台 · 应用后端',
    goal: '给 MaaS 智能体平台补一条应用后端：工具注册、会话持久化和多租户隔离，Q4 内部上线。',
    status: '筹备中',
  },
  new: {
    id: 'pr-newconv',
    name: '语音硬件 · 端云联调',
    goal: '把语音硬件的端侧唤醒、实时语音链路和服务端编排串起来，年底前给第一批客户试用。',
    status: '筹备中',
  },
};

const confirmedBy = { id: 'sample-hrbp', name: '苏晚' };

function confirmedDemand(
  scene: SampleScene,
  inputText: string,
  requirements: StaffingDemand['requirements'],
): StaffingDemand {
  return {
    id: `sample-demand-${scene}`,
    projectId: sampleProjects[scene].id,
    revision: 2,
    inputText,
    requirements,
    status: 'confirmed',
    confirmedBy,
    confirmedAt: '2026-09-01T02:00:00Z',
  };
}

const tsDemand = confirmedDemand(
  'ts',
  'TS 新人组要一个能带大家对齐节奏的牵头人',
  [
    {
      id: 'r1',
      text: '在训练营里担任过组长或牵头过分工',
      priority: 'required',
    },
    { id: 'r2', text: '做过测试、部署或排障相关的工作', priority: 'required' },
    { id: 'r3', text: '已接受留用', priority: 'required' },
  ],
);
const agentDemand = confirmedDemand(
  'agent',
  '智能体平台应用后端要找一个 owner',
  [
    { id: 'r1', text: '做过 Agent 或 MCP 工具链开发', priority: 'required' },
    { id: 'r2', text: '负责过服务端核心模块', priority: 'required' },
    { id: 'r3', text: '能投入 50% 以上', priority: 'required' },
  ],
);

function page(
  demand: StaffingDemand,
  candidates: StaffingCandidate[],
): StaffingPage {
  return { demand, candidates, plan: { status: 'not_connected' } };
}

// Input order is the prototype's order for equal counts (fewer unsupported, then name);
// the contract itself orders by supported required items only.
export const samplePages: Record<'ts' | 'agent', StaffingPage> = {
  ts: page(tsDemand, [
    candidate(
      2,
      ['p-x47', '任子衿', '口语搭子 · 二组'],
      [
        [
          'r1',
          'yes',
          '担任组长，建立 GitHub 协作规范',
          sheet('W1–W3', 52),
          '能快速识别成员优势并合理分工；对新技术、新概念热情高，主动推动协作规范和产品架构',
        ],
        [
          'r2',
          'yes',
          '负责合并全组代码和质量把控',
          sheet('W7–W8', 52),
          'AI工具使用上，有比较大变化，开始了意识到架构拆解重要性，开始做模块拆解把事情拆细分给别人，不像前面什么都自己上',
        ],
        ['r3', 'yes', '已接受，去向 TS'],
      ],
    ),
    candidate(
      2,
      ['p-x08', '谷嘉树', '口语搭子 · 一组'],
      [
        ['r1', 'unknown', '在组里是协作支撑角色，没有牵头的事件'],
        [
          'r2',
          'yes',
          '完成 CI 功能开发，提升整体覆盖率',
          sheet('W7–W8', 13),
          '做事认真，为不耽误组员进度主动补交代码；会追问为什么，有自己的思考',
        ],
        ['r3', 'yes', '已接受，去向 TS'],
      ],
    ),
    candidate(
      2,
      ['p-x19', '罗星野', '值班助手 · 二组'],
      [
        ['r1', 'unknown', '没有牵头分工的事件'],
        [
          'r2',
          'yes',
          '完成直播告警排查，补了 Runbook 调查',
          sheet('W4–W5', 24),
          '在导师的引到下， 能逐步降低ai对个人思考的影响，负责的工作产出质量也有明显提高；延续以往表现',
        ],
        ['r3', 'yes', '已接受，去向 TS'],
      ],
    ),
    candidate(
      2,
      ['p-x60', '萧闻笛', '值班助手 · 一组'],
      [
        ['r1', 'unknown', '没有牵头分工的事件'],
        [
          'r2',
          'yes',
          '完成 URL 安全校验和 fetch MCP 服务部署',
          sheet('W7–W8', 65),
          '对任务有自己的思考，能提出质疑',
        ],
        ['r3', 'yes', '已接受，去向 TS'],
      ],
    ),
  ]),
  agent: page(agentDemand, [
    candidate(
      2,
      ['p-x16', '林一诺', '值班助手 · 二组'],
      [
        [
          'r1',
          'yes',
          '重构 Agent 工具体系，提高 RCA 准确率',
          sheet('W4–W5', 21),
          '延续以往表现',
        ],
        [
          'r2',
          'yes',
          '经验注入改为按告警分桶，线上相关经验从 0 份到 3 份以上',
          sheet('W7–W8', 21),
          '思考调研细致仔细；在导师指导下能快速理解任务方向并执行，主动寻找量化评估指标并与竞品对比，展现出较好的分析能力和问题解决意识',
        ],
        ['r3', 'yes', '结营去向 MaaS，本部门项目'],
      ],
    ),
    candidate(
      2,
      ['p-x52', '邱清和', '乡音同传'],
      [
        ['r1', 'unknown', '没有 Agent 工具链的事件'],
        [
          'r2',
          'yes',
          '负责用户系统',
          sheet('W4–W5', 57),
          '对硬件结合部分比较熟悉，在设计接口时有考虑到',
        ],
        ['r3', 'yes', '结营去向 MaaS'],
      ],
    ),
    candidate(
      2,
      ['p-x36', '易慕白', '指标问答台 · 二组'],
      [
        [
          'r1',
          'yes',
          '完成知识库模块和 Knowledge MCP 开发',
          sheet('W4–W5', 41),
          '主导路演大纲/PPT/视频与架构质量内容生成工作，产出全面，敢于在团队出现困难时主动担责',
        ],
        [
          'r2',
          'yes',
          '完成 Server 向 Knowledge Server 的收敛',
          sheet('W7–W8', 41),
          '能提出知识库混合检索升级、可治理意图识别、Agent 自动化测评等成体系的 Proposal，而不只是完成手上的功能；领导力、决策判断、坚毅力：担当是其最突出的一项',
        ],
        ['r3', 'unknown', '结营去向 LAS，能投入多少未知'],
      ],
    ),
    candidate(
      2,
      ['p-x60', '萧闻笛', '值班助手 · 一组'],
      [
        [
          'r1',
          'yes',
          '完成 Knowledge MCP 客户端接入和 fetch MCP 服务部署',
          sheet('W7–W8', 65),
          '对任务有自己的思考，能提出质疑',
        ],
        [
          'r2',
          'yes',
          '实现后端骨架代码和审计',
          sheet('W4–W5', 65),
          '暂无突出的个人行为记录；能连续将审计、持久化、审批、上下文和前端功能从方案推进到实际实现；同时主动学习和思考导师提出的建议，并将整理后的思考同步给导师和助教',
        ],
        ['r3', 'no', '已在 TS 新人组全职'],
      ],
    ),
  ]),
};

/** The new-project flow: the drafted card for the sentence, before confirmation. */
export const newDraft: StaffingDemand = {
  id: 'sample-demand-new',
  projectId: sampleProjects.new.id,
  revision: 1,
  inputText: '语音硬件端云联调要找一个能打通设备端和服务端的 owner，10 月到岗',
  requirements: [
    { id: 'r1', text: '独立负责过一个服务端模块', priority: 'required' },
    { id: 'r2', text: '做过实时语音链路', priority: 'required' },
    { id: 'r3', text: '10 月能到岗', priority: 'required' },
    { id: 'r4', text: '写过测试并让 CI 稳定通过', priority: 'bonus' },
  ],
  status: 'draft',
};

const newPeople: [string, string, string][] = [
  ['p-x53', '许承宇', '乡音同传'],
  ['p-x07', '孟映雪', '口语搭子 · 一组'],
  ['p-x14', '方景深', '分镜工厂 · 二组'],
  ['p-x80', '白一诺', '日程罗盘 · 二组'],
];

/**
 * Matching for the new-project flow at a given revision. While running, the later
 * requirements are still queued or being judged; once settled, one requirement waits for
 * a person and one failed, so every progress state is on the page.
 */
export function newMatching(
  demand: StaffingDemand,
  settled: boolean,
): StaffingPage {
  const evidence: Record<string, Row[]> = {
    'p-x53': [
      [
        'r1',
        'yes',
        '负责核心语音模块：切分、网络传输和打断',
        sheet('W4–W5', 58),
        '在语音模块经验丰富，负责架构底层的语音接口对接和设计',
      ],
      [
        'r2',
        'yes',
        'WebRTC 落地前做了多方案调研，负责 Live Demo 的语音接口',
        sheet('W1–W3', 58),
        '语音技术基础较好，承担了关键接口开发与MVP开发；与组员协作顺利，支持 Demo 达到较高完成度',
      ],
      ['r3', 'yes', '10-12 回来，可以直接进项目'],
      ['r4', 'unknown', '没有测试或 CI 相关事件'],
    ],
    'p-x07': [
      [
        'r1',
        'yes',
        '独立完成服务端主流程 MVP，是核心框架的主要搭建者',
        sheet('W4–W5', 12),
        '技术架构能力突出，输出的技术方案稳定性强；技术能力仍是组内主力，承担核心开发任务的稳定性较高',
      ],
      ['r2', 'unknown', '没有实时语音链路的事件'],
      ['r4', 'unknown', '资料不足'],
    ],
    'p-x14': [
      [
        'r1',
        'yes',
        '主导 Java 状态机模块的方案设计与落地',
        sheet('W4–W5', 19),
        '资产模块独立完成开发，完成度高；在孟逸尘主导故事模块的同时，主动承担整体流程跑通的兜底工作',
      ],
      ['r2', 'unknown', '没有语音相关事件'],
      ['r3', 'yes', '实习 offer 已接受，去向灵矽'],
    ],
    'p-x80': [
      ['r1', 'no', '负责前端 MVP 开发，没有服务端模块'],
      [
        'r2',
        'yes',
        '引入 ASR、LLM、TTS 组合，降低实时模型成本',
        sheet('W7–W8', 85),
        '技术综合能力比较强，注重方法论，做事情非常讲究',
      ],
      ['r3', 'no', '12-01 才能回来'],
      ['r4', 'unknown', '资料不足'],
    ],
  };
  const candidates = newPeople.map((person) => {
    const known = candidate(demand.revision, person, evidence[person[0]]);
    const byId = new Map(
      known.requirements.map((match) => [match.requirementId, match]),
    );
    return {
      ...known,
      requirements: demand.requirements.map(
        (requirement, index): StaffingCandidate['requirements'][number] => {
          const match = byId.get(requirement.id);
          const waiting = (
            progress: 'queued' | 'judging' | 'awaiting_manual' | 'failed',
          ) => ({
            requirementId: requirement.id,
            progress,
            aiJudgment: null,
            humanJudgment: null,
          });
          if (!settled && index >= 2)
            return waiting(index === 2 ? 'judging' : 'queued');
          if (person[0] === 'p-x07' && requirement.id === 'r3')
            return waiting('awaiting_manual');
          if (person[0] === 'p-x14' && requirement.id === 'r4')
            return waiting('failed');
          return (
            match ?? {
              ...waiting('queued'),
              progress: 'completed',
              aiJudgment: {
                conclusion: 'insufficient',
                rationale: '相关事件待核对',
                sources: [],
              },
            }
          );
        },
      ),
    };
  });
  return page(demand, candidates);
}

// Role line of the prototype shell (data.js ROLES), so the page above has the same height.
const roleLines: Record<SampleRole, [string, string, string]> = {
  manager: ['程远', '管理者', '公司层：看人、找人，确认规则与方案'],
  hr: ['苏晚', 'HR', '人才项目：XEngineer、Landing、校招、黑客松'],
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
      {
        id: 'projects',
        label: '项目与课题',
        href: '/projects',
        icon: 'folder',
        group: null,
      },
    ],
    counts: { status: 'not_connected' },
    recent: { status: 'not_connected' },
    canSearch: false,
    isAdmin: false,
    role,
  };
}
