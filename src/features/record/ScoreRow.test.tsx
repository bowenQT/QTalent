// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { copy } from './copy';
import { draft, textRef } from './record.fixtures';
import { ScoreRow, type ScoreRowProps } from './ScoreRow';

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const suggested = draft.scores[0]!;
const unknown = draft.scores[1]!;

function setup(over: Partial<ScoreRowProps> = {}) {
  const props: ScoreRowProps = {
    dimension: '专业度',
    score: suggested,
    value: 3,
    confirmed: false,
    reason: '',
    readOnly: false,
    pickDisabled: false,
    loadSource: vi.fn(),
    inputFragmentId: textRef.fragmentId,
    onPick: vi.fn(),
    onReason: vi.fn(),
    onPreview: vi.fn(),
    ...over,
  };
  const view = render(<ScoreRow {...props} />);
  return { props, view };
}

describe('建议分', () => {
  it('点亮建议值，始终是 AI 建议（未确认），note 照原型写锚点和原话引用', () => {
    const { view } = setup();
    expect(
      view.container.querySelector('.n-score')?.getAttribute('data-state'),
    ).toBe('ai');
    const dots = screen.getAllByRole('radio');
    expect(dots).toHaveLength(5);
    expect(dots.filter((d) => d.classList.contains('is-on'))).toHaveLength(3);
    // 建议分尚未被任何人确认：没有选中的点
    expect(dots.every((d) => d.getAttribute('aria-checked') === 'false')).toBe(
      true,
    );
    expect(view.container.querySelector('.n-score__note')?.textContent).toBe(
      `${copy.score.anchorNote(3)}${copy.cite.inline}「独立完成」`,
    );
    expect(screen.getByRole('radiogroup', { name: '专业度分数' })).toBeTruthy();
  });

  it('点击任一分即确认；值相同＝确认，不出现理由框', async () => {
    const { props } = setup();
    await userEvent.click(screen.getByRole('radio', { name: '3 分' }));
    expect(props.onPick).toHaveBeenCalledWith(3);
  });

  it('确认后显示已确认；改分后显示差值、AI 原值和理由框', () => {
    const { view } = setup({ confirmed: true, value: 3 });
    expect(screen.getByText(copy.score.confirmed)).toBeTruthy();
    expect(view.container.querySelector('.n-score__why')).toBeNull();
    view.rerender(
      <ScoreRow
        dimension="专业度"
        score={suggested}
        value={4}
        confirmed
        reason=""
        readOnly={false}
        pickDisabled={false}
        loadSource={vi.fn()}
        onPick={vi.fn()}
        onReason={vi.fn()}
        onPreview={vi.fn()}
      />,
    );
    expect(screen.getByText('+1')).toBeTruthy();
    expect(screen.getByText(/AI 原为 3/)).toBeTruthy();
    expect(
      screen.getByPlaceholderText('为什么改成 4 分？（选填）'),
    ).toBeTruthy();
  });

  it('向下改低时留下浅色的 AI 原值点', () => {
    const { view } = setup({ confirmed: true, value: 1 });
    expect(view.container.querySelectorAll('.is-ghost')).toHaveLength(2);
  });

  it('差 2 分以上留空会转给 HR 复核（占位提示），理由可输入', async () => {
    const onReason = vi.fn();
    setup({ confirmed: true, value: 5, onReason });
    const why = screen.getByLabelText('专业度改分理由');
    expect(why.getAttribute('placeholder')).toBe(copy.score.whyReview(5));
    await userEvent.type(why, '带着大家做');
    expect(onReason).toHaveBeenLastCalledWith('做');
  });

  it('键盘：左右键移动并选中，Home/End 跳端点，边界不越界', () => {
    const { props } = setup({ value: 3 });
    const three = screen.getByRole('radio', { name: '3 分' });
    fireEvent.keyDown(three, { key: 'ArrowRight' });
    expect(props.onPick).toHaveBeenLastCalledWith(4);
    fireEvent.keyDown(three, { key: 'ArrowLeft' });
    expect(props.onPick).toHaveBeenLastCalledWith(2);
    fireEvent.keyDown(three, { key: 'Home' });
    expect(props.onPick).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(three, { key: 'End' });
    expect(props.onPick).toHaveBeenLastCalledWith(5);
    fireEvent.keyDown(three, { key: 'Tab' });
    expect(props.onPick).toHaveBeenCalledTimes(4);
  });

  it('边界上继续按键仍停在 1 或 5', () => {
    const { props } = setup({ value: 5 });
    fireEvent.keyDown(screen.getByRole('radio', { name: '5 分' }), {
      key: 'ArrowUp',
    });
    expect(props.onPick).toHaveBeenLastCalledWith(5);
  });

  it('悬停或聚焦某一分时通知右栏，离开时清除', async () => {
    const { props } = setup();
    const four = screen.getByRole('radio', { name: '4 分' });
    await userEvent.hover(four);
    expect(props.onPreview).toHaveBeenLastCalledWith(4);
    await userEvent.unhover(four);
    expect(props.onPreview).toHaveBeenLastCalledWith(null);
    four.focus();
    expect(props.onPreview).toHaveBeenLastCalledWith(4);
    four.blur();
    expect(props.onPreview).toHaveBeenLastCalledWith(null);
  });

  it('只有当前分可 Tab 进入（roving tabindex）', () => {
    setup({ value: 2 });
    const tabbable = screen
      .getAllByRole('radio')
      .filter((d) => d.getAttribute('tabindex') === '0');
    expect(tabbable.map((d) => d.getAttribute('aria-label'))).toEqual(['2 分']);
  });
});

describe('只读与不可改', () => {
  it('已保存：不再响应点击和按键，已确认且无理由时不显示理由框', async () => {
    const { props, view } = setup({ readOnly: true, confirmed: true });
    await userEvent.click(screen.getByRole('radio', { name: '5 分' }));
    fireEvent.keyDown(screen.getByRole('radio', { name: '3 分' }), {
      key: 'ArrowRight',
    });
    expect(props.onPick).not.toHaveBeenCalled();
    expect(view.container.querySelector('.n-score__why')).toBeNull();
  });

  it('已保存且改过分写了理由：理由只读展示', () => {
    setup({ readOnly: true, confirmed: true, value: 5, reason: '带着大家做' });
    const why = screen.getByLabelText('专业度改分理由') as HTMLInputElement;
    expect(why.readOnly).toBe(true);
    expect(why.value).toBe('带着大家做');
  });

  it('锚点读取失败时不能改分', async () => {
    const { props } = setup({ pickDisabled: true });
    await userEvent.click(screen.getByRole('radio', { name: '4 分' }));
    expect(props.onPick).not.toHaveBeenCalled();
  });

  it('保存时服务端指出这一行的问题，就地显示', () => {
    setup({ problem: '这一项需要调整后再保存' });
    expect(screen.getByRole('alert').textContent).toBe(
      '这一项需要调整后再保存',
    );
  });
});

describe('资料不足', () => {
  it('显示资料不足徽标和原因，没有分数点、没有数字、不可点击', () => {
    const { view } = setup({ score: unknown, value: null });
    expect(
      view.container.querySelector('.n-score')?.getAttribute('data-state'),
    ).toBe('unknown');
    expect(screen.getByText(copy.score.insufficient)).toBeTruthy();
    expect(screen.getByText('原话没有写动机相关的行为')).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(view.container.textContent).not.toMatch(/\d 分|0/);
  });
});
