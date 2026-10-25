// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Avatar } from './Avatar';
import { Badge } from './Badge';
import { State } from './State';
import { Dialog } from './Dialog';
import { Niu } from '../brand/Niu';
const { reduced } = vi.hoisted(() => ({ reduced: vi.fn(() => false) }));
vi.mock('motion/react', async () => {
  const original =
    await vi.importActual<typeof import('motion/react')>('motion/react');
  return { ...original, useReducedMotion: reduced };
});
beforeEach(() => reduced.mockReturnValue(false));
afterEach(cleanup);
describe('prototype primitives', () => {
  it('keeps photos, initials, sizes and accessible brand states', () => {
    const view = render(
      <>
        <Avatar name="测试" hue={20} photo="lin-zhiyuan" size="" />
        <Avatar name="另一个" hue={30} size="lg" />
        <Badge>演示</Badge>
        <State title="完成" />
        <Niu size={32} />
      </>,
    );
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe(
      '/avatars/lin-zhiyuan.jpg',
    );
    expect(view.container.querySelector('.n-avatar--lg')?.textContent).toBe(
      '另',
    );
    expect(screen.getByRole('heading', { name: '完成' })).toBeTruthy();
    reduced.mockReturnValue(true);
    view.rerender(<Niu size={64} state="done" />);
    expect(
      screen.getByRole('img', { name: '小犇：完成' }).getAttribute('data-size'),
    ).toBe('l');
  });
  it('closes on outside interaction and traps Escape during pending submission', async () => {
    const close = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <Dialog open onOpenChange={close} title="测试弹窗">
        <button>第一个控件</button>
      </Dialog>,
    );
    await user.click(document.querySelector('.n-dialog-overlay')!);
    expect(close).toHaveBeenCalledWith(false);
    close.mockClear();
    view.rerender(
      <Dialog open busy onOpenChange={close} title="测试弹窗">
        <button>处理中</button>
      </Dialog>,
    );
    await user.click(document.querySelector('.n-dialog-overlay')!);
    await user.keyboard('{Escape}');
    expect(close).not.toHaveBeenCalled();
  });
});
