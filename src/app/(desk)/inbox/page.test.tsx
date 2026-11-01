// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ShellData } from '@/contracts/shell';
import InboxPage, { generateMetadata } from './page';

const { shellQuery } = vi.hoisted(() => ({ shellQuery: vi.fn() }));
vi.mock('@/server/queries/shell', () => ({ getShellPage: shellQuery }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/inbox',
}));
const shell = (isAdmin: boolean): ShellData => ({
  account: {
    id: 'test',
    name: '测试账号',
    email: 'test@qtalent.test',
    roles: [isAdmin ? 'admin' : 'hr'],
    hue: 20,
    roleLabel: isAdmin ? '系统管理员' : 'HR',
    scopeLabel: '全公司',
  },
  navigation: [],
  counts: { status: 'not_connected' },
  recent: { status: 'not_connected' },
  canSearch: false,
  isAdmin,
  role: isAdmin ? 'admin' : 'hr',
});
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('待核对', () => {
  it('says the review items are not connected yet', async () => {
    shellQuery.mockResolvedValue(shell(false));
    expect(await generateMetadata()).toEqual({ title: '待核对 · Niu-Talent' });
    render(await InboxPage());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      '待核对',
    );
    expect(screen.getByText('待核对待接通')).toBeTruthy();
    expect(document.querySelector('.n-verify')).toBeNull();
  });
  it('sends the administrator to system management', async () => {
    shellQuery.mockResolvedValue(shell(true));
    expect(await generateMetadata()).toEqual({
      title: '这一页属于业务视角 · Niu-Talent',
    });
    render(await InboxPage());
    expect(
      screen.getByRole('link', { name: '打开系统管理' }).getAttribute('href'),
    ).toBe('/admin');
    expect(screen.queryByText('待核对待接通')).toBeNull();
  });
  it('shows the recoverable denial when the grant is gone', async () => {
    shellQuery.mockResolvedValue(null);
    expect(await generateMetadata()).toEqual({
      title: '查看权限已更新 · Niu-Talent',
    });
    render(await InboxPage());
    expect(screen.queryByText('待核对待接通')).toBeNull();
  });
});
