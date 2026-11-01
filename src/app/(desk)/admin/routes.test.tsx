// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ShellData } from '@/contracts/shell';
import { ToastProvider } from '@/components/ui/Toast';
import AdminRoute, { generateMetadata } from './page';
import SampleRoute from '../../dev/admin-connections/page';

const { shellQuery, adminQuery } = vi.hoisted(() => ({
  shellQuery: vi.fn(),
  adminQuery: vi.fn(),
}));
vi.mock('@/server/queries/shell', () => ({ getShellPage: shellQuery }));
vi.mock('@/server/queries/admin', () => ({
  getAdminConnectionsPage: adminQuery,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin',
  notFound: () => {
    throw new Error('not-found');
  },
}));
const shell = (isAdmin: boolean) =>
  ({ isAdmin, role: isAdmin ? 'admin' : 'hr' }) as ShellData;
const notConnected = { status: 'not_connected' };
const ready = {
  status: 'ok',
  data: {
    wecom: notConnected,
    mcp: notConnected,
    agentapi: notConnected,
    recentCalls: notConnected,
    bindingFailures: notConnected,
    taskFailures: notConnected,
  },
};
const show = async (search: Record<string, string> = {}) =>
  render(
    <ToastProvider>
      {await AdminRoute({ searchParams: Promise.resolve(search) })}
    </ToastProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('/admin', () => {
  it('opens 接入状态 for a system administrator, every read 待接通', async () => {
    shellQuery.mockResolvedValue(shell(true));
    adminQuery.mockResolvedValue(ready);
    expect(await generateMetadata()).toEqual({
      title: '系统管理 · Niu-Talent',
    });
    await show();
    expect(screen.getByRole('heading', { name: '系统管理' })).toBeTruthy();
    expect(
      screen
        .getByRole('tab', { name: '接入状态' })
        .getAttribute('aria-selected'),
    ).toBe('true');
    expect(screen.getAllByText('待接通').length).toBe(6);
    expect(screen.queryByText('演示')).toBeNull();
    cleanup();
    await show({ tab: 'audit' });
    expect(
      screen
        .getByRole('tab', { name: '审计日志' })
        .getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('refuses business accounts before any technical record is read', async () => {
    shellQuery.mockResolvedValue(shell(false));
    adminQuery.mockResolvedValue({ status: 'forbidden' });
    expect(await generateMetadata()).toEqual({
      title: '这一页只给系统管理员 · Niu-Talent',
    });
    await show();
    expect(
      screen.getByRole('heading', { name: '这一页只给系统管理员' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: '回到工作台' }).getAttribute('href'),
    ).toBe('/work');
  });

  it('gives a lost grant the recoverable denial', async () => {
    shellQuery.mockResolvedValue(null);
    expect(await generateMetadata()).toEqual({
      title: '查看权限已更新 · Niu-Talent',
    });
    await show();
    expect(
      screen.getByRole('heading', { name: '查看权限已更新' }),
    ).toBeTruthy();
    expect(adminQuery).not.toHaveBeenCalled();
  });
});

describe('/dev/admin-connections', () => {
  it('serves samples outside production only', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(
      SampleRoute({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('not-found');
    vi.stubEnv('NODE_ENV', 'development');
    const page = await SampleRoute({
      searchParams: Promise.resolve({
        wecom: 'down',
        tab: 'hr',
        retry: 'conflict',
        empty: '1',
      }),
    });
    const props = (
      page.props as { children: { props: Record<string, unknown> } }
    ).children.props;
    expect(props).toEqual({
      tab: 'hr',
      query: { wecom: 'down', empty: true, pending: false },
      retry: 'conflict',
    });
    const fallback = await SampleRoute({
      searchParams: Promise.resolve({ wecom: 'bogus' }),
    });
    expect(
      (fallback.props as { children: { props: { query: { wecom: string } } } })
        .children.props.query.wecom,
    ).toBe('on');
  });
});
