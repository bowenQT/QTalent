// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ShellData } from '@/contracts/shell';
import { ToastProvider } from '@/components/ui/Toast';
import ImportPage, { generateMetadata } from './page';

const { shellQuery, previewQuery } = vi.hoisted(() => ({
  shellQuery: vi.fn(),
  previewQuery: vi.fn(),
}));
vi.mock('@/server/queries/shell', () => ({ getShellPage: shellQuery }));
vi.mock('@/server/queries/interview-import', () => ({
  getInterviewImportPreview: previewQuery,
}));
vi.mock('@/server/actions/interview-import', () => ({
  confirmInterviewImportRowAction: vi.fn(),
}));
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

beforeEach(() => {
  shellQuery.mockReset();
  previewQuery.mockReset();
});
afterEach(cleanup);

async function show(search?: { id?: string }) {
  render(
    <ToastProvider>
      {await ImportPage(
        search ? { searchParams: Promise.resolve(search) } : {},
      )}
    </ToastProvider>,
  );
}

describe('/import', () => {
  it('shows HR the stored preview read for the import id', async () => {
    shellQuery.mockResolvedValue(shell(['hr']));
    previewQuery.mockResolvedValue({
      status: 'ok',
      preview: {
        batch: {
          id: 'imp-1',
          file: '面评导出（演示）.pdf',
          pageCount: 2,
          uploadedBy: '苏晚（演示）',
          uploadedAt: '2026-10-31T02:00:00.000Z',
          prior: null,
          rows: [],
        },
        revisions: {},
      },
    });
    await show({ id: 'imp-1' });
    expect(previewQuery).toHaveBeenCalledWith('imp-1');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      '面评导入',
    );
    expect(screen.getByText(/面评导出（演示）\.pdf · 2 页/)).toBeTruthy();
    expect((await generateMetadata()).title).toBe('面评导入 · Niu-Talent');
  });

  it.each([
    ['forbidden', '查看权限已更新'],
    ['unavailable', '面评暂时打不开'],
    ['not_found', '导入链接失效'],
  ] as const)('states a %s preview read', async (status, title) => {
    shellQuery.mockResolvedValue(shell(['hr']));
    previewQuery.mockResolvedValue({ status });
    await show({ id: 'imp-1' });
    expect(screen.getByRole('heading').textContent).toBe(title);
  });

  it('treats a link without an import as invalid', async () => {
    shellQuery.mockResolvedValue(shell(['hr']));
    await show();
    expect(screen.getByRole('heading').textContent).toBe('导入链接失效');
    expect(previewQuery).not.toHaveBeenCalled();
  });

  it('stops viewers other than HR before reading anything', async () => {
    shellQuery.mockResolvedValue(shell(['mentor', 'manager']));
    await show({ id: 'imp-1' });
    expect(screen.getByRole('heading').textContent).toBe('面评导入由 HR 处理');
    expect(previewQuery).not.toHaveBeenCalled();
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
    expect(previewQuery).not.toHaveBeenCalled();
    expect((await generateMetadata()).title).toBe(
      '查看权限已更新 · Niu-Talent',
    );
  });
});
