// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ShellData } from '@/contracts/shell';
import { fixtures } from '../../../../tests/fixtures/p0-contracts';
import { ToastProvider } from '@/components/ui/Toast';
import { ShellTitleProvider } from '@/features/shell/ShellTitle';
import WorkPage, { generateMetadata } from './page';
import ReassignPage, {
  generateMetadata as reassignMetadata,
} from './reassign/page';

const { shellQuery, workbenchQuery, reassignQuery, NotConnected } = vi.hoisted(
  () => {
    class NotConnected extends Error {
      readonly status = 'not_connected';
    }
    return {
      shellQuery: vi.fn(),
      workbenchQuery: vi.fn(),
      reassignQuery: vi.fn(),
      NotConnected,
    };
  },
);
vi.mock('@/server/queries/shell', () => ({ getShellPage: shellQuery }));
vi.mock('@/server/queries/workbench', () => ({
  getWorkbenchForCurrentUser: workbenchQuery,
  WorkbenchNotConnectedError: NotConnected,
}));
vi.mock('@/server/queries/evaluation-reassignments', () => ({
  readEvaluationReassignmentsForCurrentUser: reassignQuery,
}));
vi.mock('@/server/actions/evaluation-reassignment', () => ({
  reassignEvaluationWorkAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const shell: ShellData = {
  account: {
    id: 'account-hr',
    name: '演示 HR',
    email: 'hr@qtalent.test',
    roles: ['hr'],
    hue: 20,
    roleLabel: 'HR',
    scopeLabel: '演示期',
  },
  navigation: [],
  counts: { status: 'not_connected' },
  recent: { status: 'not_connected' },
  canSearch: false,
  isAdmin: false,
  role: 'hr',
};
const [manager, hr, mentor] = fixtures.workbench;
const pendingItem = {
  workItemId: 'w-1',
  revision: 1,
  kind: 'confirmation',
  resourceId: 'r-1',
  state: 'pending',
  node: { id: 'n-1', name: '演示期次', kind: 'program_cohort' },
  person: { id: 'p-1', name: '演示甲' },
  previousEvaluator: { id: 'old', displayName: '演示原导师' },
  candidates: [
    {
      relationId: 'rel-1',
      evaluatorId: 'new',
      displayName: '演示新导师',
      kind: 'mentor',
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('APP_ENV', 'test');
  shellQuery.mockResolvedValue(shell);
  reassignQuery.mockResolvedValue({
    status: 'success',
    asOf: '2026-09-04T07:00:00.000Z',
    items: [pendingItem],
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('/work', () => {
  it('renders the real read for HR with the handover row from BOW-899', async () => {
    workbenchQuery.mockResolvedValue({ status: 'ok', data: hr });
    const { container } = render(await WorkPage());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(
      /演示 HR$/,
    );
    expect(container.querySelector('.nt-head p')?.textContent).toBe(
      '9 月 4 日 · 周五',
    );
    expect(
      screen.getByRole('textbox', { name: '描述你要做的事' }),
    ).toBeTruthy();
    const handover = screen.getByRole('link', { name: /件事待接手/ });
    expect(handover.getAttribute('href')).toBe('/work/reassign');
    expect(handover.textContent).toContain(
      '演示原导师的评价关系已结束：1 件事待接手',
    );
    // Material checks and conclusions are not connected: no total, no such groups.
    expect(container.querySelector('#todo h3')?.textContent).toBe('待办');
    expect(container.textContent).not.toMatch(/待核对|节点结论/);
    // Export (BOW-912) is not connected.
    expect(container.querySelector('#btn-export')).toBeNull();
    // Named demo examples outside production.
    expect(container.querySelectorAll('.n-ask')).toHaveLength(1);
  });

  it('reads reassignments for HR only', async () => {
    for (const data of [manager, mentor]) {
      workbenchQuery.mockResolvedValue({ status: 'ok', data });
      const { container, unmount } = render(await WorkPage());
      expect(container.querySelector('#todo')).toBeNull();
      unmount();
    }
    expect(reassignQuery).not.toHaveBeenCalled();
  });

  it('drops the named examples in production', async () => {
    vi.stubEnv('APP_ENV', 'production');
    workbenchQuery.mockResolvedValue({ status: 'ok', data: mentor });
    const { container } = render(await WorkPage());
    expect(container.querySelector('.n-ask')).toBeNull();
    expect(container.querySelector('#students')).toBeTruthy();
  });

  it('says a mixed HR and mentor account waits for its view, never an empty list', async () => {
    workbenchQuery.mockRejectedValue(new NotConnected());
    const { container } = render(await WorkPage());
    expect(screen.getByText('工作台待开通')).toBeTruthy();
    expect(container.querySelector('#students, #todo, textarea')).toBeNull();
  });

  it('shows administrators the business-view state, and rethrows other failures', async () => {
    workbenchQuery.mockResolvedValue({ status: 'forbidden' });
    render(await WorkPage());
    expect(screen.getByText('这一页属于业务视角')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: '打开系统管理' }).getAttribute('href'),
    ).toBe('/admin');
    workbenchQuery.mockRejectedValue(new Error('database down'));
    await expect(WorkPage()).rejects.toThrow('database down');
  });

  it('denies without a shell and titles the page per viewer', async () => {
    shellQuery.mockResolvedValue(null);
    render(await WorkPage());
    expect(workbenchQuery).not.toHaveBeenCalled();
    expect(await generateMetadata()).toEqual({
      title: '查看权限已更新 · Niu-Talent',
    });
    shellQuery.mockResolvedValue({ ...shell, isAdmin: true });
    expect(await generateMetadata()).toEqual({
      title: '这一页属于业务视角 · Niu-Talent',
    });
    shellQuery.mockResolvedValue(shell);
    expect(await generateMetadata()).toEqual({ title: '工作台 · Niu-Talent' });
  });
});

describe('/work/reassign', () => {
  const page = async () =>
    render(
      <ShellTitleProvider>
        <ToastProvider>{await ReassignPage()}</ToastProvider>
      </ShellTitleProvider>,
    );

  it('lists the handover items from the read', async () => {
    await page();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      '重新分派',
    );
    expect(screen.getByRole('checkbox', { name: /演示甲/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /演示新导师/ })).toBeTruthy();
  });

  it('sends anyone without the HR grant back to the workbench', async () => {
    reassignQuery.mockResolvedValue({
      status: 'forbidden',
      message: '你没有查看重新分派事项的权限',
    });
    await page();
    expect(screen.getByText('重新分派由 HR 处理')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(
      screen.getByRole('link', { name: '回到工作台' }).getAttribute('href'),
    ).toBe('/work');
  });

  it('denies without a shell and titles the page per viewer', async () => {
    shellQuery.mockResolvedValue(null);
    await page();
    expect(reassignQuery).not.toHaveBeenCalled();
    expect(await reassignMetadata()).toEqual({
      title: '查看权限已更新 · Niu-Talent',
    });
    shellQuery.mockResolvedValue(shell);
    expect(await reassignMetadata()).toEqual({
      title: '重新分派 · Niu-Talent',
    });
  });
});

describe('/work loading and failure', () => {
  it('says it is loading, and offers a reload after a failure', async () => {
    const { default: Loading } = await import('./loading');
    const { default: ErrorPage } = await import('./error');
    const { default: ReassignLoading } = await import('./reassign/loading');
    render(<Loading />);
    render(<ReassignLoading />);
    expect(screen.getAllByRole('status')).toHaveLength(2);
    const reset = vi.fn();
    render(<ErrorPage reset={reset} />);
    screen.getByRole('button', { name: '重新加载' }).click();
    expect(reset).toHaveBeenCalled();
  });
});
