// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Anchor } from './Anchor';
import { Block, type BlockProps } from './Block';
import { History } from './History';
import { MatchState, matchStates, type MatchStateValue } from './MatchState';
import { Src, srcKinds, type SrcProps } from './Src';

afterEach(cleanup);

describe('Src', () => {
  it('renders the five classes with distinct names, classes and icons', () => {
    const view = render(
      <>
        {srcKinds.map((kind) => (
          <Src key={kind} kind={kind} />
        ))}
      </>,
    );
    const items = [...view.container.querySelectorAll('.n-src')];
    expect(items.map((el) => el.textContent)).toEqual([
      '原始事实',
      '本人自述',
      '管理观察',
      'AI 推断',
      '人工结论',
    ]);
    expect(items.map((el) => el.className)).toEqual(
      srcKinds.map((kind) => `n-src n-src--${kind}`),
    );
    expect(
      new Set(items.map((el) => el.querySelector('use')?.getAttribute('href')))
        .size,
    ).toBe(5);
  });

  it('allows a different name only inside the same class', () => {
    render(
      <>
        <Src kind="fact" label="历史资料" />
        <Src kind="ai" label="AI 草拟" />
        <Src kind="ai" label="AI 摘要" />
        <Src kind="ai" label="AI 回答" />
        <Src kind="ai" label="AI 假设" />
      </>,
    );
    for (const label of ['AI 摘要', 'AI 回答', 'AI 假设'])
      expect(screen.getByText(label).className).toBe('n-src n-src--ai');
    expect(screen.getByText('历史资料').className).toBe('n-src n-src--fact');
    expect(screen.getByText('AI 草拟').className).toBe('n-src n-src--ai');
  });

  it('rejects kinds and labels outside the enumeration', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const kind of ['hist', 'human-ai', 'toString', '__proto__', '']) {
      expect(() =>
        render(<Src {...({ kind } as unknown as SrcProps)} />),
      ).toThrow('Unknown source kind');
    }
    // An AI inference must not be able to wear the human label.
    expect(() =>
      render(
        <Src {...({ kind: 'ai', label: '人工结论' } as unknown as SrcProps)} />,
      ),
    ).toThrow('does not belong');
    vi.restoreAllMocks();
  });
});

describe('MatchState', () => {
  it('has the four states with icon and text, never colour alone', () => {
    const view = render(
      <>
        {matchStates.map((state) => (
          <MatchState key={state} state={state} />
        ))}
      </>,
    );
    const badges = [...view.container.querySelectorAll('.n-badge')];
    expect(badges.map((el) => el.textContent)).toEqual([
      '支持',
      '不支持',
      '资料不足',
      '证据冲突',
    ]);
    expect(badges.map((el) => el.className)).toEqual([
      'n-badge n-badge--yes',
      'n-badge n-badge--no',
      'n-badge n-badge--unknown',
      'n-badge n-badge--conflict',
    ]);
    for (const badge of badges)
      expect(badge.querySelector('svg use')).not.toBeNull();
  });

  it('rejects anything outside the four states', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const state of ['maybe', 'partial', 'toString', '']) {
      expect(() =>
        render(<MatchState state={state as unknown as MatchStateValue} />),
      ).toThrow('Unknown match state');
    }
    vi.restoreAllMocks();
  });
});

