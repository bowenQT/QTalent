// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { peopleList, seeds } from '@/features/people/people-test-data';
import PeoplePage, { generateMetadata } from './page';
import ErrorPage from './error';
import Loading from './loading';

const { shell, list } = vi.hoisted(() => ({ shell: vi.fn(), list: vi.fn() }));
vi.mock('@/server/queries/shell', () => ({ getShellPage: shell }));
vi.mock('@/server/queries/people', () => ({ listPeopleForCurrentUser: list }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/people',
}));
afterEach(() => {
  cleanup();
  list.mockReset();
});

describe('/people', () => {
  it('names the tab after the role', async () => {
    for (const [value, title] of [
      [null, '查看权限已更新'],
      [{ isAdmin: true, role: 'admin' }, '这一页属于业务视角'],
      [{ isAdmin: false, role: 'mentor' }, '所带学员'],
      [{ isAdmin: false, role: 'hr' }, '人才'],
    ] as const) {
      shell.mockResolvedValue(value);
      expect((await generateMetadata()).title).toBe(`${title} · Niu-Talent`);
    }
  });

  it('asks a signed-out session to sign in again, reading nobody', async () => {
    shell.mockResolvedValue(null);
    render(await PeoplePage());
    expect(screen.getByRole('heading').textContent).toBe('查看权限已更新');
    expect(list).not.toHaveBeenCalled();
  });

  it('stops administrators before any name is read', async () => {
    shell.mockResolvedValue({ isAdmin: true, role: 'admin' });
    render(await PeoplePage());
    expect(screen.getByText('这一页属于业务视角')).toBeTruthy();
    expect(list).not.toHaveBeenCalled();
  });

  it('renders the list read for the current user', async () => {
    shell.mockResolvedValue({ isAdmin: false, role: 'mentor' });
    list.mockResolvedValue(peopleList('mentor', seeds));
    render(await PeoplePage());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      '所带学员',
    );
    expect(document.querySelectorAll('.n-person-row')).toHaveLength(4);
  });

  it('says it is loading, and offers a retry when the read fails', () => {
    render(<Loading />);
    expect(screen.getByRole('status').textContent).toBe('内容加载中');
    const reset = vi.fn();
    render(<ErrorPage reset={reset} />);
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
