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
import { Composer } from './Composer';

const { push, reduced } = vi.hoisted(() => ({
  push: vi.fn(),
  reduced: vi.fn(() => false),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('motion/react', async () => {
  const original =
    await vi.importActual<typeof import('motion/react')>('motion/react');
  return { ...original, useReducedMotion: reduced };
});

const field = () => screen.getByRole('textbox', { name: '描述你要做的事' });
const menu = () => screen.getByRole('listbox', { hidden: true });
/** Options a user can see: none while the menu is hidden. */
const options = () =>
  menu().hidden ? [] : screen.queryAllByRole('option', { hidden: true });

beforeEach(() => {
  push.mockReset();
  reduced.mockReturnValue(false);
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Composer sending', () => {
  it('sends with ⌘ or Ctrl + Enter after 小犇 thinks, handing the text over in session storage', async () => {
    vi.useFakeTimers();
    render(<Composer view={testView()} />);
    fireEvent.change(field(), { target: { value: '  谷嘉树补了覆盖率  ' } });
    expect(screen.getByRole('img', { name: '小犇：倾听' })).toBeTruthy();
    fireEvent.keyDown(field(), { key: 'Enter', metaKey: true });
    expect(screen.getByRole('img', { name: '小犇：思考' })).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(450));
    expect(push).toHaveBeenCalledWith('/record?draft=work');
    expect(JSON.parse(sessionStorage.getItem(draftKey('record'))!)).toEqual({
      accountId: 'test-account',
      text: '谷嘉树补了覆盖率',
      savedAt: expect.any(Number),
    });
    // Repeated triggers while leaving are ignored.
    fireEvent.keyDown(field(), { key: 'Enter', ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('routes find words to find people and leaves at once under reduced motion', async () => {
    vi.useFakeTimers();
    reduced.mockReturnValue(true);
    render(<Composer view={testView()} />);
    fireEvent.change(field(), { target: { value: '这个项目谁来负责' } });
    fireEvent.keyDown(field(), { key: 'Enter', ctrlKey: true });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(push).toHaveBeenCalledWith('/staffing?new=1&draft=work');
    expect(sessionStorage.getItem(draftKey('staffing'))).toContain(
      '这个项目谁来负责',
    );
  });

  it('keeps Enter as a new line, ignores composing Enter, focuses on empty send', async () => {
    const user = userEvent.setup();
    render(<Composer view={testView()} />);
    fireEvent.keyDown(field(), { key: 'Enter' });
    fireEvent.keyDown(field(), {
      key: 'Enter',
      metaKey: true,
      isComposing: true,
    });
    fireEvent.keyDown(field(), { key: 'Enter', metaKey: true, keyCode: 229 });
    await user.click(screen.getByRole('button', { name: '发送' }));
    expect(document.activeElement).toBe(field());
    expect(push).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it('keeps the text and says so when the handover cannot be stored', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    render(<Composer view={testView()} />);
    fireEvent.change(field(), { target: { value: '一件事' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(screen.getByRole('alert').textContent).toBe(
      '转交失败，请再点一次发送',
    );
    expect((field() as HTMLTextAreaElement).value).toBe('一件事');
    expect(screen.getByRole('img', { name: '小犇：倾听' })).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it('fills an example sentence and focuses the field', async () => {
    const user = userEvent.setup();
    render(<Composer view={testView({ role: 'mentor' })} />);
    expect(field().getAttribute('placeholder')).toContain('按情境、行为、影响');
    await user.click(
      screen.getByRole('button', {
        name: '周初晴这周先画了接口图，再去找后端对齐',
      }),
    );
    expect((field() as HTMLTextAreaElement).value).toBe(
      '周初晴这周先画了接口图，再去找后端对齐',
    );
    expect(document.activeElement).toBe(field());
    expect(screen.getByRole('img', { name: '小犇：倾听' })).toBeTruthy();
  });

  it('shows the upload clip only when an upload section provides an anchor', () => {
    const { rerender } = render(<Composer view={testView()} />);
    expect(screen.queryByRole('link', { name: '上传材料' })).toBeNull();
    rerender(<Composer view={testView()} uploadAnchor="#upload" />);
    expect(
      screen.getByRole('link', { name: '上传材料' }).getAttribute('href'),
    ).toBe('#upload');
  });
});

describe('Composer slash commands', () => {
  it('opens on "/", filters by name or shortcut and selects the first', () => {
    render(<Composer view={testView()} />);
    expect(menu().hidden).toBe(true);
    fireEvent.change(field(), { target: { value: '/' } });
    expect(menu().hidden).toBe(false);
    expect(options().map((option) => option.textContent)).toEqual([
      '记一件事/记',
      '为项目找人/找',
    ]);
    expect(options()[0].getAttribute('aria-selected')).toBe('true');
    expect(field().getAttribute('aria-activedescendant')).toBe('slash-record');
    expect(field().getAttribute('aria-controls')).toBe('slash');
    fireEvent.change(field(), { target: { value: '/找' } });
    expect(options().map((option) => option.textContent)).toEqual([
      '为项目找人/找',
    ]);
    fireEvent.change(field(), { target: { value: '/记一' } });
    expect(options()).toHaveLength(1);
    fireEvent.change(field(), { target: { value: '/盘' } });
    expect(menu().hidden).toBe(true);
    expect(field().getAttribute('aria-activedescendant')).toBeNull();
  });

  it('cycles with arrow keys, opens the selection with Enter, closes with Esc', () => {
    render(<Composer view={testView()} />);
    fireEvent.change(field(), { target: { value: '/' } });
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    expect(field().getAttribute('aria-activedescendant')).toBe('slash-find');
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(field().getAttribute('aria-activedescendant')).toBe('slash-record');
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/staffing?new=1');
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(menu().hidden).toBe(true);
    // Arrow keys do nothing once closed; typing again reopens.
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    fireEvent.change(field(), { target: { value: '/记' } });
    expect(menu().hidden).toBe(false);
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(push).toHaveBeenLastCalledWith('/record');
  });

  it('offers find people only with find_people', () => {
    render(
      <Composer
        view={testView({
          role: 'mentor',
          entries: { record: true, findPeople: false },
        })}
      />,
    );
    fireEvent.change(field(), { target: { value: '/' } });
    expect(options().map((option) => option.getAttribute('href'))).toEqual([
      '/record',
    ]);
    fireEvent.change(field(), { target: { value: '/找' } });
    expect(menu().hidden).toBe(true);
  });
});
