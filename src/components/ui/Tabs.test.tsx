// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TabNav, Tabs } from './Tabs';
const items = [
  { id: 'notes', label: '纪要', content: '纪要内容' },
  { id: 'text', label: '文字记录', content: '逐句记录' },
  { id: 'check', label: '待核对', count: 2, content: '两处人名指代' },
];
afterEach(cleanup);
const selectedTab = () =>
  screen.getAllByRole('tab').find((tab) => tab.ariaSelected === 'true')
    ?.textContent;
describe('Tabs', () => {
  it('moves selection and focus with arrows, wraps around and jumps with Home/End', async () => {
    const user = userEvent.setup();
    render(<Tabs label="记录视图" items={items} />);
    await user.tab();
    expect(document.activeElement?.textContent).toBe('纪要');
    await user.keyboard('{ArrowLeft}');
    expect(selectedTab()).toBe('待核对2');
    expect(document.activeElement?.textContent).toBe('待核对2');
    await user.keyboard('{ArrowRight}');
    expect(selectedTab()).toBe('纪要');
    await user.keyboard('{End}');
    expect(selectedTab()).toBe('待核对2');
    await user.keyboard('{Home}');
    expect(selectedTab()).toBe('纪要');
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(selectedTab()).toBe('待核对2');
  });
  it('shows only the selected panel, wired to its tab, and keeps one tab stop', async () => {
    const user = userEvent.setup();
    render(<Tabs label="记录视图" items={items} defaultValue="text" />);
    const panel = screen.getByRole('tabpanel');
    expect(panel.textContent).toBe('逐句记录');
    expect(panel.getAttribute('aria-labelledby')).toBe(
      screen.getByRole('tab', { name: '文字记录' }).id,
    );
    expect(
      screen
        .getAllByRole('tab')
        .map((tab) => tab.getAttribute('tabindex'))
        .join(),
    ).toBe('-1,0,-1');
    await user.click(screen.getByRole('tab', { name: /待核对/ }));
    expect(screen.getByRole('tabpanel').textContent).toBe('两处人名指代');
    expect(document.querySelectorAll('[role="tabpanel"][hidden]')).toHaveLength(
      2,
    );
  });
  it('lets the caller control the selection and ignores unrelated keys', async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(
      <Tabs
        label="记录视图"
        items={items}
        value="notes"
        onValueChange={change}
      />,
    );
    await user.click(screen.getByRole('tab', { name: '文字记录' }));
    expect(change).toHaveBeenCalledWith('text');
    expect(selectedTab()).toBe('纪要');
    change.mockClear();
    await user.keyboard('a');
    expect(change).not.toHaveBeenCalled();
  });
  it('falls back to the first tab when the value matches nothing', () => {
    render(<Tabs label="记录视图" items={items} value="gone" />);
    expect(selectedTab()).toBe('纪要');
  });
});
describe('TabNav', () => {
  it('marks only the current page with aria-current', () => {
    render(
      <TabNav
        label="人才项目"
        items={[
          { href: '/landing', label: '第六期', current: true },
          { href: '/actions', label: '关键节点复盘' },
        ]}
      />,
    );
    expect(
      screen.getByRole('link', { name: '第六期' }).getAttribute('aria-current'),
    ).toBe('page');
    expect(
      screen
        .getByRole('link', { name: '关键节点复盘' })
        .getAttribute('aria-current'),
    ).toBeNull();
    expect(screen.getByRole('navigation', { name: '人才项目' })).toBeTruthy();
  });
});
