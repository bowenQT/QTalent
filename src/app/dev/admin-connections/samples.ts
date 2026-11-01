import {
  adminConnectionsSchema,
  type AdminConnections,
  type WecomStatus,
} from '@/contracts/admin-connections';
import type { ShellData } from '@/contracts/shell';

/*
 * Development samples for comparing 系统管理 · 接入状态 with prototype Y while the
 * WeCom, MCP and AgentAPI reads (BOW-909/910/915) are not on main. Demo pseudonyms
 * only; parsed through the BOW-916 contract. Never a fallback for /admin.
 */
const people = {
  suwan: { id: 'p-suwan', name: '苏晚' },
  cheng: { id: 'p-cheng', name: '程远' },
  yeqing: { id: 'p-yeqing', name: '叶青' },
};
const at = (day: string, time: string) =>
  new Date(`2026-${day}T${time}:00+08:00`).toISOString();

export const wecomSamples: Record<'on' | 'down' | 'never', WecomStatus> = {
  on: {
    state: 'connected',
    lastMessageAt: at('09-04', '14:02'),
    lastReceiptAt: at('09-04', '14:03'),
  },
  down: {
    state: 'disconnected',
    since: at('09-04', '10:20'),
    lastMessageAt: at('09-04', '10:18'),
  },
  never: { state: 'never' },
};

export type SampleQuery = {
  wecom: keyof typeof wecomSamples;
  /** Every list ready but empty, and MCP / AgentAPI never called. */
  empty: boolean;
  /** Every block not connected, as /admin is today. */
  pending: boolean;
};

export function sampleConnections(query: SampleQuery): AdminConnections {
  const notConnected = { status: 'not_connected' } as const;
  if (query.pending)
    return adminConnectionsSchema.parse({
      wecom: notConnected,
      mcp: notConnected,
      agentapi: notConnected,
      recentCalls: notConnected,
      bindingFailures: notConnected,
      taskFailures: notConnected,
    });
  const ready = <T>(data: T) => ({ status: 'ready' as const, data });
  if (query.empty)
    return adminConnectionsSchema.parse({
      wecom: ready(wecomSamples[query.wecom]),
      mcp: ready({ lastCallAt: null, calls24h: 0, rejectedOrFailed24h: 0 }),
      agentapi: ready({
        lastCallAt: null,
        calls24h: 0,
        rejectedOrFailed24h: 0,
      }),
      recentCalls: ready([]),
      bindingFailures: ready({ windowDays: 7, items: [] }),
      taskFailures: ready([]),
    });
  return adminConnectionsSchema.parse({
    wecom: ready(wecomSamples[query.wecom]),
    mcp: ready({
      lastCallAt: at('09-04', '13:40'),
      calls24h: 4,
      rejectedOrFailed24h: 1,
    }),
    agentapi: ready({
      lastCallAt: at('09-04', '11:15'),
      calls24h: 2,
      rejectedOrFailed24h: 1,
    }),
    recentCalls: ready([
      {
        at: at('09-04', '13:40'),
        channel: 'mcp',
        account: people.suwan,
        action: '查任务状态',
        result: 'ok',
        durationMs: 320,
      },
      {
        at: at('09-04', '13:12'),
        channel: 'mcp',
        account: people.cheng,
        action: '找人：提交项目要求',
        result: 'ok',
        durationMs: 1800,
      },
      {
        at: at('09-04', '11:15'),
        channel: 'agentapi',
        account: people.suwan,
        action: '记一件事：提交草稿',
        result: 'ok',
        durationMs: 640,
      },
      {
        at: at('09-04', '10:47'),
        channel: 'mcp',
        account: people.yeqing,
        action: '查人员档案摘要',
        result: 'denied',
        reason: '超出查看范围，已拒绝',
      },
      {
        at: at('09-04', '09:30'),
        channel: 'agentapi',
        account: people.suwan,
        action: '上传材料',
        result: 'failed',
        reason: '文件超过 50 MB，停在上传这一步',
      },
      {
        at: at('09-03', '18:05'),
        channel: 'mcp',
        account: people.cheng,
        action: '查人员档案摘要',
        result: 'ok',
        durationMs: 410,
      },
    ]),
    bindingFailures: ready({
      windowDays: 7,
      items: [
        {
          at: at('09-04', '12:26'),
          sender: 'wx·****3f2a',
          reason: 'not_in_directory',
        },
        {
          at: at('09-03', '16:41'),
          sender: 'wx·****81c0',
          reason: 'ambiguous',
        },
        { at: at('09-02', '09:12'), sender: 'wx·****d47e', reason: 'departed' },
      ],
    }),
    taskFailures: ready([
      {
        jobId: 'job-tf-1',
        revision: 3,
        state: 'failed',
        label: '整理企业微信材料 · 1 个 PDF',
        source: 'wecom',
        initiator: people.yeqing,
        failedAt: at('09-04', '12:31'),
        reason: '文件是扫描件，只有图片',
        next: '请发送人改发可复制文字的版本，再交一次',
        canRetry: false,
      },
      {
        jobId: 'job-tf-2',
        revision: 4,
        state: 'failed',
        label: '转写会议录音 · 42 分钟',
        source: 'wecom',
        initiator: people.suwan,
        failedAt: at('09-04', '09:58'),
        reason: '转写服务超时，已自动重试 2 次',
        next: '可以再重试一次；仍失败请部署负责人查看转写服务',
        canRetry: true,
      },
      {
        jobId: 'job-tf-3',
        revision: 5,
        state: 'failed',
        label: '整理事件与建议分 · 3 段纪要',
        source: 'agentapi',
        initiator: people.suwan,
        failedAt: at('09-03', '20:14'),
        reason: '模型返回的格式有误，已自动重试 3 次',
        next: '可以重试；连续失败请部署负责人检查模型和提示词版本',
        canRetry: true,
      },
    ]),
  });
}

export const sampleAdminShell: ShellData = {
  account: {
    id: 'p-xuheng',
    name: '许衡',
    email: 'admin@qtalent.test',
    roles: ['admin'],
    hue: 200,
    roleLabel: '系统管理员',
    scopeLabel: '账号、权限与系统配置',
  },
  navigation: [
    {
      id: 'admin',
      label: '系统管理',
      href: '/admin',
      icon: 'lock',
      group: '系统',
    },
  ],
  counts: { status: 'not_connected' },
  recent: { status: 'not_connected' },
  canSearch: false,
  isAdmin: true,
  role: 'admin',
};
