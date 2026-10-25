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
import { Cite, citeSourceKinds, type CiteProps, type CiteSource } from './Cite';

const source: CiteSource = {
  kind: 'timestamp',
  title: 'W2 导师团复盘',
  location: '03:12–03:28',
  by: '叶青',
};
const granted = {
  index: 1,
  markLabel: '复盘录音',
  access: 'granted',
  source,
  quote: '每个方案的验收标准都写清楚了',
} satisfies CiteProps;
const locked = {
  index: 3,
  markLabel: '来源受限',
  access: 'locked',
  source: { kind: 'paragraph', title: '盘点讨论纪要', location: '第 4 段' },
  lockedText: '你只能看到它被引用了，看不到原文。',
} satisfies CiteProps;

let narrow = false;
beforeEach(() => {
  narrow = false;
  vi.stubGlobal('matchMedia', () => ({ matches: narrow }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mark = () => screen.getByRole('button', { name: /^引用/ });
const root = (view: ReturnType<typeof render>) =>
  view.container.querySelector('.n-cite') as HTMLElement;
const pop = (view: ReturnType<typeof render>) =>
  view.container.querySelector('.n-cite__pop') as HTMLElement;

describe('Cite opening and closing', () => {
  it('opens on hover and closes when the pointer leaves', async () => {
    const user = userEvent.setup();
    const view = render(<Cite {...granted} />);
    expect(root(view).className).toBe('n-cite');
    await user.hover(mark());
    expect(root(view).className).toContain('is-open');
    expect(mark().getAttribute('aria-expanded')).toBe('true');
    await user.unhover(mark());
    expect(root(view).className).toBe('n-cite');
  });

  it('opens on keyboard focus and closes when focus leaves the citation', async () => {
    const user = userEvent.setup();
    const view = render(
      <>
        <Cite {...granted} />
        <button>其他控件</button>
      </>,
    );
    await user.tab();
    expect(document.activeElement).toBe(mark());
    expect(root(view).className).toContain('is-open');
    await user.tab();
    expect(root(view).className).toBe('n-cite');
  });

  it('keeps focus-driven opening while focus moves inside the popover', async () => {
    const user = userEvent.setup();
    const view = render(
      <Cite
        {...granted}
        jump={{ label: '打开完整纪要', href: '#minutes' }}
        onPlay={() => undefined}
      />,
    );
    await user.tab();
    await user.tab();
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      '播放这一段',
    );
    expect(root(view).className).toContain('is-open');
  });

  it('stays open after a click until the next click, an outside press or Escape', async () => {
    const user = userEvent.setup();
    const view = render(
      <>
        <Cite {...granted} />
        <p>正文</p>
      </>,
    );
    await user.click(mark());
    await user.unhover(mark());
    // Focus stays on the mark after a click, so blur it to isolate the pinned state.
    act(() => mark().blur());
    expect(root(view).className).toContain('is-open');
    await user.click(screen.getByText('正文'));
    expect(root(view).className).toBe('n-cite');
    // A second click on the mark unpins it again.
    await user.click(mark());
    await user.click(mark());
    await user.unhover(mark());
    act(() => mark().blur());
    expect(root(view).className).toBe('n-cite');
  });

  it('dismisses with Escape even while hovered, and reopens on the next visit', async () => {
    const user = userEvent.setup();
    const view = render(<Cite {...granted} />);
    await user.hover(mark());
    expect(root(view).className).toContain('is-open');
    await user.keyboard('{Escape}');
    expect(root(view).className).toBe('n-cite');
    expect(pop(view).style.display).toBe('none');
    await user.unhover(mark());
    expect(pop(view).style.display).toBe('');
    await user.hover(mark());
    expect(root(view).className).toContain('is-open');
    // Escape must not touch a citation that is not open.
    await user.unhover(mark());
    await user.keyboard('{Escape}');
    expect(pop(view).style.display).toBe('');
  });

  it('also dismisses a focused citation and clears the dismissal on blur', async () => {
    const user = userEvent.setup();
    const view = render(
      <>
        <Cite {...granted} />
        <button>其他控件</button>
      </>,
    );
    await user.tab();
    await user.keyboard('{Escape}');
    expect(pop(view).style.display).toBe('none');
    await user.tab();
    expect(pop(view).style.display).toBe('');
  });
});

describe('Cite content and access', () => {
  it('shows the source, the quote and caller-supplied jump targets', async () => {
    const select = vi.fn();
    const play = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <>
        <Cite
          {...granted}
          onPlay={play}
          playText="播放 03:12 起的 10 秒"
          jump={{ label: '打开完整纪要', onSelect: select }}
        />
        <Cite
          {...granted}
          index={2}
          markLabel="周报"
          jump={{ label: '打开周报', href: '#report' }}
        />
      </>,
    );
    const [first, second] = [
      ...view.container.querySelectorAll('.n-cite__pop'),
    ];
    expect(first.querySelector('.n-cite__src')?.textContent).toBe(
      'W2 导师团复盘 · 03:12–03:28 · 叶青',
    );
    expect(first.querySelector('.n-cite__quote')?.textContent).toBe(
      '每个方案的验收标准都写清楚了',
    );
    await user.click(screen.getAllByRole('button', { name: '播放这一段' })[0]);
    await user.click(screen.getByRole('button', { name: '打开完整纪要' }));
    expect(play).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledOnce();
    expect(second.querySelector('a')?.getAttribute('href')).toBe('#report');
    expect(second.querySelector('.n-player__play')).toBeNull();
    expect(first.textContent).toContain('播放 03:12 起的 10 秒');
  });

  it('plays only recordings and omits the foot with nothing to offer', () => {
    const view = render(
      <>
        <Cite
          {...granted}
          source={{ kind: 'page', title: '周报', location: '第 2 页' }}
          onPlay={() => undefined}
        />
        <Cite {...granted} index={2} />
      </>,
    );
    expect(view.container.querySelector('.n-player__play')).toBeNull();
    expect(view.container.querySelector('.n-cite__foot')).toBeNull();
  });

  it('never renders the original of a locked source, even if one is passed', () => {
    const secret = '这是只有评价人才能看的原文';
    const view = render(
      <Cite
        {...(locked as CiteProps)}
        {...({
          quote: secret,
          onPlay: () => undefined,
          jump: { label: '跳转', href: '#x' },
        } as object)}
      />,
    );
    expect(mark().getAttribute('data-kind')).toBe('locked');
    expect(view.container.textContent).not.toContain(secret);
    expect(view.container.querySelector('.n-cite__quote')).toBeNull();
    expect(view.container.querySelector('.n-player__play')).toBeNull();
    expect(view.container.querySelector('a')).toBeNull();
    expect(view.container.querySelector('.n-cite__locked')?.textContent).toBe(
      locked.lockedText,
    );
    expect(view.container.querySelector('.n-cite__src')?.textContent).toBe(
      '盘点讨论纪要 · 第 4 段',
    );
  });

  it('maps each source kind and rejects any other', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const kind of citeSourceKinds) {
      const view = render(
        <Cite
          {...granted}
          source={{ kind, title: '材料', location: '位置' }}
        />,
      );
      expect(pop(view).getAttribute('data-source-kind')).toBe(kind);
      view.unmount();
    }
    expect(() =>
      render(
        <Cite
          {...granted}
          source={{ kind: 'video' as never, title: 't', location: 'l' }}
        />,
      ),
    ).toThrow('Unknown citation source kind');
    expect(() =>
      render(
        <Cite
          {...(granted as CiteProps)}
          {...({ access: 'public' } as object)}
        />,
      ),
    ).toThrow('Unknown citation access');
  });
});

