// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GeneralSamples from './page';
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not-found');
  },
}));
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development');
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
describe('/dev/design-system/general', () => {
  it('is not served in a production build', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(GeneralSamples).toThrow('not-found');
  });
  it('lays out every sample the screenshot comparison looks for', () => {
    render(<GeneralSamples />);
    const names = [...document.querySelectorAll('[data-sample]')].map((node) =>
      node.getAttribute('data-sample'),
    );
    expect(names).toEqual(
      expect.arrayContaining([
        'badge-yes',
        'badge-no',
        'badge-unknown',
        'badge-conflict',
        'badge-ai',
        'badge-seal',
        'badge-demo',
        'badge-preset',
        'badge-recal',
        'select',
        'textarea-error',
        'check',
        'tabs',
        'seg',
        'menu',
        'chips',
        'open-delete',
        'open-freeze',
        'peek',
        'person-rows',
        'toast-run',
        'states',
        'fail',
      ]),
    );
    expect(
      document.querySelectorAll('[data-sample="states"] > .n-state'),
    ).toHaveLength(4);
  });
  it('filters with chips as a single choice and switches tabs and the segmented control', async () => {
    const user = userEvent.setup();
    render(<GeneralSamples />);
    const chips = within(screen.getByRole('group', { name: '按类型筛选' }));
    await user.click(chips.getByRole('button', { name: '象限变化' }));
    expect(
      chips
        .getAllByRole('button')
        .filter((button) => button.getAttribute('aria-pressed') === 'true')
        .map((button) => button.textContent),
    ).toEqual(['象限变化']);
    await user.click(screen.getByRole('tab', { name: /待核对/ }));
    expect(screen.getByRole('tabpanel').textContent).toContain('人名指代');
    await user.click(screen.getByRole('button', { name: '上一档案版本' }));
    expect(
      screen
        .getByRole('button', { name: '上一档案版本' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });
  it('opens the archive confirmation from the menu and from its button, and returns to the page when cancelled', async () => {
    const user = userEvent.setup();
    render(<GeneralSamples />);
    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await user.click(screen.getByRole('menuitem', { name: '编辑项目' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await user.click(screen.getByRole('menuitem', { name: '删除项目' }));
    expect(screen.getByRole('dialog', { name: '改为归档？' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '改为归档' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(
      screen.getByRole('button', { name: '删除「海外加速搜索体验」' }),
    );
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('freezes a plan only through its dialog and holds the return dialog until a reason is written', async () => {
    const user = userEvent.setup();
    render(<GeneralSamples />);
    await user.click(screen.getByRole('button', { name: '确认 v3 并冻结' }));
    expect(
      within(screen.getByRole('dialog', { name: '确认方案 v3' })).getByText(
        '确认不等于任命已经执行',
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '确认并冻结' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: '确认 v3 并冻结' }));
    await user.click(screen.getByRole('button', { name: '取消' }));
    await user.click(screen.getByRole('button', { name: '退回这次修订' }));
    await user.click(screen.getByRole('button', { name: '退回' }));
    expect(screen.getByRole('alert').textContent).toBe('请先填写「退回理由」');
    await user.type(
      screen.getByRole('textbox', { name: '退回理由 必填' }),
      '依据不足',
    );
    await user.click(screen.getByRole('button', { name: '退回' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: '退回这次修订' }));
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('opens the peek from a name, switches to another person and closes it', async () => {
    const user = userEvent.setup();
    render(<GeneralSamples />);
    await user.click(screen.getByRole('link', { name: '林知远' }));
    const drawer = screen.getByRole('dialog', { name: '林知远' });
    expect(drawer.getAttribute('aria-modal')).toBe('false');
    await user.click(screen.getByRole('link', { name: '周屿' }));
    expect(screen.getByRole('dialog', { name: '周屿' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '关闭速览' }));
    await vi.waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '周屿' })).toBeNull(),
    );
  });
  it('shows toasts, including an undo that fails once and succeeds on retry', async () => {
    const user = userEvent.setup();
    render(<GeneralSamples />);
    await user.click(screen.getByRole('button', { name: '普通提示' }));
    expect(screen.getByText('已复制链接')).toBeTruthy();
    await user.click(
      screen.getByRole('button', { name: '保存一条记录（第一次撤销会失败）' }),
    );
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(await screen.findByText('撤销没有成功，记录仍然有效')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('已撤销')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '保存一条记录' }));
    const [firstUndo] = screen.getAllByRole('button', { name: '撤销' });
    await user.click(firstUndo);
    expect(await screen.findByText('已撤销，记录没有保存')).toBeTruthy();
  });
});
