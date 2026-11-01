import type {
  BindingFailure,
  CallRecord,
  TaskFailure,
} from '@/contracts/admin-connections';

const stamp = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
/** `09-04 14:02`, Beijing time, as the prototype writes it. */
export function stampOf(iso: string): string {
  const parts = Object.fromEntries(
    stamp.formatToParts(new Date(iso)).map((part) => [part.type, part.value]),
  );
  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export const channelLabel: Record<CallRecord['channel'], string> = {
  mcp: 'MCP',
  agentapi: 'AgentAPI',
};
export const sourceLabel: Record<TaskFailure['source'], string> = {
  wecom: '企业微信',
  ...channelLabel,
};

export const durationText = (ms: number) =>
  ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;

/** 原因 and 接下来 for each binding failure; the server sends only the code. */
export const bindingText: Record<
  BindingFailure['reason'],
  { why: string; next: string }
> = {
  not_in_directory: {
    why: '这个企业微信账号待补进人员目录',
    next: '让对方在北森补上企业微信账号；补上后下一条消息会自动匹配，这次的材料需要重新发送',
  },
  ambiguous: {
    why: '对上了不止一个人，待确认是谁',
    next: '已转给 HR 负责人确认；确认后这个账号发来的材料才入库',
  },
  departed: {
    why: '账号对应的人员已离职，账号已停用',
    next: '已回复对方「账号已停用」',
  },
};
