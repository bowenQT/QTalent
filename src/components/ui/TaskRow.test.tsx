// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskRow, type TaskState } from './TaskRow';

afterEach(cleanup);

// 状态与图标、文字的对应取自 BOW-855 spec 第 2 节。
const mapping: [TaskState, string, string][] = [
  ['uploading', 'upload', '上传中'],
  ['queued', 'clock', '已提交，排队中'],
  ['transcribing', 'wave', '转写中'],
  ['shaping', 'spark', '整理中'],
  ['partial', 'split', '部分待核对'],
  ['done', 'check', '已完成'],
  ['failed', 'x', '整理失败'],
];

function row(
  state: TaskState,
  props: Partial<Parameters<typeof TaskRow>[0]> = {},
) {
  return render(
    <TaskRow state={state} name="W3 导师团复盘.m4a" note="说明" {...props} />,
  );
}

describe('TaskRow', () => {
  it.each(mapping)(
    '%s shows the %s icon and the text 「%s」',
    (state, icon, label) => {
      const { container } = row(state);
      const task = container.querySelector('.n-task')!;
      expect(task.getAttribute('data-state')).toBe(state);
      expect(
        task.querySelector('.n-task__icon use')?.getAttribute('href'),
      ).toBe(`#i-${icon}`);
      expect(task.querySelector('.n-task__state')?.textContent).toBe(
        `${label} · 说明`,
      );
      expect(task.querySelector('.n-task__state b')?.textContent).toBe(label);
    },
  );

  it('shows 取消 only when canCancel is true, whatever the state', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    const view = row('uploading');
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull();
    view.unmount();
    row('done', { canCancel: true, onCancel });
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows 重试整理 only when canRetry is true, whatever the state', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    const view = row('failed');
    expect(screen.queryByRole('button', { name: /重试整理/ })).toBeNull();
    view.unmount();
    row('queued', { canRetry: true, onRetry });
    await user.click(screen.getByRole('button', { name: '重试整理' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('puts the caller actions with the built-in ones, and nothing when there are none', () => {
    const view = row('partial', {
      canCancel: true,
      canRetry: true,
      actions: <a href="/inbox">去核对</a>,
    });
    expect(
      [...view.container.querySelectorAll('.n-task__acts > *')].map(
        (e) => e.textContent,
      ),
    ).toEqual(['取消', '去核对', '重试整理']);
    view.unmount();
    const bare = row('queued');
    expect(bare.container.querySelector('.n-task__acts')).toBeNull();
    expect(bare.container.querySelector('.n-task')?.children).toHaveLength(3);
  });

  it('shows byte progress for uploads and an unknown-length bar for transcribing and shaping', () => {
    const upload = row('uploading', { progress: 62 });
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('62');
    expect(bar.querySelector('i')?.style.width).toBe('62%');
    upload.unmount();
    for (const state of ['transcribing', 'shaping'] as const) {
      const view = row(state);
      expect(screen.getByRole('progressbar').className).toContain(
        'is-indeterminate',
      );
      view.unmount();
    }
    for (const state of ['queued', 'partial', 'done', 'failed'] as const) {
      const view = row(state);
      expect(screen.queryByRole('progressbar')).toBeNull();
      view.unmount();
    }
  });

  it('lets the caller override the default bar', () => {
    const none = row('shaping', { progress: 'none' });
    expect(screen.queryByRole('progressbar')).toBeNull();
    none.unmount();
    const indeterminate = row('queued', { progress: 'indeterminate' });
    expect(screen.getByRole('progressbar').className).toContain(
      'is-indeterminate',
    );
    indeterminate.unmount();
    row('uploading');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
      '0',
    );
  });

  it('keeps the cancel button element while the upload progresses', () => {
    const view = row('uploading', { progress: 10, canCancel: true });
    const cancel = screen.getByRole('button', { name: '取消' });
    cancel.focus();
    view.rerender(
      <TaskRow
        state="uploading"
        name="W3 导师团复盘.m4a"
        note="已上传更多"
        progress={55}
        canCancel
      />,
    );
    expect(screen.getByRole('button', { name: '取消' })).toBe(cancel);
    expect(document.activeElement).toBe(cancel);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
      '55',
    );
  });

  it('renders a badge next to the name', () => {
    row('transcribing', {
      badge: <span className="n-badge n-badge--preset">演示</span>,
    });
    expect(document.querySelector('.n-task__name')?.textContent).toBe(
      'W3 导师团复盘.m4a演示',
    );
  });
});
