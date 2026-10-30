// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RawInput, splitByRanges } from './RawInput';

afterEach(cleanup);

describe('splitByRanges', () => {
  const text = '演示甲今天独立完成了合成任务';
  it('按范围切分，只标出被引用的那一段', () => {
    expect(
      splitByRanges(text, [{ start: 5, end: 9, quote: '独立完成' }], null),
    ).toEqual([
      { text: '演示甲今天', marked: false, active: false },
      { text: '独立完成', marked: true, active: false },
      { text: '了合成任务', marked: false, active: false },
    ]);
  });

  it('当前跳转到的范围单独标出；重叠范围合并不重复', () => {
    const a = { start: 5, end: 9, quote: '独立完成' };
    const b = { start: 7, end: 11, quote: '完成了合' };
    const segments = splitByRanges(text, [b, a], a);
    expect(segments.filter((s) => s.marked).map((s) => s.text)).toEqual([
      '独立完成',
      '了合',
    ]);
    expect(segments.find((s) => s.marked)?.active).toBe(true);
  });

  it('被完全覆盖的范围跳过', () => {
    const big = { start: 5, end: 11, quote: '独立完成了合' };
    const small = { start: 6, end: 8, quote: '立完' };
    expect(
      splitByRanges(text, [big, small], null).filter((s) => s.marked),
    ).toHaveLength(1);
  });

  it('越界或引文与原话对不上时不高亮，不猜位置', () => {
    for (const range of [
      { start: -1, end: 3, quote: '演示甲' },
      { start: 5, end: 99, quote: '独立完成' },
      { start: 5, end: 5, quote: '' },
      { start: 5, end: 9, quote: '另一段话' },
    ])
      expect(splitByRanges(text, [range], null)).toEqual([
        { text, marked: false, active: false },
      ]);
  });

  it('偏移按 UTF-16 计算，含 emoji 时与服务端一致', () => {
    const withEmoji = '👍演示甲独立完成';
    // emoji 占 2 个 UTF-16 单元
    const start = withEmoji.indexOf('独立');
    expect(start).toBe(5);
    const segments = splitByRanges(
      withEmoji,
      [{ start, end: start + 2, quote: '独立' }],
      null,
    );
    expect(segments.map((s) => s.text)).toEqual(['👍演示甲', '独立', '完成']);
    // 把代理对劈开的范围对不上引文，不高亮
    expect(
      splitByRanges(withEmoji, [{ start: 1, end: 3, quote: '演' }], null),
    ).toEqual([{ text: withEmoji, marked: false, active: false }]);
  });
});

describe('RawInput', () => {
  it('显示原话，引用范围加标记，展开状态由外部控制', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <RawInput
        text="演示甲今天独立完成了合成任务"
        ranges={[{ start: 5, end: 9, quote: '独立完成' }]}
        active={{ start: 5, end: 9, quote: '独立完成' }}
        open
        onToggle={onToggle}
      />,
    );
    const mark = container.querySelector('mark');
    expect(mark?.textContent).toBe('独立完成');
    expect(mark?.getAttribute('data-active')).toBe('1');
    expect(container.querySelector('details')?.open).toBe(true);
    fireEvent.click(screen.getByText('原话'));
    fireEvent(container.querySelector('details')!, new Event('toggle'));
    expect(onToggle).toHaveBeenCalled();
  });
});
