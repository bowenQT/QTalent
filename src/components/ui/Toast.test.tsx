// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { Toast, ToastProvider, useToast, type ToastOptions } from './Toast';
const { reduced } = vi.hoisted(() => ({ reduced: vi.fn(() => false) }));
vi.mock('motion/react', async () => {
  const original =
    await vi.importActual<typeof import('motion/react')>('motion/react');
  return { ...original, useReducedMotion: reduced };
});
beforeEach(() => {
  reduced.mockReturnValue(false);
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (Element.prototype as { animate?: unknown }).animate;
});
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
function Shown(props: ToastOptions & { message?: string }) {
  const { message = '已保存到 林知远 的档案', ...options } = props;
  const toast = useToast();
  return <button onClick={() => toast.show(message, options)}>保存</button>;
}
function renderToast(options: ToastOptions) {
  const view = render(
    <ToastProvider>
      <Shown {...options} />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  return view;
}
const toast = () => document.querySelector('.n-toast');
describe('plain toast', () => {
  it('shows for 3.2 seconds then calls onExpire once', async () => {
    const expire = vi.fn();
    renderToast({ onExpire: expire });
    expect(toast()?.textContent).toBe('已保存到 林知远 的档案');
    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull();
    await tick(3199);
    expect(toast()).toBeTruthy();
    expect(expire).not.toHaveBeenCalled();
    await tick(1);
    expect(toast()).toBeNull();
    expect(expire).toHaveBeenCalledOnce();
    await tick(10000);
    expect(expire).toHaveBeenCalledOnce();
  });
  it('honours a custom duration', async () => {
    renderToast({ duration: 1000 });
    await tick(999);
    expect(toast()).toBeTruthy();
    await tick(1);
    expect(toast()).toBeNull();
  });
});
describe('undo toast', () => {
  it('counts down 5 seconds with a ring, then expires once', async () => {
    const expire = vi.fn();
    const undo = vi.fn();
    renderToast({ onUndo: undo, onExpire: expire });
    await tick(20);
    expect(toast()?.classList.contains('is-counting')).toBe(true);
    expect(toast()?.querySelector('.n-toast__ring circle.run')).toBeTruthy();
    await tick(4979);
    expect(toast()).toBeTruthy();
    expect(expire).not.toHaveBeenCalled();
    await tick(1);
    expect(toast()).toBeNull();
    expect(expire).toHaveBeenCalledOnce();
    expect(undo).not.toHaveBeenCalled();
  });
  it('undoes synchronously: stops the countdown, shows 已撤销 for 1.6 seconds and never expires', async () => {
    const expire = vi.fn();
    const undo = vi.fn();
    renderToast({ onUndo: undo, onExpire: expire });
    await tick(2000);
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    await tick(0);
    expect(undo).toHaveBeenCalledOnce();
    expect(toast()?.textContent).toBe('已撤销');
    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull();
    await tick(1599);
    expect(toast()).toBeTruthy();
    await tick(1);
    expect(toast()).toBeNull();
    await tick(10000);
    expect(expire).not.toHaveBeenCalled();
  });
  it('lets the caller word the undone text', async () => {
    renderToast({ onUndo: vi.fn(), undoneText: '已撤销，记录没有保存' });
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    await tick(0);
    expect(toast()?.textContent).toBe('已撤销，记录没有保存');
  });
  it('async undo: busy and single-flight, countdown stopped, 已撤销 only after it succeeds', async () => {
    let finish: () => void = () => undefined;
    const undo = vi.fn(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    const expire = vi.fn();
    renderToast({ onUndo: undo, onExpire: expire });
    await tick(4000);
    const button = screen.getByRole('button', { name: '撤销' });
    fireEvent.click(button);
    fireEvent.click(button);
    await tick(0);
    expect(undo).toHaveBeenCalledOnce();
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(toast()?.textContent).toBe('已保存到 林知远 的档案撤销');
    expect(toast()?.classList.contains('is-counting')).toBe(false);
    // 原来的 5 秒已经过完也不会消失、不会到期
    await tick(30000);
    expect(toast()).toBeTruthy();
    expect(expire).not.toHaveBeenCalled();
    finish();
    await tick(0);
    expect(toast()?.textContent).toBe('已撤销');
    await tick(1600);
    expect(toast()).toBeNull();
    expect(expire).not.toHaveBeenCalled();
  });
  it('keeps the toast with the failure text and a retry when async undo fails', async () => {
    const attempts: Array<{
      resolve: () => void;
      reject: (error: Error) => void;
    }> = [];
    const undo = vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          attempts.push({ resolve, reject });
        }),
    );
    const expire = vi.fn();
    renderToast({
      onUndo: undo,
      onExpire: expire,
      failedText: '没有撤销成功，记录仍然有效',
      retryLabel: '再试一次',
    });
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    await tick(0);
    act(() => attempts[0].reject(new Error('offline')));
    await tick(0);
    expect(toast()?.textContent).toContain('没有撤销成功，记录仍然有效');
    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull();
    await tick(60000);
    expect(toast()).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '再试一次' }));
    await tick(0);
    expect(undo).toHaveBeenCalledTimes(2);
    expect(toast()?.textContent).toBe('已保存到 林知远 的档案撤销');
    act(() => attempts[1].resolve());
    await tick(0);
    expect(toast()?.textContent).toBe('已撤销');
    await tick(1600);
    expect(toast()).toBeNull();
    expect(expire).not.toHaveBeenCalled();
  });
  it('treats a synchronous throw as a failed undo and lets the user close the toast without expiring it', async () => {
    const expire = vi.fn();
    renderToast({
      onUndo: () => {
        throw new Error('offline');
      },
      onExpire: expire,
    });
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    await tick(0);
    expect(toast()?.textContent).toContain('撤销没有成功');
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(toast()).toBeNull();
    await tick(10000);
    expect(expire).not.toHaveBeenCalled();
  });
});
describe('motion', () => {
  it('slides in and animates the ring normally', async () => {
    const animate = vi.fn();
    Element.prototype.animate = animate;
    renderToast({ onUndo: vi.fn() });
    await tick(20);
    expect(animate).toHaveBeenCalledOnce();
    expect(JSON.stringify(animate.mock.calls[0][0])).toContain(
      'translateY(8px)',
    );
    expect(toast()?.classList.contains('is-counting')).toBe(true);
  });
  it('has no slide-in and a still ring under reduced motion, but the countdown still works', async () => {
    reduced.mockReturnValue(true);
    const animate = vi.fn();
    Element.prototype.animate = animate;
    const expire = vi.fn();
    renderToast({ onUndo: vi.fn(), onExpire: expire });
    await tick(20);
    expect(animate).not.toHaveBeenCalled();
    expect(toast()?.classList.contains('is-counting')).toBe(false);
    await tick(4980);
    expect(toast()).toBeNull();
    expect(expire).toHaveBeenCalledOnce();
  });
});
describe('Toast host', () => {
  it('is a polite live region that stacks toasts and dismisses one early without expiring it', async () => {
    const expire = vi.fn();
    function Two() {
      const { show } = useToast();
      return (
        <button
          onClick={() => {
            const dismiss = show('第一条', { onExpire: expire });
            show('第二条');
            dismiss();
          }}
        >
          两条
        </button>
      );
    }
    render(
      <ToastProvider>
        <Two />
      </ToastProvider>,
    );
    const host = document.querySelector('.nt-toasts');
    expect(host?.getAttribute('role')).toBe('status');
    expect(host?.getAttribute('aria-live')).toBe('polite');
    fireEvent.click(screen.getByRole('button', { name: '两条' }));
    expect(
      [...document.querySelectorAll('.n-toast')].map(
        (node) => node.textContent,
      ),
    ).toEqual(['第二条']);
    await tick(10000);
    expect(expire).not.toHaveBeenCalled();
  });
  it('requires a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Shown />)).toThrow('ToastProvider');
  });
  it('can render a single toast directly', async () => {
    const close = vi.fn();
    render(<Toast message="直接渲染" onClose={close} />);
    await tick(3200);
    expect(close).toHaveBeenCalledOnce();
  });
});
