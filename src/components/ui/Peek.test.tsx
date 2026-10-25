// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';
import { Peek, usePeek } from './Peek';
const { reduced } = vi.hoisted(() => ({ reduced: vi.fn(() => false) }));
vi.mock('motion/react', async () => {
  const original =
    await vi.importActual<typeof import('motion/react')>('motion/react');
  return { ...original, useReducedMotion: reduced };
});
beforeEach(() => {
  reduced.mockReturnValue(false);
  // jsdom 不做布局，getClientRects 恒为空；让所有元素都“可见”以便找回触发元素
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([
    {},
  ] as unknown as DOMRectList);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function Harness({ version = 1 }: { version?: number }) {
  const peek = usePeek();
  return (
    <>
      <a
        key={`avatar-${version}`}
        className="avatar"
        href="#lin"
        {...peek.triggerProps('p:lin')}
      >
        林头像
      </a>
      <a
        key={`name-${version}`}
        className="name"
        href="#lin"
        {...peek.triggerProps('p:lin')}
      >
        林知远
      </a>
      <a href="#zhou" {...peek.triggerProps('p:zhou')}>
        周屿
      </a>
      <input aria-label="页面上的输入框" />
      <Peek
        open={peek.open}
        onClose={peek.close}
        labelledBy="peek-h"
        contentKey={peek.openKey}
      >
        <h2 id="peek-h">
          {peek.openKey === 'p:zhou' ? '周屿的速览' : '林知远的速览'}
        </h2>
        <button>记一件事</button>
      </Peek>
    </>
  );
}
const drawer = () => screen.queryByRole('dialog');
describe('Peek', () => {
  it('opens as a non-modal drawer named by its heading and takes focus', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(drawer()).toBeNull();
    await user.click(screen.getByRole('link', { name: '林知远' }));
    const open = screen.getByRole('dialog', { name: '林知远的速览' });
    expect(open.getAttribute('aria-modal')).toBe('false');
    expect(document.activeElement).toBe(open);
    expect(document.querySelector('.n-dialog-overlay')).toBeNull();
    await waitFor(() => expect(open.classList.contains('is-open')).toBe(true));
    expect(open.parentElement).toBe(document.body);
    // 非模态：页面其余部分不被屏蔽
    expect(document.body.getAttribute('aria-hidden')).toBeNull();
    expect(screen.getByLabelText('页面上的输入框')).toBeTruthy();
  });
  it('closes with Escape and the close button and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('link', { name: '林知远' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(drawer()).toBeNull());
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: '关闭速览' }));
    await waitFor(() => expect(drawer()).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
  it('closes on a click outside, but not inside, and does not steal focus from what was clicked', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('link', { name: '林知远' });
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: '记一件事' }));
    await user.click(screen.getByRole('heading', { name: '林知远的速览' }));
    expect(drawer()).toBeTruthy();
    await user.click(document.body);
    await waitFor(() => expect(drawer()).toBeNull());
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);
    const input = screen.getByLabelText('页面上的输入框');
    await user.click(input);
    await waitFor(() => expect(drawer()).toBeNull());
    expect(document.activeElement).toBe(input);
  });
  it('toggles on the same trigger and switches content, refocusing, on another', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const lin = screen.getByRole('link', { name: '林知远' });
    await user.click(lin);
    await user.click(lin);
    await waitFor(() => expect(drawer()).toBeNull());
    await user.click(lin);
    screen.getByRole('button', { name: '记一件事' }).focus();
    await user.click(screen.getByRole('link', { name: '周屿' }));
    const open = screen.getByRole('dialog', { name: '周屿的速览' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(document.activeElement).toBe(open);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(drawer()).toBeNull());
    expect(document.activeElement).toBe(
      screen.getByRole('link', { name: '周屿' }),
    );
  });
  it.each([
    ['meta', { metaKey: true }],
    ['ctrl', { ctrlKey: true }],
    ['shift', { shiftKey: true }],
    ['middle button', { button: 1 }],
  ])(
    'leaves %s-click to the browser so the detail page still opens',
    (_name, init) => {
      render(<Harness />);
      const notPrevented = fireEvent.click(
        screen.getByRole('link', { name: '林知远' }),
        init,
      );
      expect(notPrevented).toBe(true);
      expect(drawer()).toBeNull();
      expect(
        fireEvent.click(screen.getByRole('link', { name: '林知远' })),
      ).toBe(false);
      expect(drawer()).toBeTruthy();
    },
  );
  it('finds the trigger again by key after the page redraws, preferring the same kind and skipping hidden copies', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness version={1} />);
    await user.click(screen.getByRole('link', { name: '林知远' }));
    rerender(<Harness version={2} />);
    const hidden = document.createElement('a');
    hidden.href = '#lin';
    hidden.className = 'name';
    hidden.dataset.peek = 'p:lin';
    const wrapper = document.createElement('div');
    wrapper.setAttribute('aria-hidden', 'true');
    wrapper.append(hidden);
    document.body.prepend(wrapper);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(drawer()).toBeNull());
    expect(document.activeElement).toBe(
      screen.getByRole('link', { name: '林知远' }),
    );
    expect(document.activeElement).not.toBe(hidden);
    wrapper.remove();
  });
  it('lets an open confirmation dialog take Escape and clicks without closing the drawer', async () => {
    const user = userEvent.setup();
    function WithDialog() {
      const peek = usePeek();
      const [asking, setAsking] = useState(false);
      return (
        <>
          <a href="#lin" {...peek.triggerProps('p:lin')}>
            林知远
          </a>
          <Peek open={peek.open} onClose={peek.close} label="速览">
            <button onClick={() => setAsking(true)}>请 HRBP 复核</button>
          </Peek>
          <ConfirmDialog
            open={asking}
            onOpenChange={setAsking}
            title="请 HRBP 复核？"
            actions={[
              { id: 'ok', label: '发起复核', onSelect: () => setAsking(false) },
            ]}
          />
        </>
      );
    }
    render(<WithDialog />);
    await user.click(screen.getByRole('link', { name: '林知远' }));
    await user.click(screen.getByRole('button', { name: '请 HRBP 复核' }));
    expect(screen.getByRole('dialog', { name: '请 HRBP 复核？' })).toBeTruthy();
    await user.click(document.querySelector('.n-dialog-overlay')!);
    expect(screen.getByRole('dialog', { name: '速览' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '请 HRBP 复核？' })).toBeNull();
    expect(screen.getByRole('dialog', { name: '速览' })).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(drawer()).toBeNull());
  });
  it('keeps the drawer through its 220ms exit, or removes it at once under reduced motion', () => {
    vi.useFakeTimers();
    const view = render(
      <Peek open onClose={vi.fn()} label="速览">
        内容
      </Peek>,
    );
    act(() => vi.advanceTimersByTime(20));
    expect(drawer()?.classList.contains('is-open')).toBe(true);
    view.rerender(
      <Peek open={false} onClose={vi.fn()} label="速览">
        内容
      </Peek>,
    );
    expect(drawer()?.classList.contains('is-open')).toBe(false);
    act(() => vi.advanceTimersByTime(219));
    expect(drawer()).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(drawer()).toBeNull();
    reduced.mockReturnValue(true);
    view.rerender(
      <Peek open onClose={vi.fn()} label="速览">
        内容
      </Peek>,
    );
    view.rerender(
      <Peek open={false} onClose={vi.fn()} label="速览">
        内容
      </Peek>,
    );
    act(() => vi.advanceTimersByTime(1));
    expect(drawer()).toBeNull();
  });
  it('renders the static sample in place without a close button, focus or listeners', async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    const view = render(
      <>
        <input aria-label="其他输入" />
        <Peek demo open onClose={close} label="速览样张">
          样张内容
        </Peek>
      </>,
    );
    const sample = screen.getByRole('complementary', { name: '速览样张' });
    expect(sample.className).toBe('n-peek is-demo is-open');
    expect(sample.parentElement).toBe(view.container);
    expect(screen.queryByRole('button', { name: '关闭速览' })).toBeNull();
    expect(document.activeElement).not.toBe(sample);
    await user.keyboard('{Escape}');
    await user.click(document.body);
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole('complementary')).toBeTruthy();
  });
  it('has no close button when nothing can dismiss it', () => {
    render(
      <Peek open label="速览">
        内容
      </Peek>,
    );
    expect(screen.queryByRole('button', { name: '关闭速览' })).toBeNull();
  });
});
