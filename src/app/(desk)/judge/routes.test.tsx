// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ShellData } from '@/contracts/shell';
import JudgePage, { generateMetadata as judgeMetadata } from './page';
import RulesPage, { generateMetadata as rulesMetadata } from '../rules/page';

const { shellQuery, judgeQuery } = vi.hoisted(() => ({
  shellQuery: vi.fn(),
  judgeQuery: vi.fn(),
}));
vi.mock('@/server/queries/shell', () => ({ getShellPage: shellQuery }));
vi.mock('@/server/queries/judge', () => ({ getJudgePage: judgeQuery }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => {
    throw new Error('not-found');
  },
}));

const shell = (role: ShellData['role'], isAdmin = false): ShellData => ({
  account: {
    id: 'test',
    name: '测试账号',
    email: 'test@qtalent.test',
    roles: [role],
    hue: 20,
    roleLabel: '测试',
    scopeLabel: '全公司',
  },
  navigation: [],
  counts: { status: 'not_connected' },
  recent: { status: 'not_connected' },
  canSearch: false,
  isAdmin,
  role,
});
const standard = Promise.resolve({ r: 'front', line: 'xe-select' });

beforeEach(() => {
  shellQuery.mockReset();
  judgeQuery.mockReset();
});
afterEach(cleanup);

describe('/judge before comparison batches are stored', () => {
  it.each(['hr', 'manager'] as const)(
    'says 待接通 to %s and renders no sample data',
    async (audience) => {
      judgeQuery.mockResolvedValue({ status: 'not_connected', audience });
      expect(await judgeMetadata()).toEqual({
        title: '判断对照 · Niu-Talent',
      });
      render(await JudgePage());
      expect(
        screen.getByRole('heading', { name: '判断对照待接通' }),
      ).toBeTruthy();
      expect(screen.queryByText(/许致远|XEngineer 第六期/)).toBeNull();
      expect(shellQuery).not.toHaveBeenCalled();
    },
  );

  it('names the rater view as their own comparison', async () => {
    judgeQuery.mockResolvedValue({
      status: 'not_connected',
      audience: 'rater',
    });
    expect(await judgeMetadata()).toEqual({
      title: '我的判断对照 · Niu-Talent',
    });
    render(await JudgePage());
    expect(screen.getByRole('heading', { name: '我的判断对照' })).toBeTruthy();
    expect(screen.getByText(/你作为评价人给出的判断/)).toBeTruthy();
  });

  it('keeps admins and lost grants out', async () => {
    judgeQuery.mockResolvedValue({ status: 'admin' });
    expect(await judgeMetadata()).toEqual({
      title: '这一页属于业务视角 · Niu-Talent',
    });
    render(await JudgePage());
    expect(
      screen.getByRole('heading', { name: '这一页属于业务视角' }),
    ).toBeTruthy();
    cleanup();
    judgeQuery.mockResolvedValue({ status: 'forbidden' });
    expect(await judgeMetadata()).toEqual({
      title: '查看权限已更新 · Niu-Talent',
    });
    render(await JudgePage());
    expect(
      screen.getByRole('heading', { name: '查看权限已更新' }),
    ).toBeTruthy();
  });
});

describe('/rules?r=front&line=xe-select before BOW-918 is connected', () => {
  it('serves only the selection standard; anything else is the unified 404', async () => {
    await expect(
      RulesPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('not-found');
    await expect(
      RulesPage({ searchParams: Promise.resolve({ r: 'perf' }) }),
    ).rejects.toThrow('not-found');
    expect(await rulesMetadata({ searchParams: Promise.resolve({}) })).toEqual(
      {},
    );
    expect(shellQuery).not.toHaveBeenCalled();
  });

  it('says 待接通 to HR and managers', async () => {
    shellQuery.mockResolvedValue(shell('manager'));
    expect(await rulesMetadata({ searchParams: standard })).toEqual({
      title: 'XEngineer 入营选拔标准 · Niu-Talent',
    });
    render(await RulesPage({ searchParams: standard }));
    expect(
      screen.getByRole('heading', { name: '入营选拔标准待接通' }),
    ).toBeTruthy();
  });

  it('points mentors to their own comparison and keeps admins and lost grants out', async () => {
    shellQuery.mockResolvedValue(shell('mentor'));
    render(await RulesPage({ searchParams: standard }));
    expect(
      screen
        .getByRole('link', { name: '打开我的判断对照' })
        .getAttribute('href'),
    ).toBe('/judge?rater=me');
    cleanup();
    shellQuery.mockResolvedValue(shell('admin', true));
    expect(await rulesMetadata({ searchParams: standard })).toEqual({
      title: '这一页属于业务视角 · Niu-Talent',
    });
    render(await RulesPage({ searchParams: standard }));
    expect(screen.getByRole('link', { name: '打开系统管理' })).toBeTruthy();
    cleanup();
    shellQuery.mockResolvedValue(null);
    expect(await rulesMetadata({ searchParams: standard })).toEqual({
      title: '查看权限已更新 · Niu-Talent',
    });
    render(await RulesPage({ searchParams: standard }));
    expect(
      screen.getByRole('heading', { name: '查看权限已更新' }),
    ).toBeTruthy();
  });
});
