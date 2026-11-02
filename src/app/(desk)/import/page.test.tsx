// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ShellData } from '@/contracts/shell';
import ImportPage, { generateMetadata } from './page';

const { shellQuery } = vi.hoisted(() => ({ shellQuery: vi.fn() }));
vi.mock('@/server/queries/shell', () => ({ getShellPage: shellQuery }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/import',
  useRouter: () => ({ refresh: vi.fn() }),
}));

const shell = (roles: string[], isAdmin = false): ShellData => ({
  account: {
    id: 'test',
    name: '测试账号',
    email: 'test@qtalent.test',
    roles,
    hue: 20,
    roleLabel: '测试',
    scopeLabel: '测试范围',
  },
  navigation: [],
  counts: { status: 'not_connected' },
  recent: { status: 'not_connected' },
  canSearch: false,
  isAdmin,
  role: isAdmin ? 'admin' : roles.includes('hr') ? 'hr' : 'mentor',
});

beforeEach(() => shellQuery.mockReset());
afterEach(cleanup);

async function show(search?: { id?: string }) {
  render(
    await ImportPage(search ? { searchParams: Promise.resolve(search) } : {}),
  );
}

describe('/import', () => {
  it('says the preview read is not connected for HR', async () => {
    shellQuery.mockResolvedValue(shell(['hr']));
    await show({ id: 'imp-1' });
    expect(screen.getByRole('heading').textContent).toBe('面评预览待接通');
    expect(
      screen.getByRole('link', { name: '回到工作台' }).getAttribute('href'),
    ).toBe('/');
    expect((await generateMetadata()).title).toBe('面评导入 · Niu-Talent');
  });

  it('treats a link without an import as invalid', async () => {
    shellQuery.mockResolvedValue(shell(['hr']));
    await show();
    expect(screen.getByRole('heading').textContent).toBe('导入链接失效');
  });

  it('stops viewers other than HR before reading anything', async () => {
    shellQuery.mockResolvedValue(shell(['mentor', 'manager']));
    await show({ id: 'imp-1' });
    expect(screen.getByRole('heading').textContent).toBe('面评导入由 HR 处理');
    expect((await generateMetadata()).title).toBe(
      '面评导入由 HR 处理 · Niu-Talent',
    );
  });

  it('sends system administrators to administration', async () => {
    shellQuery.mockResolvedValue(shell(['hr'], true));
    await show({ id: 'imp-1' });
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
    await show({ id: 'imp-1' });
    expect(screen.queryByText('面评预览待接通')).toBeNull();
    expect((await generateMetadata()).title).toBe(
      '查看权限已更新 · Niu-Talent',
    );
  });
});
