// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ShellData } from '@/contracts/shell';
import RecordRoute, { generateMetadata } from './page';

const { shellQuery } = vi.hoisted(() => ({ shellQuery: vi.fn() }));
vi.mock('@/server/queries/shell', () => ({ getShellPage: shellQuery }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/record',
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

beforeEach(() => shellQuery.mockReset());
afterEach(cleanup);

describe('/record', () => {
  it.each(['manager', 'hr', 'mentor'] as const)(
    'says recording is not connected for %s, without reading records',
    async (role) => {
      shellQuery.mockResolvedValue(shell(role));
      render(await RecordRoute());
      expect(screen.getByRole('heading').textContent).toBe('记一件事待接通');
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(
        screen.getByRole('link', { name: '回到工作台' }).getAttribute('href'),
      ).toBe('/');
      expect((await generateMetadata()).title).toBe('记一件事 · Niu-Talent');
    },
  );

  it('sends system administrators to administration', async () => {
    shellQuery.mockResolvedValue(shell('admin'));
    render(await RecordRoute());
    expect(screen.getByRole('heading').textContent).toBe('这一页属于业务视角');
    expect(
      screen.getByRole('link', { name: '打开系统管理' }).getAttribute('href'),
    ).toBe('/admin');
    expect((await generateMetadata()).title).toBe(
      '这一页属于业务视角 · Niu-Talent',
    );
  });

  it('asks to sign in again without a session', async () => {
    shellQuery.mockResolvedValue(null);
    render(await RecordRoute());
    expect(screen.queryByText('记一件事待接通')).toBeNull();
    expect((await generateMetadata()).title).toBe(
      '查看权限已更新 · Niu-Talent',
    );
  });
});
