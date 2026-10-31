// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { testView } from '../../test-helpers';
import { draftKey } from '../../send';
import { FIT_MAX, FindBox } from './FindBox';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('motion/react', async () => {
  const original =
    await vi.importActual<typeof import('motion/react')>('motion/react');
  return { ...original, useReducedMotion: () => true };
});

const view = testView({ role: 'manager', displayName: '演示管理者' });
const field = () =>
  screen.getByRole('textbox', {
    name: '描述你要找什么样的人',
  }) as HTMLTextAreaElement;

beforeEach(() => {
  push.mockReset();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('FindBox', () => {
  it('keeps the placeholder the example panel depends on, and no templates', () => {
    render(<FindBox view={view} />);
    expect(field().getAttribute('placeholder')).toBe(
      '描述你需要什么样的人：业务目标、必须项和加分项',
    );
    expect(screen.getByText('试试这样说')).toBeTruthy();
    expect(screen.queryByText('或从角色模板开始')).toBeNull();
    expect(screen.queryByRole('button', { name: '语音输入' })).toBeNull();
  });

  it('sends with Enter, adds a line with Shift + Enter, ignores composing Enter', async () => {
    vi.useFakeTimers();
    render(<FindBox view={view} />);
    fireEvent.change(field(), { target: { value: 'MaaS 要一个后端牵头人' } });
    fireEvent.keyDown(field(), { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(field(), { key: 'Enter', isComposing: true });
    fireEvent.keyDown(field(), { key: 'Enter', keyCode: 229 });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(push).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: 'Enter' });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(push).toHaveBeenCalledWith('/staffing?new=1&draft=work');
    expect(sessionStorage.getItem(draftKey('staffing'))).toContain('MaaS');
  });

  it('sends a just-happened sentence to record when the manager may record', async () => {
    vi.useFakeTimers();
    render(<FindBox view={view} />);
    fireEvent.change(field(), {
      target: { value: '孟逸尘今天主动同步了任务池' },
    });
    fireEvent.click(screen.getByRole('button', { name: '开始找人' }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(push).toHaveBeenCalledWith('/record?draft=work');
  });

  it('focuses instead of sending when empty; Esc leaves the field', async () => {
    const user = userEvent.setup();
    render(<FindBox view={view} />);
    await user.click(screen.getByRole('button', { name: '开始找人' }));
    expect(document.activeElement).toBe(field());
    expect(push).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(document.activeElement).not.toBe(field());
  });

  it('grows with the text up to the limit, then scrolls inside', () => {
    let scrollHeight = 40;
    vi.spyOn(
      HTMLTextAreaElement.prototype,
      'scrollHeight',
      'get',
    ).mockImplementation(() => scrollHeight);
    render(<FindBox view={view} />);
    expect(field().style.height).toBe('40px');
    expect(field().style.overflowY).toBe('hidden');
    scrollHeight = 320;
    fireEvent.change(field(), { target: { value: '很长\n'.repeat(20) } });
    expect(field().style.height).toBe(`${FIT_MAX}px`);
    expect(field().style.overflowY).toBe('auto');
  });

  it('fills an example and keeps focus in the box', async () => {
    const user = userEvent.setup();
    render(<FindBox view={view} />);
    await user.click(
      screen.getByRole('button', {
        name: 'MaaS 智能体平台要一个能牵头应用后端的人，10 月到岗',
      }),
    );
    expect(field().value).toBe(
      'MaaS 智能体平台要一个能牵头应用后端的人，10 月到岗',
    );
    expect(document.activeElement).toBe(field());
    expect(screen.getByRole('img', { name: '小犇：倾听' })).toBeTruthy();
  });

  it('says so and stays when the handover cannot be stored', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    render(<FindBox view={view} />);
    fireEvent.change(field(), { target: { value: '找一个负责人' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toBe(
      '转交失败，请再点一次发送',
    );
    expect(push).not.toHaveBeenCalled();
  });
});
