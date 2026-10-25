// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chips, Count } from './Chips';
import { Seg } from './Seg';
afterEach(cleanup);
const pressed = () =>
  screen
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-pressed') === 'true')
    .map((button) => button.textContent);
describe('Seg', () => {
  const items = [
    { value: 'recent', label: '近 3 个月' },
    { value: 'version', label: '上一档案版本' },
    { value: 'half', label: '2026 H1 盘点', disabled: true },
  ] as const;
  it('is single-select: exactly one pressed, click and arrows move it', async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(
      <Seg
        label="比较基准"
        size="md"
        items={items}
        defaultValue="recent"
        onValueChange={change}
      />,
    );
    expect(document.querySelector('.n-seg--md')).toBeTruthy();
    expect(pressed()).toEqual(['近 3 个月']);
    await user.click(screen.getByRole('button', { name: '上一档案版本' }));
    expect(pressed()).toEqual(['上一档案版本']);
    expect(change).toHaveBeenLastCalledWith('version');
    // 方向键移动并选中；禁用项被跳过，到头后绕回第一项
    await user.keyboard('{ArrowRight}');
    expect(pressed()).toEqual(['近 3 个月']);
    expect(document.activeElement?.textContent).toBe('近 3 个月');
    await user.keyboard('{ArrowLeft}');
    expect(pressed()).toEqual(['上一档案版本']);
    await user.keyboard('{Home}');
    expect(pressed()).toEqual(['近 3 个月']);
    await user.keyboard('{End}');
    expect(pressed()).toEqual(['上一档案版本']);
    await user.keyboard('{ArrowDown}');
    expect(pressed()).toEqual(['近 3 个月']);
    await user.keyboard('{ArrowUp}');
    expect(pressed()).toEqual(['上一档案版本']);
  });
  it('keeps the selected item as the only tab stop and survives an empty selection', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Seg label="比较基准" items={items} value="version" />,
    );
    expect(
      screen
        .getAllByRole('button')
        .map((button) => button.tabIndex)
        .join(),
    ).toBe('-1,0,-1');
    rerender(<Seg label="比较基准" items={items} />);
    await user.tab();
    expect(document.activeElement?.textContent).toBe('近 3 个月');
    await user.keyboard('a');
    expect(pressed()).toEqual([]);
  });
});
describe('Chips', () => {
  it('reports the clicked value and renders pressed state and counts from the caller', async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    render(
      <Chips
        label="按类型筛选"
        items={[
          { value: 'all', label: '全部', count: 6 },
          { value: 'trend', label: '能力走向', count: 0 },
          { value: 'quad', label: '象限变化' },
          { value: 'team', label: '团队分布', disabled: true },
        ]}
        selected={['all', 'quad']}
        onSelect={select}
      />,
    );
    expect(pressed()).toEqual(['全部6', '象限变化']);
    expect(screen.getByRole('button', { name: /能力走向/ }).textContent).toBe(
      '能力走向0',
    );
    expect(screen.getByRole('button', { name: '象限变化' }).textContent).toBe(
      '象限变化',
    );
    await user.click(screen.getByRole('button', { name: /能力走向/ }));
    expect(select).toHaveBeenCalledWith('trend');
    await user.click(screen.getByRole('button', { name: '团队分布' }));
    expect(select).toHaveBeenCalledTimes(1);
    expect(pressed()).toEqual(['全部6', '象限变化']);
  });
  it('renders counts in the quiet and seal tones', () => {
    render(
      <>
        <Count>3</Count>
        <Count tone="quiet">4</Count>
        <Count tone="seal">5</Count>
      </>,
    );
    expect(
      [...document.querySelectorAll('.n-count')].map((node) => node.className),
    ).toEqual(['n-count', 'n-count is-quiet', 'n-count is-seal']);
  });
});
