// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ShellData } from '@/contracts/shell';
import ReviewsPage, {
  generateMetadata as reviewsMetadata,
} from './reviews/page';
import QueuePage from './queue/page';
import ProgramsPage from './programs/page';
import ProgramActionsPage from './program-actions/page';
import TagsPage from './tags/page';
import GuidePage, {
  generateMetadata as guideMetadata,
} from './review-guide/page';
import MobilePage from './m/page';

const { shellQuery } = vi.hoisted(() => ({ shellQuery: vi.fn() }));
vi.mock('@/server/queries/shell', () => ({ getShellPage: shellQuery }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const shell = (isAdmin = false): ShellData => ({
  account: {
    id: 'test',
    name: '测试账号',
    email: 'test@qtalent.test',
    roles: [isAdmin ? 'admin' : 'manager'],
    hue: 20,
    roleLabel: '测试',
    scopeLabel: '全公司',
  },
  navigation: [],
  counts: { status: 'not_connected' },
  recent: { status: 'not_connected' },
  canSearch: !isAdmin,
  isAdmin,
  role: isAdmin ? 'admin' : 'manager',
});

beforeEach(() => shellQuery.mockReset());
afterEach(cleanup);

describe('sidebar entries without a page yet', () => {
  it.each([
    ['盘点', ReviewsPage],
    ['评分复核', QueuePage],
    ['人才项目', ProgramsPage],
    ['关键节点复盘', ProgramActionsPage],
    ['标签库', TagsPage],
    ['评审导览', GuidePage],
    ['手机版', MobilePage],
  ] as const)('%s says 待接通 instead of a 404', async (title, Page) => {
    shellQuery.mockResolvedValue(shell());
    render(await Page());
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: `${title}待接通` }),
    ).toBeTruthy();
  });

  it('names the page in the tab title', async () => {
    shellQuery.mockResolvedValue(shell());
    expect(await reviewsMetadata()).toEqual({ title: '盘点 · Niu-Talent' });
  });

  it('keeps admins on the business-view notice, but not on the guide', async () => {
    shellQuery.mockResolvedValue(shell(true));
    expect(await reviewsMetadata()).toEqual({
      title: '这一页属于业务视角 · Niu-Talent',
    });
    render(await ReviewsPage());
    expect(screen.getByText('这一页属于业务视角')).toBeTruthy();
    expect(screen.queryByText('盘点待接通')).toBeNull();
    cleanup();
    expect(await guideMetadata()).toEqual({ title: '评审导览 · Niu-Talent' });
    render(await GuidePage());
    expect(screen.getByText('评审导览待接通')).toBeTruthy();
  });

  it('shows the lost-grant state when the session has no shell', async () => {
    shellQuery.mockResolvedValue(null);
    render(await TagsPage());
    expect(screen.getByText('查看权限已更新')).toBeTruthy();
    expect(screen.queryByText('标签库待接通')).toBeNull();
  });
});
