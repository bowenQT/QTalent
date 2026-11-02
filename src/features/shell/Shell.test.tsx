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
      id: 'people',
      label: '人才',
      href: '/people',
      icon: 'users',
      group: null,
    },
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
  it('keeps the mentor reference route at the padded right edge while retaining judgment navigation', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(
      <Shell
        data={{
          ...data,
          role: 'mentor',
          navigation: [
            ...data.navigation,
            {
              id: 'judge',
              label: '我的判断对照',
              href: '/judge?rater=me',
              icon: 'swap',
              group: '规则',
            },
          ],
        }}
      >
        内容
      </Shell>,
    );
    expect(scroll).toHaveBeenCalledWith({ inline: 'end', block: 'nearest' });
    expect(screen.getByRole('link', { name: '我的判断对照' })).toBeTruthy();
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
    expect(screen.getByText('这一页属于业务视角')).toBeTruthy();
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
      sessionStorage.setItem('niu-talent:record-batch:acc-1', '{"text":"演示原话"}');
      sessionStorage.setItem('other-app', 'kept');
      render(<Shell data={data}>内容</Shell>);
      await user.click(
        screen.getByRole('button', { name: '账号：测试账号，管理者' }),
      );
      await user.click(screen.getByRole('menuitem', { name: label }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
      // 上一个账号的原话暂存随退出清掉，别的键不动
      expect(sessionStorage.getItem('niu-talent:record-batch:acc-1')).toBeNull();
      expect(sessionStorage.getItem('other-app')).toBe('kept');
      sessionStorage.clear();
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
      sessionStorage.setItem('niu-talent:record-input:acc-1', '{"text":"演示"}');
      await user.click(screen.getByRole('menuitem', { name: '退出登录' }));
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(replace).not.toHaveBeenCalled();
      // 没退出成功，账号还在：暂存留着
      expect(sessionStorage.getItem('niu-talent:record-input:acc-1')).not.toBeNull();
      sessionStorage.clear();
    },
  );
});

const names = (view: HTMLElement) => ({
  current: [...view.querySelectorAll('[aria-current="page"]')].map(
    (el) => el.textContent,
  ),
  crumbs: view.querySelector('.nt-crumbs')?.textContent,
});

describe('route-driven navigation and breadcrumb', () => {
  it.each([
    ['/work', '工作台'],
    ['/people', '人才'],
    ['/projects', '项目与课题'],
  ])('%s highlights its entry and titles the breadcrumb', (pathname, label) => {
    route.pathname = pathname;
    const view = render(<Shell data={data}>内容</Shell>);
    expect(names(view.container)).toEqual({ current: [label], crumbs: label });
  });

  it('follows the mentor label for the people entry', () => {
    route.pathname = '/people';
    const view = render(
      <Shell
        data={{
          ...data,
          role: 'mentor',
          navigation: data.navigation.map((entry) =>
            entry.id === 'people' ? { ...entry, label: '所带学员' } : entry,
          ),
        }}
      >
        内容
      </Shell>,
    );
    expect(names(view.container)).toEqual({
      current: ['所带学员'],
      crumbs: '所带学员',
    });
  });

  it('shows the person page under its people entry with a link back', () => {
    route.pathname = '/person';
    const view = render(<Shell data={data}>内容</Shell>);
    expect(names(view.container).current).toEqual(['人才']);
    const link = view.container.querySelector('.nt-crumbs a');
    expect(link?.getAttribute('href')).toBe('/people');
    expect(link?.textContent).toBe('人才');
    expect(view.container.querySelector('.nt-crumbs b')?.textContent).toBe(
      '人员档案',
    );
  });

  it('lets a page replace the crumb tail and restores the fallback on unmount', () => {
    route.pathname = '/person';
    const tail = (view: HTMLElement) =>
      view.querySelector('.nt-crumbs b')?.textContent;
    const view = render(
      <Shell data={data}>
        <ShellTitle title="林知远" />
      </Shell>,
    );
    expect(tail(view.container)).toBe('林知远');
    view.rerender(
      <Shell data={data}>
        <ShellTitle title="周屿" />
      </Shell>,
    );
    expect(tail(view.container)).toBe('周屿');
    view.rerender(<Shell data={data}>无标题页面</Shell>);
    expect(tail(view.container)).toBe('人员档案');
  });

  it('never lets a page title override the fixed admin title', () => {
    route.pathname = '/admin';
    const view = render(
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
        <ShellTitle title="林知远" />
      </Shell>,
    );
    expect(names(view.container)).toEqual({
      current: ['系统管理'],
      crumbs: '这一页属于业务视角',
    });
  });

  it('highlights nothing and prints no title when no entry owns the path', () => {
    route.pathname = '/nowhere';
    const view = render(<Shell data={data}>内容</Shell>);
    expect(names(view.container)).toEqual({ current: [], crumbs: '' });
    expect(view.container.querySelector('.nt-crumbs b')).toBeNull();
  });

  it('moves the highlight when the route changes inside the same shell', () => {
    route.pathname = '/work';
    const view = render(<Shell data={data}>内容</Shell>);
    expect(names(view.container).current).toEqual(['工作台']);
    route.pathname = '/people';
    view.rerender(<Shell data={data}>内容</Shell>);
    expect(names(view.container)).toEqual({
      current: ['人才'],
      crumbs: '人才',
    });
  });
});

describe('narrow screen viewport', () => {
  const narrow = () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    return scroll;
  };
  const mentor: ShellData = {
    ...data,
    role: 'mentor',
    navigation: [
      ...data.navigation,
      {
        id: 'judge',
        label: '我的判断对照',
        href: '/judge?rater=me',
        icon: 'swap',
        group: '规则',
      },
    ],
  };

  it('aligns only the mentor project entry to the end and centres every other page', () => {
    const scroll = narrow();
    route.pathname = '/people';
    const view = render(<Shell data={mentor}>内容</Shell>);
    expect(scroll).toHaveBeenLastCalledWith({
      inline: 'center',
      block: 'nearest',
    });
    route.pathname = '/projects';
    view.rerender(<Shell data={mentor}>内容</Shell>);
    expect(scroll).toHaveBeenLastCalledWith({
      inline: 'end',
      block: 'nearest',
    });
  });

  it('scrolls again after every route change and not for an unmatched path', () => {
    const scroll = narrow();
    route.pathname = '/work';
    const view = render(<Shell data={data}>内容</Shell>);
    expect(scroll).toHaveBeenCalledTimes(1);
    route.pathname = '/people';
    view.rerender(<Shell data={data}>内容</Shell>);
    expect(scroll).toHaveBeenCalledTimes(2);
    route.pathname = '/nowhere';
    view.rerender(<Shell data={data}>内容</Shell>);
    expect(scroll).toHaveBeenCalledTimes(2);
  });
});

describe('toast provider in the shell', () => {
  function Notifier() {
    const { show } = useToast();
    return (
      <button type="button" onClick={() => show('已撤销')}>
        提示
      </button>
    );
  }

  it('lets pages in the shell raise toasts inside the one live region', async () => {
    const user = userEvent.setup();
    const view = render(
      <Shell data={data}>
        <Notifier />
      </Shell>,
    );
    const regions = view.container.querySelectorAll('.nt-toasts');
    expect(regions).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '提示' }));
    expect(regions[0].textContent).toContain('已撤销');
  });
});