describe('Cite placement', () => {
  function stubGeometry(markTop: { value: number }) {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(
      function (this: HTMLElement) {
        return parseFloat(this.style.width) || 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains('m-screen'))
          return { left: 480, right: 760, top: 0, bottom: 800 } as DOMRect;
        return this.classList.contains('n-cite__mark')
          ? ({
              left: 500,
              width: 17,
              top: markTop.value,
              bottom: markTop.value + 17,
              right: 517,
            } as DOMRect)
          : ({} as DOMRect);
      },
    );
  }

  it('fixes the popover above the mark and follows scroll and resize', async () => {
    const markTop = { value: 400 };
    stubGeometry(markTop);
    const user = userEvent.setup();
    const view = render(<Cite {...granted} />);
    await user.hover(mark());
    expect(pop(view).classList.contains('is-placed')).toBe(true);
    expect(pop(view).style.width).toBe('320px');
    expect(pop(view).style.top).toBe('290px');
    expect(pop(view).style.left).toBe(`${500 + 17 / 2 - 160}px`);
    markTop.value = 250;
    fireEvent.scroll(document.body);
    expect(pop(view).style.top).toBe(`${250 - 10 - 100}px`);
    // Not enough room above: it drops below the mark.
    markTop.value = 60;
    fireEvent(window, new Event('resize'));
    expect(pop(view).style.top).toBe(`${60 + 17 + 10}px`);
    await user.unhover(mark());
    markTop.value = 400;
    fireEvent.scroll(document.body);
    expect(pop(view).style.top).toBe(`${60 + 17 + 10}px`);
  });

  it('uses the stylesheet bottom sheet on narrow screens', async () => {
    stubGeometry({ value: 400 });
    const user = userEvent.setup();
    const view = render(<Cite {...granted} />);
    await user.hover(mark());
    expect(pop(view).classList.contains('is-placed')).toBe(true);
    narrow = true;
    fireEvent(window, new Event('resize'));
    expect(pop(view).classList.contains('is-placed')).toBe(false);
    expect(pop(view).style.width).toBe('');
    expect(pop(view).style.top).toBe('');
  });

  it('stays inside a phone frame when the mark is near its edge', async () => {
    stubGeometry({ value: 400 });
    const user = userEvent.setup();
    const view = render(
      <div className="m-screen">
        <Cite {...granted} />
      </div>,
    );
    await user.hover(mark());
    expect(pop(view).style.width).toBe('264px');
    expect(pop(view).style.left).toBe('488px');
  });
});
