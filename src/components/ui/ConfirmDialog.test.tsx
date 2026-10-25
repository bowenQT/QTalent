// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog, type ConfirmAction } from './ConfirmDialog';
import { Textarea } from './Textarea';
afterEach(cleanup);
const cancel = (onSelect = vi.fn()): ConfirmAction => ({
  id: 'cancel',
  label: '取消',
  variant: 'ghost',
  onSelect,
});
describe('ConfirmDialog', () => {
  it('shows the explanation, facts and actions with their button styles', async () => {
    const user = userEvent.setup();
    const archive = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="改为归档？"
        description="事件和方案引用了这个项目。"
        facts={['关联事件 6 条', '已确认方案 1 个（v2，10-20）']}
        actions={[
          cancel(),
          {
            id: 'archive',
            label: '改为归档',
            variant: 'ink',
            icon: 'archive',
            onSelect: archive,
          },
          { id: 'plain', label: '稍后', onSelect: vi.fn() },
        ]}
      />,
    );
    expect(screen.getByRole('dialog', { name: '改为归档？' })).toBeTruthy();
    expect(screen.getByText('事件和方案引用了这个项目。')).toBeTruthy();
    expect(
      [...document.querySelectorAll('.n-dialog__facts li')].map(
        (item) => item.textContent,
      ),
    ).toEqual(['关联事件 6 条', '已确认方案 1 个（v2，10-20）']);
    expect(screen.getByRole('button', { name: '取消' }).className).toBe(
      'n-btn n-btn--ghost',
    );
    expect(screen.getByRole('button', { name: '稍后' }).classList).toHaveLength(
      1,
    );
    const confirm = screen.getByRole('button', { name: '改为归档' });
    expect(confirm.className).toBe('n-btn n-btn--ink');
    expect(confirm.querySelector('svg')).toBeTruthy();
    await user.click(confirm);
    expect(archive).toHaveBeenCalledOnce();
    // 弹窗不替调用方关闭
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
  it('keeps the dialog open when validation fails, focuses the first empty required field and hints above the bar', async () => {
    const user = userEvent.setup();
    const reject = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="退回这次修订？"
        actions={[
          cancel(),
          {
            id: 'reject',
            label: '退回',
            variant: 'ink',
            validate: (dialog) =>
              dialog.querySelector('textarea')?.value.trim() !== '',
            onSelect: reject,
          },
        ]}
      >
        <Textarea label="退回理由" note="必填" />
      </ConfirmDialog>,
    );
    await user.click(screen.getByRole('button', { name: '退回' }));
    expect(reject).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
    const reason = screen.getByRole('textbox', { name: '退回理由 必填' });
    expect(document.activeElement).toBe(reason);
    expect(reason.closest('.n-field')?.classList.contains('is-error')).toBe(
      true,
    );
    const hint = screen.getByRole('alert');
    expect(hint.textContent).toBe('请先填写「退回理由」');
    expect(hint.className).toBe('n-dialog__hint');
    expect(hint.nextElementSibling?.className).toBe('n-dialog__bar');
    // 输入后提示与红框一起消失，再点才会执行
    await user.type(reason, '分数没有依据');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(reason.closest('.n-field')?.classList.contains('is-error')).toBe(
      false,
    );
    await user.click(screen.getByRole('button', { name: '退回' }));
    expect(reject).toHaveBeenCalledOnce();
  });
  it('skips optional fields, prefers the validator message and falls back when nothing is empty', async () => {
    const user = userEvent.setup();
    const validate = vi.fn<(dialog: HTMLElement) => boolean | string>();
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="确认"
        actions={[
          {
            id: 'go',
            label: '确认',
            validate,
            hint: '还差一项',
            onSelect: vi.fn(),
          },
        ]}
      >
        <Textarea label="备注" note="可选" />
        <Textarea label="理由" />
        <textarea aria-label="补充说明" data-optional="" />
      </ConfirmDialog>,
    );
    validate.mockReturnValue(false);
    await user.click(screen.getByRole('button', { name: '确认' }));
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: '理由' }),
    );
    expect(screen.getByRole('alert').textContent).toBe('还差一项');
    validate.mockReturnValue('理由要写具体');
    await user.click(screen.getByRole('button', { name: '确认' }));
    expect(screen.getByRole('alert').textContent).toBe('理由要写具体');
    await user.type(screen.getByRole('textbox', { name: '理由' }), '写了');
    validate.mockReturnValue(false);
    await user.click(screen.getByRole('button', { name: '确认' }));
    expect(screen.getByRole('alert').textContent).toBe('还差一项');
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: '确认' }),
    );
  });
  it('names a field without a visible label from aria-label, or says so generically', async () => {
    const user = userEvent.setup();
    const actions = [
      { id: 'go', label: '确认', validate: () => false, onSelect: vi.fn() },
    ];
    const { rerender } = render(
      <ConfirmDialog open onOpenChange={vi.fn()} title="确认" actions={actions}>
        <textarea aria-label="退回原因（必填）" />
      </ConfirmDialog>,
    );
    await user.click(screen.getByRole('button', { name: '确认' }));
    expect(screen.getByRole('alert').textContent).toBe('请先填写「退回原因」');
    rerender(
      <ConfirmDialog open onOpenChange={vi.fn()} title="确认" actions={actions}>
        <textarea />
      </ConfirmDialog>,
    );
    await user.click(screen.getByRole('button', { name: '确认' }));
    expect(screen.getByRole('alert').textContent).toBe('请先填写这一项');
  });
  it('shows the generic hint when validation fails with nothing empty to point at', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="确认"
        actions={[
          { id: 'go', label: '确认', validate: () => false, onSelect: vi.fn() },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: '确认' }));
    expect(screen.getByRole('alert').textContent).toBe('还有必填项没填');
  });
  it('does not stack a hint on top of an error the dialog already shows', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="确认"
        actions={[
          { id: 'go', label: '确认', validate: () => false, onSelect: vi.fn() },
        ]}
      >
        <Textarea label="理由" error="理由太短" />
      </ConfirmDialog>,
    );
    await user.click(screen.getByRole('button', { name: '确认' }));
    expect(
      screen.getAllByRole('alert').map((node) => node.textContent),
    ).toEqual(['理由太短']);
  });
  it('ignores Escape, outside clicks and buttons while busy, and closes when idle', async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    const act = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        open
        busy
        onOpenChange={change}
        title="确认并冻结"
        actions={[
          { id: 'go', label: '确认并冻结', variant: 'seal', onSelect: act },
        ]}
      />,
    );
    await user.keyboard('{Escape}');
    await user.click(document.querySelector('.n-dialog-overlay')!);
    expect(change).not.toHaveBeenCalled();
    const button = screen.getByRole('button', {
      name: '确认并冻结',
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.className).toBe('n-btn n-btn--seal');
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    rerender(
      <ConfirmDialog
        open
        onOpenChange={change}
        title="确认并冻结"
        actions={[
          { id: 'go', label: '确认并冻结', variant: 'seal', onSelect: act },
        ]}
      />,
    );
    await user.keyboard('{Escape}');
    expect(change).toHaveBeenCalledWith(false);
  });
  it('forgets the hint after the dialog is reopened', async () => {
    const user = userEvent.setup();
    const props = {
      onOpenChange: vi.fn(),
      title: '确认',
      actions: [
        { id: 'go', label: '确认', validate: () => false, onSelect: vi.fn() },
      ],
    };
    const { rerender } = render(<ConfirmDialog open {...props} />);
    await user.click(screen.getByRole('button', { name: '确认' }));
    expect(screen.getByRole('alert')).toBeTruthy();
    rerender(<ConfirmDialog open={false} {...props} />);
    rerender(<ConfirmDialog open {...props} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
