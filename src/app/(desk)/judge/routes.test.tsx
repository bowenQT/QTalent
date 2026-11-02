// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/Toast';
import type { ShellData } from '@/contracts/shell';
import JudgePage, { generateMetadata as judgeMetadata } from './page';
import RulesPage, { generateMetadata as rulesMetadata } from '../rules/page';
import {
  sampleBatch,
  sampleHrPage,
  sampleManagerPage,
  sampleRaterPage,
  sampleRaters,
  sampleStandard,
} from '@/app/dev/standard-iteration/samples';

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
vi.mock('@/server/actions/standard-attribution', () => ({
  generateStandardHypothesesAction: vi.fn(),
  confirmStandardAttributionAction: vi.fn(),
  createSelectionRevisionAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
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

const judge = (rater?: string) =>
  ({ searchParams: Promise.resolve(rater ? { rater } : {}) }) as const;

describe('/judge reads the stored comparison batch', () => {
  it('shows HR the batch with its raters and the attribution entry', async () => {
    judgeQuery.mockResolvedValue({
      status: 'hr',
      page: sampleHrPage,
      standard: { versionId: 'xe-select-v1', content: sampleStandard },
      hypotheses: [],
      attributions: [],
    });
    expect(await judgeMetadata(judge())).toEqual({
      title: `${sampleBatch.name} · Niu-Talent`,
    });
    render(<ToastProvider>{await JudgePage(judge())}</ToastProvider>);
    expect(judgeQuery).toHaveBeenCalledWith(null);
    expect(
      screen.getByRole('heading', { level: 1, name: sampleBatch.name }),
    ).toBeTruthy();
    const rater = sampleRaters.ye;
    expect(
      screen
        .getAllByRole('link')
        .some((a) => a.getAttribute('href') === `/judge?rater=${rater.id}`),
    ).toBe(true);
    expect(document.body.textContent).not.toMatch(/%|准确率/);
  });

  it('opens one rater for HR, and 404s an unknown one', async () => {
    const rater = sampleRaters.ye;
    judgeQuery.mockResolvedValue({
      status: 'hr_rater',
      page: sampleHrPage,
      evaluatorId: rater.id,
      batchNames: { [sampleBatch.id]: sampleBatch.name },
    });
    expect(await judgeMetadata(judge(rater.id))).toEqual({
      title: `${rater.name}的判断 · Niu-Talent`,
    });
    render(await JudgePage(judge(rater.id)));
    expect(judgeQuery).toHaveBeenCalledWith(rater.id);
    expect(
      screen.getByRole('heading', { level: 1, name: `${rater.name}的判断` }),
    ).toBeTruthy();
    cleanup();
    judgeQuery.mockResolvedValue({ status: 'not_found' });
    await expect(JudgePage(judge('nobody'))).rejects.toThrow('not-found');
  });

  it('shows a mentor only their own judgments', async () => {
    const rater = sampleRaters.ye;
    judgeQuery.mockResolvedValue({
      status: 'rater',
      page: sampleRaterPage('ye'),
      raterName: rater.name,
      batchNames: { [sampleBatch.id]: sampleBatch.name },
    });
    expect(await judgeMetadata(judge('me'))).toEqual({
      title: '我的判断对照 · Niu-Talent',
    });
    render(await JudgePage(judge('me')));
    expect(judgeQuery).toHaveBeenCalledWith('me');
    expect(
      screen.getByRole('heading', { level: 1, name: '我的判断对照' }),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/%|准确率/);
  });

  it('shows the manager the batch without names or cases', async () => {
    judgeQuery.mockResolvedValue({
      status: 'manager',
      page: sampleManagerPage([]),
    });
    render(await JudgePage(judge()));
    const text = document.body.textContent ?? '';
    for (const rater of Object.values(sampleRaters))
      expect(text).not.toContain(rater.name);
    expect(text).not.toMatch(/%|准确率/);
  });

  it('says so when no batch is stored for the viewer', async () => {
    judgeQuery.mockResolvedValue({ status: 'empty', audience: 'rater' });
    expect(await judgeMetadata(judge('me'))).toEqual({
      title: '我的判断对照 · Niu-Talent',
    });
    render(await JudgePage(judge('me')));
    expect(
      screen.getByRole('heading', { name: '还没有可对照的批次' }),
    ).toBeTruthy();
  });

  it('keeps admins and lost grants out', async () => {
    judgeQuery.mockResolvedValue({ status: 'admin' });
    expect(await judgeMetadata(judge())).toEqual({
      title: '这一页属于业务视角 · Niu-Talent',
    });
    render(await JudgePage(judge()));
    expect(
      screen.getByRole('heading', { name: '这一页属于业务视角' }),
    ).toBeTruthy();
    cleanup();
    judgeQuery.mockResolvedValue({ status: 'forbidden' });
    expect(await judgeMetadata(judge())).toEqual({
      title: '查看权限已更新 · Niu-Talent',
    });
    render(await JudgePage(judge()));
    expect(
      screen.getByRole('heading', { name: '查看权限已更新' }),
    ).toBeTruthy();
    expect(shellQuery).not.toHaveBeenCalled();
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
    rulesQuery.mockResolvedValue({ status: 'none' });
    render(await RulesPage({ searchParams: standard }));
    expect(
      screen.getByRole('heading', { name: '还没有生效的入营选拔标准' }),
    ).toBeTruthy();
    cleanup();
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
