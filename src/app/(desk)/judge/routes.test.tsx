// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ShellData } from '@/contracts/shell';
import JudgePage, { generateMetadata as judgeMetadata } from './page';
import RulesPage, { generateMetadata as rulesMetadata } from '../rules/page';

const { shellQuery, judgeQuery, rulesQuery } = vi.hoisted(() => ({
  shellQuery: vi.fn(),
  judgeQuery: vi.fn(),
  rulesQuery: vi.fn(),
}));
vi.mock('@/server/queries/shell', () => ({ getShellPage: shellQuery }));
vi.mock('@/server/queries/rules', () => ({
  getSelectionStandardPage: rulesQuery,
}));
vi.mock('@/server/actions/selection-standard', () =>
  Object.fromEntries(
    [
      'saveSelectionRevisionAction',
      'submitSelectionRevisionAction',
      'withdrawSelectionRevisionAction',
      'publishSelectionRevisionAction',
      'undoSelectionPublicationAction',
      'returnSelectionRevisionAction',
      'readSelectionRevisionAction',
    ].map((name) => [name, vi.fn()]),
  ),
);
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
  rulesQuery.mockReset();
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

describe('/rules?r=front&line=xe-select', () => {
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

  it.each([
    ['hr', '/judge#attrib'],
    ['manager', null],
  ] as const)(
    'shows %s the standard in force; only HR is pointed to drafting',
    async (role, draftHref) => {
      shellQuery.mockResolvedValue(shell(role));
      rulesQuery.mockResolvedValue({
        status: 'current',
        audience: role,
        version: {
          category: 'xe_selection',
          versionId: 'xe-select-v1',
          effectiveFrom: '2026-06-14T16:00:00.000Z',
          effectiveUntil: null,
          provenance: 'demo_import_snapshot',
        },
        content: {
          reviewPoints: [
            {
              id: 'p1',
              title: '作品完成度',
              description: '三档各写清要看到什么',
            },
          ],
        },
      });
      expect(await rulesMetadata({ searchParams: standard })).toEqual({
        title: 'XEngineer 入营选拔标准 · Niu-Talent',
      });
      render(await RulesPage({ searchParams: standard }));
      expect(rulesQuery).toHaveBeenCalledWith(null);
      expect(screen.getByText(/生效中 xe-select-v1/)).toBeTruthy();
      expect(screen.getByText(/作品完成度/)).toBeTruthy();
      expect(
        screen
          .queryByRole('link', { name: '去判断对照起草' })
          ?.getAttribute('href') ?? null,
      ).toBe(draftHref);
    },
  );

  it('passes the draft id to the server and keeps an unknown draft a 404', async () => {
    shellQuery.mockResolvedValue(shell('hr'));
    rulesQuery.mockResolvedValue({ status: 'not_found' });
    await expect(
      RulesPage({
        searchParams: Promise.resolve({
          r: 'front',
          line: 'xe-select',
          draft: 'rev-1',
        }),
      }),
    ).rejects.toThrow('not-found');
    expect(rulesQuery).toHaveBeenCalledWith('rev-1');
    rulesQuery.mockResolvedValue({ status: 'forbidden' });
    render(await RulesPage({ searchParams: standard }));
    expect(
      screen.getByRole('heading', { name: '查看权限已更新' }),
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
