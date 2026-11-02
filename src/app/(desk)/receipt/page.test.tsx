// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ShellData } from '@/contracts/shell';
import ReceiptRoute, { generateMetadata } from './page';

const { shellQuery } = vi.hoisted(() => ({ shellQuery: vi.fn() }));
vi.mock('@/server/queries/shell', () => ({ getShellPage: shellQuery }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/receipt',
  useRouter: () => ({ refresh: vi.fn() }),
}));

const shell = (role: ShellData['role']): ShellData => ({
  account: {
    id: 'test',
    name: '测试账号',
    email: 'test@qtalent.test',
    roles: [role],
    hue: 20,
    roleLabel: '测试',
    scopeLabel: '测试范围',
  },
  navigation: [],
  counts: { status: 'not_connected' },
  recent: { status: 'not_connected' },
  canSearch: false,
  isAdmin: role === 'admin',
  role,
});
const open = (id?: string | string[]) =>
  ReceiptRoute({ searchParams: Promise.resolve({ id }) });

beforeEach(() => shellQuery.mockReset());
afterEach(cleanup);

describe('/receipt', () => {
  it.each(['manager', 'hr', 'mentor'] as const)(
    '%s 打开回执链接：写回执待接通，不读取材料',
    async (role) => {
      shellQuery.mockResolvedValue(shell(role));
      render(await open('d-ms2'));
      expect(screen.getByRole('heading').textContent).toBe('回执待接通');
      expect(screen.queryByRole('button')).toBeNull();
      expect(
        screen.getByRole('link', { name: '回到工作台' }).getAttribute('href'),
      ).toBe('/');
      expect((await generateMetadata()).title).toBe('回执 · Niu-Talent');
    },
  );

  it('链接里没有回执编号时写链接失效', async () => {
    shellQuery.mockResolvedValue(shell('mentor'));
    render(await open('  '));
    expect(screen.getByRole('heading').textContent).toBe('回执链接失效');
    cleanup();
    render(await open());
    expect(screen.getByRole('heading').textContent).toBe('回执链接失效');
    cleanup();
    render(await open(['d-ms2', 'd-pr']));
    expect(screen.getByRole('heading').textContent).toBe('回执链接失效');
  });

  it('系统管理员去系统管理', async () => {
    shellQuery.mockResolvedValue(shell('admin'));
    render(await open('d-ms2'));
    expect(screen.getByRole('heading').textContent).toBe('这一页属于业务视角');
    expect(
      screen.getByRole('link', { name: '打开系统管理' }).getAttribute('href'),
    ).toBe('/admin');
    expect((await generateMetadata()).title).toBe(
      '这一页属于业务视角 · Niu-Talent',
    );
  });

  it('查看权限失效时只显示无权访问', async () => {
    shellQuery.mockResolvedValue(null);
    render(await open('d-ms2'));
    expect(screen.queryByText('回执待接通')).toBeNull();
    expect((await generateMetadata()).title).toBe(
      '查看权限已更新 · Niu-Talent',
    );
  });
});
