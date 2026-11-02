// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ShellData } from '@/contracts/shell';
import RecordRoute, { generateMetadata } from './page';

const { shellQuery, pageQuery, live } = vi.hoisted(() => ({
  shellQuery: vi.fn(),
  pageQuery: vi.fn(),
  live: vi.fn(),
}));
vi.mock('@/server/queries/shell', () => ({ getShellPage: shellQuery }));
vi.mock('@/server/queries/record-page', () => ({
  getRecordPageData: pageQuery,
}));
// The client part is LiveRecord's own test; here only what the route hands it.
vi.mock('./LiveRecord', () => ({
  LiveRecord: (props: Record<string, unknown>) => {
    live(props);
    return <div data-testid="live-record" />;
  },
}));
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
const data = {
  status: 'ok' as const,
  people: [
    {
      id: 'p1',
      name: '演示甲',
      hue: 20,
      photo: null,
      orgShort: '演示组',
      demo: true,
    },
  ],
  projects: [{ id: 'proj-1', name: '演示项目' }],
  dimensions: [{ id: 'mot', name: '内生动力' }],
};

beforeEach(() => {
  shellQuery.mockReset();
  pageQuery.mockReset();
  live.mockReset();
});
afterEach(cleanup);

describe('/record', () => {
  it.each(['manager', 'hr', 'mentor'] as const)(
    'hands the server page read to the record page for %s',
    async (role) => {
      shellQuery.mockResolvedValue(shell(role));
      pageQuery.mockResolvedValue(data);
      render(await RecordRoute());
      expect(screen.getByTestId('live-record')).toBeTruthy();
      expect(live).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 'test',
          accountName: '测试账号',
          roleLabel: '测试',
          people: data.people,
          projects: [{ id: 'proj-1', name: '演示项目', kind: 'project' }],
          dimensions: data.dimensions,
          entry: { personId: null, handoff: false, batchId: undefined },
        }),
      );
      expect((await generateMetadata()).title).toBe('记一件事 · Niu-Talent');
    },
  );

  it('passes ?person=, ?draft=work and ?batch= as the entry, never text', async () => {
    shellQuery.mockResolvedValue(shell('hr'));
    pageQuery.mockResolvedValue(data);
    render(
      await RecordRoute({
        searchParams: Promise.resolve({
          person: 'p1',
          draft: 'work',
          batch: 'b-1',
        }),
      }),
    );
    expect(live.mock.calls[0]?.[0].entry).toEqual({
      personId: 'p1',
      handoff: true,
      batchId: 'b-1',
    });
  });

  it('says recording starts from an evaluation node when the page read refuses', async () => {
    shellQuery.mockResolvedValue(shell('hr'));
    pageQuery.mockResolvedValue({ status: 'forbidden' });
    render(await RecordRoute());
    expect(screen.getByRole('heading').textContent).toBe(
      '加入评价节点后，就能在这里记一件事',
    );
    expect(
      screen.getByRole('link', { name: '回到工作台' }).getAttribute('href'),
    ).toBe('/');
    expect(live).not.toHaveBeenCalled();
  });

  it('asks to refresh when the page read is unavailable', async () => {
    shellQuery.mockResolvedValue(shell('mentor'));
    pageQuery.mockResolvedValue({ status: 'unavailable' });
    render(await RecordRoute());
    expect(screen.getByRole('heading').textContent).toBe('记一件事暂时打不开');
  });

  it('sends system administrators to administration without reading records', async () => {
    shellQuery.mockResolvedValue(shell('admin'));
    render(await RecordRoute());
    expect(screen.getByRole('heading').textContent).toBe('这一页属于业务视角');
    expect(
      screen.getByRole('link', { name: '打开系统管理' }).getAttribute('href'),
    ).toBe('/admin');
    expect(pageQuery).not.toHaveBeenCalled();
    expect((await generateMetadata()).title).toBe(
      '这一页属于业务视角 · Niu-Talent',
    );
  });

  it('asks to sign in again without a session', async () => {
    shellQuery.mockResolvedValue(null);
    render(await RecordRoute());
    expect(pageQuery).not.toHaveBeenCalled();
    expect((await generateMetadata()).title).toBe(
      '查看权限已更新 · Niu-Talent',
    );
  });
});
