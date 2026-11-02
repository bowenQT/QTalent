// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ShellData } from '@/contracts/shell';
import { ToastProvider } from '@/components/ui/Toast';
import { fixtures } from '../../../../tests/fixtures/p0-contracts';
import PersonPage, { generateMetadata } from './page';
import { loadPersonPage, personIdOf } from './person-page';
import { readSource } from './read-source';
import Loading from './loading';
import ErrorPage from './error';
import PersonNotFound from './not-found';

const { shellQuery, personQuery, sourceQuery } = vi.hoisted(() => ({
  shellQuery: vi.fn(),
  personQuery: vi.fn(),
  sourceQuery: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/server/queries/shell', () => ({ getShellPage: shellQuery }));
vi.mock('@/server/queries/person', () => ({
  readPersonForCurrentUser: personQuery,
}));
vi.mock('@/server/queries/sources', () => ({
  readSourceForCurrentUser: sourceQuery,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => {
    throw new Error('not-found');
  },
}));

const shell: ShellData = {
  account: {
    id: 'test',
    name: '测试账号',
    email: 'test@qtalent.test',
    roles: ['manager'],
    hue: 20,
    roleLabel: '管理者',
    scopeLabel: '全公司',
  },
  navigation: [],
  counts: { status: 'not_connected' },
  recent: { status: 'not_connected' },
  canSearch: false,
  isAdmin: false,
  role: 'manager',
};
const [manager, mentor] = fixtures.person;
const params = (value: Record<string, string | string[] | undefined>) => ({
  searchParams: Promise.resolve(value),
});
const NAME = manager.person.name;

beforeEach(() => {
  vi.clearAllMocks();
  shellQuery.mockResolvedValue(shell);
  personQuery.mockResolvedValue({ status: 'success', person: manager });
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('person route', () => {
  it('renders the profile and titles it with the name', async () => {
    // The desk shell provides the toasts the print entry uses.
    render(
      <ToastProvider>
        {await PersonPage(params({ id: 'test-person-001' }))}
      </ToastProvider>,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain(
      NAME,
    );
    expect(screen.getByRole('button', { name: '打印档案' })).toBeTruthy();
    expect(personQuery).toHaveBeenCalledWith({ id: 'test-person-001' });
    expect(await generateMetadata(params({ id: 'test-person-001' }))).toEqual({
      title: `${NAME} · Niu-Talent`,
    });
  });

  it('gives the mentor no print entry, only the line a plain browser print shows', async () => {
    personQuery.mockResolvedValue({ status: 'success', person: mentor });
    const { container } = render(
      <ToastProvider>
        {await PersonPage(params({ id: mentor.person.id }))}
      </ToastProvider>,
    );
    expect(screen.queryByRole('button', { name: '打印档案' })).toBeNull();
    expect(container.querySelector('.nt-head__acts')).toBeNull();
    expect(document.getElementById('print-sheet')?.textContent).toContain(
      '档案打印只对管理者和这个人的归属 HR 开放',
    );
  });

  it('treats missing, repeated or out-of-scope ids as not found, without the name', async () => {
    personQuery.mockResolvedValue({ status: 'not_found', message: '不可见' });
    await expect(PersonPage(params({ id: 'someone-else' }))).rejects.toThrow(
      'not-found',
    );
    for (const value of [{}, { id: ['a', 'b'] }, { id: '' }]) {
      await expect(PersonPage(params(value))).rejects.toThrow('not-found');
      expect(await generateMetadata(params(value))).toEqual({
        title: '人员链接失效 · Niu-Talent',
      });
    }
    expect(personQuery).toHaveBeenCalledTimes(1);
  });

  it('stops the system administrator before reading anyone', async () => {
    shellQuery.mockResolvedValue({ ...shell, isAdmin: true, role: 'admin' });
    const { container } = render(
      await PersonPage(params({ id: 'test-person-001' })),
    );
    expect(screen.getByText('这一页属于业务视角')).toBeTruthy();
    expect(container.textContent).not.toContain(NAME);
    expect(personQuery).not.toHaveBeenCalled();
    expect(await generateMetadata(params({ id: 'test-person-001' }))).toEqual({
      title: '这一页属于业务视角 · Niu-Talent',
    });
  });

  it('shows the access notice when the account has lost its grants', async () => {
    shellQuery.mockResolvedValue(null);
    render(await PersonPage(params({ id: 'test-person-001' })));
    expect(personQuery).not.toHaveBeenCalled();
    expect(await generateMetadata(params({ id: 'x' }))).toEqual({
      title: '查看权限已更新 · Niu-Talent',
    });
  });

  it('reads the id only when it is a single string', () => {
    expect(personIdOf({ id: 'a' })).toBe('a');
    expect(personIdOf({ id: ['a'] })).toBeNull();
    expect(personIdOf({})).toBeNull();
  });

  it('shares one read between metadata and page for the same request', async () => {
    expect(await loadPersonPage('test-person-001', false)).toMatchObject({
      status: 'ok',
    });
  });
});

describe('source action', () => {
  it('passes the request to the authorized source read unchanged', async () => {
    const result = { status: 'not_found', message: '不存在' };
    sourceQuery.mockResolvedValue(result);
    const input = { fragmentId: 'f', originalVersionId: 'v' };
    expect(await readSource(input)).toBe(result);
    expect(sourceQuery).toHaveBeenCalledWith(input);
  });
});

describe('route states', () => {
  it('announces loading', () => {
    render(<Loading />);
    expect(screen.getByRole('status').textContent).toBe('档案加载中');
  });
  it('offers a retry on failure', () => {
    const reset = vi.fn();
    render(<ErrorPage reset={reset} />);
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(reset).toHaveBeenCalled();
  });
  it('uses one not-found page for missing and out-of-scope people', () => {
    render(<PersonNotFound />);
    expect(screen.getByText('人员链接失效')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: '回到人才列表' }).getAttribute('href'),
    ).toBe('/people');
  });
});