describe('Block', () => {
  it('signs ink blocks with a person and leaves AI blocks light and unsigned', () => {
    const view = render(
      <>
        <Block authorship="human" signer="叶青" meta="导师 · 10-21 确认">
          已确认的判断
        </Block>
        <Block authorship="ai" basis="依据 2 条事件" label="AI 建议">
          待确认的草拟
        </Block>
      </>,
    );
    const [ink, light] = [...view.container.querySelectorAll('.n-block')];
    expect(ink.getAttribute('data-state')).toBe('ink');
    expect(ink.querySelector('.n-block__sig')?.textContent).toBe('叶青');
    expect(ink.querySelector('.n-src--ai')).toBeNull();
    expect(light.getAttribute('data-state')).toBe('light');
    expect(light.querySelector('.n-block__sig')).toBeNull();
    expect(light.querySelector('.n-src--ai')?.textContent).toBe('AI 建议');
  });

  it('refuses an unsigned ink block and unknown authorship', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() =>
      render(
        <Block
          {...({ authorship: 'human', signer: ' ', meta: '' } as BlockProps)}
        >
          x
        </Block>,
      ),
    ).toThrow('needs a signer');
    expect(() =>
      render(
        <Block {...({ authorship: 'system' } as unknown as BlockProps)}>
          x
        </Block>,
      ),
    ).toThrow('Unknown block authorship');
    vi.restoreAllMocks();
  });
});

describe('History', () => {
  it('keeps every revision in the given order with reason, tint and metadata', () => {
    const view = render(
      <History
        entries={[
          {
            value: 4,
            origin: 'human',
            summary: '改分',
            reason: '两周内三次主动补位',
            meta: ['苏晚', 'HR 校准', '10-23'],
          },
          {
            value: 3,
            origin: 'human',
            summary: '确认',
            meta: ['叶青', '导师', '10-21'],
          },
          {
            value: 4,
            origin: 'ai',
            summary: 'AI 建议 · 锚点 4',
            meta: ['rubric-v1', '10-21'],
          },
        ]}
      />,
    );
    const items = [...view.container.querySelectorAll('li')];
    expect(
      items.map((li) => li.querySelector('.n-history__v')?.textContent),
    ).toEqual(['4', '3', '4']);
    expect(items[0].querySelector('.n-history__why')?.textContent).toBe(
      '两周内三次主动补位',
    );
    expect(items[1].textContent).toBe('3确认叶青 · 导师 · 10-21');
    expect(items.map((li) => li.querySelector('.is-ai') !== null)).toEqual([
      false,
      false,
      true,
    ]);
    expect(items[2].querySelector('small')?.textContent).toBe(
      'rubric-v1 · 10-21',
    );
  });
});

describe('Anchor', () => {
  const levels = ['一', '二', '三', '四', '五'] as const;

  it('opens from the keyboard, marks the hit levels and closes with Escape', async () => {
    const user = userEvent.setup();
    const view = render(
      <Anchor
        dimension="智慧力"
        ruleVersion="rubric-v1"
        levels={levels}
        hit={[4]}
      />,
    );
    const panel = view.container.querySelector('.n-anchor') as HTMLElement;
    const trigger = screen.getByRole('button', { name: '展开锚点' });
    expect(panel.hidden).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-controls')).toBe(panel.id);
    await user.tab();
    expect(document.activeElement).toBe(trigger);
    await user.keyboard('{Enter}');
    expect(panel.hidden).toBe(false);
    expect(screen.getByRole('button', { name: '收起锚点' })).toBe(trigger);
    expect(panel.textContent).toContain('智慧力 · 1–5 分锚点');
    expect(panel.textContent).toContain('rubric-v1');
    expect([...panel.querySelectorAll('li')].map((li) => li.className)).toEqual(
      ['', '', '', 'is-hit', ''],
    );
    await user.click(panel.querySelector('li')!);
    await user.keyboard('{Escape}');
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it('closes when the pointer goes elsewhere and can start open', async () => {
    const user = userEvent.setup();
    const view = render(
      <>
        <button>别处</button>
        <Anchor dimension="x" ruleVersion="v" levels={levels} defaultOpen />
      </>,
    );
    const panel = view.container.querySelector('.n-anchor') as HTMLElement;
    expect(panel.hidden).toBe(false);
    await user.click(screen.getByRole('button', { name: '别处' }));
    expect(panel.hidden).toBe(true);
    // Other keys leave a closed panel alone and an open one open.
    await user.click(screen.getByRole('button', { name: '展开锚点' }));
    await user.keyboard('{Shift}');
    expect(panel.hidden).toBe(false);
  });
});
