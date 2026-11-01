// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/Toast';
import type { AdminConnections } from '@/contracts/admin-connections';
import { ShellTitleProvider } from '@/features/shell/ShellTitle';
import { SampleAdmin } from '@/app/dev/admin-connections/SampleAdmin';
import { sampleConnections } from '@/app/dev/admin-connections/samples';
import { AdminPage } from './AdminPage';
import type { RetryPort } from './Connections';
import { durationText, stampOf } from './copy';
import { adminTabOf } from './tabs';

vi.mock('motion/react', async () => {
  const original =
    await vi.importActual<typeof import('motion/react')>('motion/react');
  return { ...original, useReducedMotion: () => true };
});
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const full = sampleConnections({ wecom: 'on', empty: false, pending: false });
const show = (data: AdminConnections, retry: RetryPort | null = null) =>
  render(
    <ShellTitleProvider>
      <ToastProvider>
        <AdminPage tab="conn" connections={data} retry={retry} />
      </ToastProvider>
    </ShellTitleProvider>,
  );
const card = (entry: string) =>
  document.querySelector(`[data-entry="${entry}"]`) as HTMLElement;

describe('系统管理 · 接入状态', () => {
  it('formats times in Beijing time and durations as the prototype does', () => {
    expect(stampOf('2026-09-04T06:02:00.000Z')).toBe('09-04 14:02');
    expect(durationText(320)).toBe('320 ms');
    expect(durationText(1800)).toBe('1.8 s');
    expect(adminTabOf('audit')).toBe('audit');
    expect(adminTabOf('nope')).toBe('conn');
  });

  it('shows the three entries, calls, binding failures and failed tasks', () => {
    show(full, vi.fn());
    expect(
      screen
        .getByRole('tab', { name: '接入状态' })
        .getAttribute('aria-selected'),
    ).toBe('true');
    expect(within(card('wecom')).getByText('已连接')).toBeTruthy();
    expect(
      within(card('wecom')).getByText(
        '最近收到消息 09-04 14:02 · 最近一次回执 09-04 14:03',
      ),
    ).toBeTruthy();
    expect(
      within(card('MCP')).getByText(/近 24 小时 4 次，其中 1 次拒绝或失败/),
    ).toBeTruthy();
    expect(screen.getByText('超出查看范围，已拒绝')).toBeTruthy();
    expect(screen.getByText('1.8 s')).toBeTruthy();
    expect(screen.getByText('wx·****3f2a').getAttribute('title')).toBe(
      '企业微信账号只显示后四位',
    );
    expect(screen.getByText('对上了多个人，待确认是谁')).toBeTruthy();
    expect(screen.getByText('近 7 天 3 条', { exact: false })).toBeTruthy();
    expect(screen.getByText('3 个待处理')).toBeTruthy();
    // Only tasks the jobs command can retry get a button.
    expect(screen.getAllByRole('button', { name: '重试' })).toHaveLength(2);
  });

  it('says 待接通 for every unread block, never zero or empty', () => {
    show(sampleConnections({ wecom: 'on', empty: false, pending: true }));
    expect(screen.getAllByText('待接通').length).toBe(6);
    expect(document.body.textContent).not.toMatch(
      /0 次|0 条|都已处理|都已成功/,
    );
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
  });

  it('tells a configured but unused entry apart from an unread one', () => {
    show(sampleConnections({ wecom: 'never', empty: true, pending: false }));
    expect(within(card('wecom')).getByText('待首次连接')).toBeTruthy();
    expect(within(card('MCP')).getByText('待首次调用')).toBeTruthy();
    expect(screen.getByText('有账号调用后，记录会出现在这里。')).toBeTruthy();
    expect(screen.getByText('近 7 天的绑定都已成功。')).toBeTruthy();
    expect(screen.getByText('都已处理')).toBeTruthy();
    cleanup();
    show(sampleConnections({ wecom: 'down', empty: false, pending: false }));
    expect(within(card('wecom')).getByText('已断开')).toBeTruthy();
    expect(
      within(card('wecom')).getByText(/断开期间发来的消息可能已丢失/),
    ).toBeTruthy();
  });

  it('re-queues a failed task through the jobs retry command', async () => {
    const user = userEvent.setup();
    const retry = vi.fn<RetryPort>(async (command) => ({
      status: 'success',
      snapshot: {
        schemaVersion: 1,
        jobId: command.jobId,
        kind: 'entry_task',
        status: 'queued',
        attempt: 2,
        revision: command.expectedRevision + 1,
        updatedAt: '2026-09-04T06:00:00.000Z',
        progress: null,
        result: null,
        error: null,
        canRetry: false,
        canCancel: true,
        cancelRequestedAt: null,
      },
    }));
    show(full, retry);
    await user.click(screen.getAllByRole('button', { name: '重试' })[0]);
    expect(retry).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-tf-2',
        action: 'retry',
        expectedRevision: 4,
      }),
    );
    expect(
      await screen.findByText('已重新排队，处理结果会更新在这里'),
    ).toBeTruthy();
    expect(screen.getByText('已重新排队')).toBeTruthy();
    expect(screen.getByText('2 个待处理 · 1 个已重新排队')).toBeTruthy();
    // The 重试 button is gone, so focus moves to the re-queued card.
    expect(document.activeElement?.getAttribute('data-job')).toBe('job-tf-2');
  });

  it('keeps the task failed and reuses the operation id when a retry is refused', async () => {
    const user = userEvent.setup();
    const retry = vi.fn<RetryPort>(async () => ({ status: 'conflict' }));
    show(full, retry);
    const button = screen.getAllByRole('button', { name: '重试' })[1];
    await user.click(button);
    expect(
      await screen.findByText('任务状态已变化，刷新页面查看最新状态'),
    ).toBeTruthy();
    await user.click(button);
    const [first, second] = retry.mock.calls.map(([command]) => command);
    expect(second.operationId).toBe(first.operationId);
    expect(screen.getByText('3 个待处理')).toBeTruthy();
  });

  it('says 待接通 on the tabs outside this slice', async () => {
    const user = userEvent.setup();
    show(full);
    for (const [tab, title] of [
      ['账号与权限', '账号与权限待接通'],
      ['北森同步', '北森同步待接通'],
      ['集成与设置', '集成与设置待接通'],
      ['审计日志', '审计日志待接通'],
    ])
      await user
        .click(screen.getByRole('tab', { name: tab }))
        .then(() =>
          expect(screen.getByRole('heading', { name: title })).toBeTruthy(),
        );
  });
});

describe('development sample', () => {
  it.each([
    ['ok', '已重新排队，处理结果会更新在这里'],
    ['conflict', '任务状态已变化，刷新页面查看最新状态'],
  ] as const)(
    'scripts a %s retry and carries the 演示 badge',
    async (retry, toast) => {
      const user = userEvent.setup();
      render(
        <ShellTitleProvider>
          <ToastProvider>
            <SampleAdmin
              tab="conn"
              query={{ wecom: 'on', empty: false, pending: false }}
              retry={retry}
            />
          </ToastProvider>
        </ShellTitleProvider>,
      );
      expect(screen.getByText('演示')).toBeTruthy();
      await user.click(screen.getAllByRole('button', { name: '重试' })[0]);
      expect(await screen.findByText(toast)).toBeTruthy();
    },
  );

  it('offers no retry while every read is pending', () => {
    render(
      <ShellTitleProvider>
        <ToastProvider>
          <SampleAdmin
            tab="conn"
            query={{ wecom: 'on', empty: false, pending: true }}
            retry="ok"
          />
        </ToastProvider>
      </ShellTitleProvider>,
    );
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
  });
});
