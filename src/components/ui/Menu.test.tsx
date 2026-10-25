// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';
import { Icon } from './Icon';
import { Menu, type MenuEntry } from './Menu';
afterEach(cleanup);
const trigger = (
  <Button className="n-btn--icon n-btn--ghost" aria-label="更多操作">
    <Icon name="more" />
  </Button>
);
describe('Menu', () => {
  it('opens from the trigger, runs the chosen action and closes', async () => {
    const user = userEvent.setup();
    const edit = vi.fn();
    const remove = vi.fn();
    const entries: MenuEntry[] = [
      { id: 'edit', label: '编辑项目', icon: 'pen', onSelect: edit },
      'separator',
      { id: 'drop', label: '删除项目', danger: true, onSelect: remove },
      { id: 'lock', label: '已归档', disabled: true, onSelect: vi.fn() },
    ];
    render(<Menu trigger={trigger} entries={entries} />);
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(screen.getByRole('button', { name: '更多操作' }));
    expect(screen.getByRole('menu').className).toBe('n-menu');
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
    expect(document.querySelector('.n-menu hr')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: '删除项目' }).className).toBe(
      'is-danger',
    );
    await user.click(screen.getByRole('menuitem', { name: '已归档' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    await user.click(screen.getByRole('menuitem', { name: '编辑项目' }));
    expect(edit).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('supports the keyboard and Escape closes without selecting', async () => {
    const user = userEvent.setup();
    const edit = vi.fn();
    render(
      <Menu
        trigger={trigger}
        entries={[{ id: 'edit', label: '编辑项目', onSelect: edit }]}
      />,
    );
    screen.getByRole('button', { name: '更多操作' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menu')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(edit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: '更多操作' }),
    );
  });
  it('renders a single-choice group with the checked item marked', async () => {
    const user = userEvent.setup();
    const pick = vi.fn();
    render(
      <Menu
        trigger={trigger}
        entries={[
          { id: 'recent', label: '近 3 个月', checked: true, onSelect: pick },
          {
            id: 'version',
            label: '上一档案版本',
            sub: '2026 H1',
            checked: false,
            onSelect: pick,
          },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: '更多操作' }));
    const radios = screen.getAllByRole('menuitemradio');
    expect(radios.map((item) => item.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
    ]);
    expect(radios[0].querySelector('.n-menu__check')).toBeTruthy();
    expect(radios[1].querySelector('.n-menu__check')).toBeNull();
    expect(radios[1].querySelector('small')?.textContent).toBe('2026 H1');
    await user.click(radios[1]);
    expect(pick).toHaveBeenCalledOnce();
  });
});
