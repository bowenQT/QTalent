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
import { useToast } from '@/components/ui/Toast';
import { Shell } from './Shell';
import { ShellTitle } from './ShellTitle';
const { replace, refresh, route } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  route: { pathname: '/projects' },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
  usePathname: () => route.pathname,
}));
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
const narrow = () =>
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
const people = {
  id: 'people',
  label: '人才',
  href: '/people',
  icon: 'users',
  group: '人',
} as const;
const judge = {
  id: 'judge',
  label: '我的判断对照',
  href: '/judge?rater=me',
  icon: 'swap',
  group: '规则',
} as const;
const crumbs = () => screen.getByRole('navigation', { name: '位置' });
const current = () =>
  document.querySelector('.nt-side [aria-current="page"]')?.textContent;
beforeEach(() => {
  vi.clearAllMocks();
  route.pathname = '/projects';
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
    narrow();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<Shell data={data}>内容</Shell>);
    expect(scroll).toHaveBeenCalledWith({ inline: 'center', block: 'nearest' });
  });
  it('keeps the mentor reference route at the padded right edge while retaining judgment navigation', () => {
    narrow();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(
      <Shell
        data={{
          ...data,
          role: 'mentor',
          navigation: [...data.navigation, judge],
        }}
      >
        内容
      </Shell>,
    );
    expect(scroll).toHaveBeenCalledWith({ inline: 'end', block: 'nearest' });
    expect(screen.getByRole('link', { name: '我的判断对照' })).toBeTruthy();
  });
  it('centers other mentor routes and scrolls again after client navigation', () => {
    narrow();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    route.pathname = '/work';
    const mentor: ShellData = {
      ...data,
      role: 'mentor',
      navigation: [...data.navigation, judge],
    };
    const view = render(<Shell data={mentor}>内容</Shell>);
    expect(current()).toBe('工作台');
    expect(scroll).toHaveBeenLastCalledWith({
      inline: 'center',
      block: 'nearest',
    });
    route.pathname = '/projects';
    view.rerender(<Shell data={mentor}>内容</Shell>);
    expect(current()).toBe('项目与课题');
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(scroll).toHaveBeenLastCalledWith({
      inline: 'end',
      block: 'nearest',
    });
  });
  it('skips scrolling when no navigation entry matches', () => {
    narrow();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    route.pathname = '/unknown';
    render(<Shell data={data}>内容</Shell>);
    expect(scroll).not.toHaveBeenCalled();
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
    expect(crumbs().textContent).toBe('这一页属于业务视角');
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
describe('route-derived crumbs', () => {
  const withPeople: ShellData = {
    ...data,
    navigation: [data.navigation[0]!, people, data.navigation[1]!, judge],
  };
  it.each([
    ['/work', '工作台'],
    ['/people', '人才'],
    ['/projects', '项目与课题'],
  ])('%s highlights and titles its own entry', (pathname, label) => {
    route.pathname = pathname;
    render(<Shell data={withPeople}>内容</Shell>);
    expect(current()).toBe(label);
    expect(crumbs().textContent).toBe(label);
  });
  it('uses the mentor people label supplied by the server', () => {
    route.pathname = '/people';
    render(
      <Shell
        data={{
          ...withPeople,
          role: 'mentor',
          navigation: withPeople.navigation.map((item) =>
            item.id === 'people' ? { ...item, label: '所带学员' } : item,
          ),
        }}
      >
        内容
      </Shell>,
    );
    expect(current()).toBe('所带学员');
    expect(crumbs().textContent).toBe('所带学员');
  });
  it('drops the query when matching the judgment entry', () => {
    route.pathname = '/judge';
    render(<Shell data={withPeople}>内容</Shell>);
    expect(current()).toBe('我的判断对照');
  });
  it('renders neither highlight nor title for an unmatched path', () => {
    route.pathname = '/unknown';
    render(<Shell data={withPeople}>内容</Shell>);
    expect(current()).toBeUndefined();
    expect(crumbs().querySelector('b')).toBeNull();
  });
  it('shows the person page under people, then the page title until it unmounts', () => {
    route.pathname = '/person';
    const view = render(<Shell data={withPeople}>内容</Shell>);
    expect(current()).toBe('人才');
    expect(
      screen.getByRole('link', { name: '人才', current: false }),
    ).toBeTruthy();
    expect(crumbs().querySelector('a')?.getAttribute('href')).toBe('/people');
    expect(crumbs().querySelector('b')?.textContent).toBe('人员档案');
    view.rerender(
      <Shell data={withPeople}>
        <ShellTitle title="演示人员甲" />
      </Shell>,
    );
    expect(crumbs().querySelector('b')?.textContent).toBe('演示人员甲');
    view.rerender(
      <Shell data={withPeople}>
        <ShellTitle title="演示人员乙" />
      </Shell>,
    );
    expect(crumbs().querySelector('b')?.textContent).toBe('演示人员乙');
    view.rerender(<Shell data={withPeople}>内容</Shell>);
    expect(crumbs().querySelector('b')?.textContent).toBe('人员档案');
  });
  it('requires ShellTitle to sit inside the shell', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<ShellTitle title="演示人员甲" />)).toThrow(
      'ShellTitle 需要放在工作台外壳里使用',
    );
  });
});
describe('shared toast', () => {
  function Notify() {
    const toast = useToast();
    return (
      <button type="button" onClick={() => toast.show('已保存')}>
        保存
      </button>
    );
  }
  it('mounts one provider so pages can raise toasts', async () => {
    const user = userEvent.setup();
    render(
      <Shell data={data}>
        <Notify />
      </Shell>,
    );
    expect(document.querySelectorAll('.nt-toasts')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(document.querySelector('.nt-toasts')?.textContent).toContain(
      '已保存',
    );
  });
});
