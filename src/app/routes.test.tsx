// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ShellData } from '@/contracts/shell';
import ProjectsPage, { generateMetadata } from './(desk)/projects/page';
import DeskLayout from './(desk)/layout';
import Home from './page';
import RootLayout from './layout';
import NotFound from './not-found';
import Login from './(auth)/login/page';
import Loading from './(desk)/projects/loading';
import ErrorPage from './(desk)/projects/error';
import DesignSystem from './dev/design-system/page';
const { shellQuery, projectsQuery, reset } = vi.hoisted(() => ({
  shellQuery: vi.fn(),
  projectsQuery: vi.fn(),
  reset: vi.fn(),
}));
vi.mock('@/server/queries/shell', () => ({
  getShellForCurrentUser: shellQuery,
  getShellPage: shellQuery,
}));
vi.mock('@/server/queries/projects', () => ({
  getProjectsPage: projectsQuery,
}));
vi.mock('@/server/actions/projects', () => ({ createProjectAction: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/projects',
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  notFound: () => {
    throw new Error('not-found');
  },
}));
const shell: ShellData = {
  account: {
    id: 'test',
    name: '测试账号',
    email: 'test@qtalent.test',
    roles: ['manager'],
    hue: 20,
    roleLabel: '管理者',
    scopeLabel: '全公司',
  },
  navigation: [],
  counts: { status: 'not_connected' },
  recent: { status: 'not_connected' },
  canSearch: false,
  isAdmin: false,
  role: 'manager',
};
beforeEach(() => {
  vi.clearAllMocks();
  shellQuery.mockResolvedValue(shell);
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('thin reference routes', () => {
  it('redirects home to the reference slice', () => {
    expect(Home).toThrow('redirect:/projects');
  });
  it('renders the authenticated shell from its server query', async () => {
    render(await DeskLayout({ children: '已授权内容' }));
    expect(shellQuery).toHaveBeenCalledOnce();
    expect(screen.getByText('已授权内容')).toBeTruthy();
  });
  it('renders allowed projects and a non-sensitive title', async () => {
    projectsQuery.mockResolvedValue({
      status: 'ok',
      data: { projects: [], eligiblePeople: [], canCreate: false },
    });
    expect(await generateMetadata()).toEqual({
      title: '项目与课题 · Niu-Talent',
    });
    render(await ProjectsPage());
    expect(screen.getByRole('heading', { name: '项目与课题' })).toBeTruthy();
  });
  it('denies admin before rendering project data', async () => {
    projectsQuery.mockResolvedValue({ status: 'forbidden' });
    shellQuery.mockResolvedValue({ ...shell, isAdmin: true, role: 'admin' });
    expect(await generateMetadata()).toEqual({
      title: '这一页属于业务视角 · Niu-Talent',
    });
    shellQuery.mockClear();
    render(await ProjectsPage());
    expect(
      screen.getByRole('heading', { name: '这一页属于业务视角' }),
    ).toBeTruthy();
    expect(shellQuery).toHaveBeenCalledOnce();
    expect(screen.queryByText('项目与课题')).toBeNull();
  });
  it('propagates query failures to the route error boundary rather than an empty list', async () => {
    projectsQuery.mockRejectedValue(new Error('database unavailable'));
    await expect(ProjectsPage()).rejects.toThrow('database unavailable');
  });
  it('gives distinct loading, error and missing-route states', () => {
    const loading = render(<Loading />);
    expect(screen.getByRole('status').textContent).toBe('内容加载中');
    loading.unmount();
    const error = render(<ErrorPage reset={reset} />);
    screen.getByRole('button', { name: '重新加载' }).click();
    expect(reset).toHaveBeenCalledOnce();
    error.unmount();
    render(<NotFound />);
    expect(
      screen.getByRole('link', { name: '回到项目列表' }).getAttribute('href'),
    ).toBe('/projects');
  });
  it('renders login and the document language with the approved sprite', () => {
    render(<Login />);
    expect(
      screen.getByRole('heading', { name: '登录 Niu-Talent' }),
    ).toBeTruthy();
    const html = renderToStaticMarkup(<RootLayout>测试正文</RootLayout>);
    expect(html).toContain('lang="zh-CN"');
    expect(html).toContain('id="i-folder"');
  });
  it('serves ported controls only outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    render(<DesignSystem />);
    expect(screen.getByRole('heading', { name: '设计系统' })).toBeTruthy();
    expect((screen.getByLabelText('项目名称') as HTMLInputElement).value).toBe(
      '海外加速搜索体验',
    );
    // The reference badge lives in a state-table cell, whose inherited line-height is 1.6.
    const badgeSample = screen
      .getByText('支持')
      .closest('[data-sample="badge"]') as HTMLElement;
    expect(badgeSample.style.lineHeight).toBe('1.6');
    vi.stubEnv('NODE_ENV', 'production');
    expect(DesignSystem).toThrow('not-found');
  });
});

it('renders a recoverable denial instead of business children when the shell grant is gone', async () => {
  shellQuery.mockResolvedValue(null);
  render(await DeskLayout({ children: 'sensitive business content' }));
  expect(screen.getByRole('heading', { name: '查看权限已更新' })).toBeTruthy();
  expect(screen.queryByText('sensitive business content')).toBeNull();
  expect(screen.getByRole('button', { name: '退出并切换账号' })).toBeTruthy();
  expect(await generateMetadata()).toEqual({
    title: '查看权限已更新 · Niu-Talent',
  });
  cleanup();
  render(await ProjectsPage());
  expect(screen.getByRole('heading', { name: '查看权限已更新' })).toBeTruthy();
  expect(projectsQuery).not.toHaveBeenCalled();
});
it('does not turn unexpected shell errors into permission denials', async () => {
  const failure = new Error('database unavailable');
  shellQuery.mockRejectedValue(failure);
  await expect(DeskLayout({ children: 'private' })).rejects.toBe(failure);
  await expect(generateMetadata()).rejects.toBe(failure);
  await expect(ProjectsPage()).rejects.toBe(failure);
});
