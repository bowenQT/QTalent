'use client';
import { useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import type {
  AdminConnections,
  CallRecord,
  CallSummary,
  TaskFailure,
  WecomStatus,
} from '@/contracts/admin-connections';
import type { JobCommand, JobResponse } from '@/contracts/jobs';
import {
  bindingText,
  channelLabel,
  durationText,
  sourceLabel,
  stampOf,
} from './copy';

/** Re-queues a failed job through the jobs command; absent until BOW-909/910/915 wire it. */
export type RetryPort = (command: JobCommand) => Promise<JobResponse>;

const pending = '待接通';

function WecomCard({ block }: { block: AdminConnections['wecom'] }) {
  const view: {
    tone: string;
    label: string;
    text: string;
    next?: string;
  } =
    block.status === 'not_connected'
      ? {
          tone: 'never',
          label: pending,
          text: '读取接通后，这里显示最近收到消息和回执的时间。',
        }
      : wecomView(block.data);
  return (
    <article className="n-card n-conn__item" data-entry="wecom">
      <header className="n-conn__head">
        <b>企业微信机器人</b>
        <span className="n-conn__state" data-state={view.tone}>
          {view.label}
        </span>
      </header>
      <p className="n-conn__use">收材料，并给发送人回执</p>
      <p className="n-conn__meta">{view.text}</p>
      {view.next ? (
        <p className="n-conn__next">
          <Icon name="info" />
          <span>{view.next}</span>
        </p>
      ) : null}
    </article>
  );
}

function wecomView(status: WecomStatus) {
  switch (status.state) {
    case 'connected':
      return {
        tone: 'on',
        label: '已连接',
        text: `最近收到消息 ${stampOf(status.lastMessageAt)}${
          status.lastReceiptAt
            ? ` · 最近一次回执 ${stampOf(status.lastReceiptAt)}`
            : ''
        }`,
      };
    case 'disconnected':
      return {
        tone: 'down',
        label: '已断开',
        text: `${stampOf(status.since)} 起回调中断${
          status.lastMessageAt
            ? ` · 断开前最后收到消息 ${stampOf(status.lastMessageAt)}`
            : ''
        }`,
        next: '断开期间发来的消息可能已丢失。回调地址和密钥在部署配置里，请部署负责人检查；恢复后这里会显示新的消息时间。',
      };
    case 'never':
      return {
        tone: 'never',
        label: '待首次连接',
        text: '等第一条消息',
        next: '部署时完成机器人配置后，收到第一条消息就会显示「已连接」。',
      };
  }
}

function CallCard({
  name,
  use,
  block,
}: {
  name: string;
  use: string;
  block: { status: 'ready'; data: CallSummary } | { status: 'not_connected' };
}) {
  const summary = block.status === 'ready' ? block.data : null;
  const used = summary?.lastCallAt ?? null;
  return (
    <article className="n-card n-conn__item" data-entry={name}>
      <header className="n-conn__head">
        <b>{name}</b>
        <span className="n-conn__state" data-state={used ? 'on' : 'never'}>
          {!summary ? pending : used ? '有调用' : '待首次调用'}
        </span>
      </header>
      <p className="n-conn__use">{use}</p>
      <p className="n-conn__meta">
        {!summary
          ? '读取接通后，这里显示最近一次调用的时间和结果。'
          : used
            ? `最近一次调用 ${stampOf(used)} · 近 24 小时 ${summary.calls24h} 次${
                summary.rejectedOrFailed24h
                  ? `，其中 ${summary.rejectedOrFailed24h} 次拒绝或失败`
                  : ''
              }`
            : '部署后有账号调用时，这里显示最近的时间和结果'}
      </p>
    </article>
  );
}

// Call results say how far a call got: the neutral progress badge, never the
// supported / unsupported colors of requirement matching.
const callResult: Record<
  CallRecord['result'],
  { label: string; icon: IconName; state?: string }
> = {
  ok: { label: '成功', icon: 'check' },
  denied: { label: '拒绝', icon: 'lock', state: 'review' },
  failed: { label: '失败', icon: 'x', state: 'failed' },
};

function Pending({ text }: { text: string }) {
  return (
    <div className="nt-empty">
      <b>{pending}</b>：{text}
    </div>
  );
}

function Table({
  head,
  children,
}: {
  head: readonly string[];
  children: React.ReactNode;
}) {
  return (
    <div
      className="n-card nt-tablewrap"
      style={{ padding: 'var(--s-2) var(--s-4)' }}
    >
      <table className="nt-table">
        <thead>
          <tr>
            {head.map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const nowrap = { whiteSpace: 'nowrap' } as const;

function TaskCard({
  task,
  busy,
  onRetry,
}: {
  task: TaskFailure;
  busy: boolean;
  onRetry: (() => void) | null;
}) {
  const by = `${sourceLabel[task.source]} · ${task.initiator.name}发起 · ${stampOf(task.failedAt)}`;
  if (task.state === 'queued')
    return (
      <li className="n-card" data-state="queued" data-job={task.jobId}>
        <div className="n-tfail__top">
          <Badge className="n-badge--proc" data-state="queued" icon="clock">
            已重新排队
          </Badge>
          <b>{task.label}</b>
          <small className="nt-muted">{by}</small>
        </div>
        <dl className="n-tfail__dl">
          <dt>上次原因</dt>
          <dd>{task.reason}</dd>
          <dt>接下来</dt>
          <dd>排队处理中，结果会更新在这张卡上；处理完会回到发起人的工作台</dd>
        </dl>
      </li>
    );
  return (
    <li className="n-card" data-job={task.jobId}>
      <div className="n-tfail__top">
        <Badge className="n-badge--proc" data-state="failed" icon="x">
          失败
        </Badge>
        <b>{task.label}</b>
        <small className="nt-muted">{by}</small>
      </div>
      <dl className="n-tfail__dl">
        <dt>原因</dt>
        <dd>{task.reason}</dd>
        <dt>接下来</dt>
        <dd>{task.next}</dd>
      </dl>
      {onRetry ? (
        <div>
          <Button
            className="n-btn--sm"
            type="button"
            disabled={busy}
            onClick={onRetry}
          >
            <Icon name="retry" />
            重试
          </Button>
        </div>
      ) : null}
    </li>
  );
}

const retryFailure: Record<
  Exclude<JobResponse['status'], 'success'>,
  string
> = {
  unauthenticated: '登录已过期，重新登录后再试',
  forbidden: '这一步由有权限的人处理，刷新页面查看当前权限',
  not_found: '这个任务已不在，刷新页面查看最新状态',
  conflict: '任务状态已变化，刷新页面查看最新状态',
  validation_error: '重试没有提交，刷新页面后再试',
  unavailable: '暂时无法重试，稍后再试',
};

/**
 * 接入状态: three entries, recent calls, binding failures and failed tasks. Only
 * times, accounts, actions and results; bodies, files, queries and secrets stay put.
 */
export function Connections({
  data,
  retry,
}: {
  data: AdminConnections;
  retry: RetryPort | null;
}) {
  const toast = useToast();
  const [tasks, setTasks] = useState(data.taskFailures);
  const [busy, setBusy] = useState<string | null>(null);
  const operations = useRef(new Map<string, string>());

  async function requeue(task: TaskFailure) {
    if (!retry || tasks.status !== 'ready') return;
    // A retry of the same unanswered request keeps its operation id.
    const operationId =
      operations.current.get(task.jobId) ?? crypto.randomUUID();
    operations.current.set(task.jobId, operationId);
    setBusy(task.jobId);
    const result = await retry({
      jobId: task.jobId,
      action: 'retry',
      operationId,
      expectedRevision: task.revision,
    });
    setBusy(null);
    if (result.status !== 'success') {
      toast.show(retryFailure[result.status]);
      return;
    }
    operations.current.delete(task.jobId);
    setTasks({
      status: 'ready',
      data: tasks.data.map((item) =>
        item.jobId === task.jobId
          ? {
              ...item,
              state: 'queued',
              revision: result.snapshot.revision,
            }
          : item,
      ),
    });
    toast.show('已重新排队，处理结果会更新在这里');
  }

  const calls = data.recentCalls;
  const binds = data.bindingFailures;
  const open =
    tasks.status === 'ready'
      ? tasks.data.filter((task) => task.state === 'failed').length
      : 0;
  const queued = tasks.status === 'ready' ? tasks.data.length - open : 0;
  return (
    <>
      <section className="nt-sec">
        <div className="n-conn">
          <WecomCard block={data.wecom} />
          <CallCard
            name="MCP"
            use="在 Agent 工具里查人、找人、查任务状态"
            block={data.mcp}
          />
          <CallCard
            name="AgentAPI"
            use="其他系统提交材料和事件草稿"
            block={data.agentapi}
          />
        </div>
        <div className="n-lock" style={{ marginTop: 'var(--s-3)' }}>
          <Icon name="lock" />
          <span>
            接入配置（机器人回调地址、MCP 与 AgentAPI
            的令牌）在部署时完成，这里只看状态和结果；消息正文、文件内容、查询内容和密钥都留在原处。
          </span>
        </div>
      </section>
      <section className="nt-sec">
        <h2 className="nt-h2">
          最近调用 <small>MCP 与 AgentAPI · 只记账号、动作和结果</small>
        </h2>
        {calls.status === 'not_connected' ? (
          <Pending text="读取接通后，这里列出 MCP 与 AgentAPI 最近的调用。" />
        ) : calls.data.length ? (
          <Table head={['时间', '入口', '账号', '动作', '结果']}>
            {calls.data.map((call, index) => {
              const result = callResult[call.result];
              return (
                <tr key={`${call.at}-${index}`}>
                  <td>{stampOf(call.at)}</td>
                  <td style={nowrap}>{channelLabel[call.channel]}</td>
                  <td style={nowrap}>{call.account.name}</td>
                  <td>{call.action}</td>
                  <td>
                    <Badge
                      className="n-badge--proc"
                      data-state={result.state}
                      icon={result.icon}
                    >
                      {result.label}
                    </Badge>
                    <small>
                      {call.result === 'ok'
                        ? durationText(call.durationMs)
                        : call.reason}
                    </small>
                  </td>
                </tr>
              );
            })}
          </Table>
        ) : (
          <div className="nt-empty">有账号调用后，记录会出现在这里。</div>
        )}
      </section>
      <section className="nt-sec">
        <h2 className="nt-h2">
          绑定失败{' '}
          <small>
            发送人待匹配人员目录
            {binds.status === 'ready'
              ? ` · 近 ${binds.data.windowDays} 天 ${binds.data.items.length} 条`
              : ''}
          </small>
        </h2>
        {binds.status === 'not_connected' ? (
          <Pending text="读取接通后，这里列出企业微信发送人没能对上人员目录的记录。" />
        ) : binds.data.items.length ? (
          <Table head={['时间', '发送人账号', '原因', '接下来']}>
            {binds.data.items.map((item, index) => (
              <tr key={`${item.at}-${index}`}>
                <td style={nowrap}>{stampOf(item.at)}</td>
                <td style={nowrap} title="企业微信账号只显示后四位">
                  {item.sender}
                </td>
                <td>{bindingText[item.reason].why}</td>
                <td>{bindingText[item.reason].next}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <div className="nt-empty">
            近 {binds.data.windowDays} 天的绑定都已成功。
          </div>
        )}
        <p className="nt-caption">
          绑定以北森人员目录里的企业微信账号为准，改绑在北森里做。匹配失败的消息留在企业微信，并回复发送人「账号待绑定」。
        </p>
      </section>
      <section className="nt-sec">
        <h2 className="nt-h2">
          任务失败{' '}
          {tasks.status === 'ready' ? (
            <small>
              {open ? `${open} 个待处理` : '都已处理'}
              {queued ? ` · ${queued} 个已重新排队` : ''}
            </small>
          ) : null}
        </h2>
        {tasks.status === 'not_connected' ? (
          <Pending text="读取接通后，这里列出从企业微信、MCP 和 AgentAPI 发起、处理失败的任务和原因。" />
        ) : tasks.data.length ? (
          <ul className="n-tfail">
            {tasks.data.map((task) => (
              <TaskCard
                key={task.jobId}
                task={task}
                busy={busy === task.jobId}
                onRetry={
                  retry && task.canRetry ? () => void requeue(task) : null
                }
              />
            ))}
          </ul>
        ) : (
          <div className="nt-empty">
            任务都已处理完。重新排队的任务处理完会回到发起人的工作台。
          </div>
        )}
      </section>
    </>
  );
}
