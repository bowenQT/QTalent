// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ShellData } from '@/contracts/shell';
import { Shell } from './Shell';
const { replace, refresh } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));
const data: ShellData = {
  account: {
    id: 'test',
    name: '测试账号',
    email: 'test@qtalent.test',
    roles: ['manager'],
    hue: 20,
    roleLabel: '管理者',
    scopeLabel: '全公司',
  },
  navigation: [
    { id: 'work', label: '工作台', href: '/work', icon: 'home', group: null },
    {
      id: 'projects',
      label: '项目与课题',
      href: '/projects',
      icon: 'folder',
      group: '项目',
    },
  ],
  counts: { status: 'not_connected' },
  recent: { status: 'not_connected' },
  canSearch: true,
  isAdmin: false,
  role: 'manager',
};
beforeEach(() => {
  vi.clearAllMocks();
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
describe('authorized shell', () => {
  it('renders server-filtered navigation, omits unavailable badges and opens keyboard command shell', async () => {
    const user = userEvent.setup();
    render(<Shell data={data}>测试内容</Shell>);
    expect(
      screen
        .getByRole('link', { name: '项目与课题' })
        .getAttribute('aria-current'),
    ).toBe('page');
    expect(document.querySelector('[data-nav-count]')).toBeNull();
    expect(document.querySelector('.nt-recent')).toBeNull();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: '前往页面' })).toBeTruthy();
    await user.type(screen.getByLabelText('页面名称'), '不存在的页面');
    expect(screen.getByText('换个页面名称试试。')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: '搜人或项目（⌘K）' }));
    expect((screen.getByLabelText('页面名称') as HTMLInputElement).value).toBe(
      '',
    );
  });
  it('keeps the active navigation item visible on narrow screens', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<Shell data={data}>内容</Shell>);
    expect(scroll).toHaveBeenCalledWith({ inline: 'center', block: 'nearest' });
  });
  it('denies admin shell titles and search before showing business identifiers', () => {
    render(
      <Shell
        data={{
          ...data,
          isAdmin: true,
          role: 'admin',
          canSearch: false,
          navigation: [
            {
              id: 'admin',
              label: '系统管理',
              href: '/admin',
              icon: 'lock',
              group: '系统',
            },
          ],
        }}
      >
        权限提示
      </Shell>,
    );
    expect(screen.queryByText('项目与课题')).toBeNull();
    expect(
      screen.queryByRole('button', { name: '搜人或项目（⌘K）' }),
    ).toBeNull();
    expect(screen.getByRole('link', { name: '系统管理' })).toBeTruthy();
  });
  it('uses the full search control for HR', () => {
    render(<Shell data={{ ...data, role: 'hr' }}>内容</Shell>);
    expect(screen.getByText('搜人、项目，或输入要做的事')).toBeTruthy();
  });
  it.each(['切换账号', '退出登录'])(
    '%s signs out instead of changing a client role',
    async (label) => {
      const fetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetch);
      const user = userEvent.setup();
      render(<Shell data={data}>内容</Shell>);
      await user.click(
        screen.getByRole('button', { name: '账号：测试账号，管理者' }),
      );
      await user.click(screen.getByRole('menuitem', { name: label }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
      expect(fetch).toHaveBeenCalledWith(
        '/api/auth/sign-out',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(refresh).toHaveBeenCalledOnce();
    },
  );
  it.each([false, 'network'])(
    'keeps the current account when logout fails: %s',
    async (failure) => {
      const fetch = vi.fn();
      if (failure === 'network') fetch.mockRejectedValue(new Error('offline'));
      else fetch.mockResolvedValue({ ok: false });
      vi.stubGlobal('fetch', fetch);
      const user = userEvent.setup();
      render(<Shell data={data}>内容</Shell>);
      await user.click(
        screen.getByRole('button', { name: '账号：测试账号，管理者' }),
      );
      await user.click(screen.getByRole('menuitem', { name: '退出登录' }));
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(replace).not.toHaveBeenCalled();
    },
  );
});
