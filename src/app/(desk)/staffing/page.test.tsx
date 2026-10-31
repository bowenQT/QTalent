// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Shell } from '@/contracts/shell';

const getShellPage = vi.hoisted(() => vi.fn());
vi.mock('@/server/queries/shell', () => ({ getShellPage }));
vi.mock('@/features/shell/AccessDenied', () => ({
  AccessDenied: () => <p>access-denied</p>,
}));

import StaffingPage, { generateMetadata } from './page';

afterEach(() => {
  cleanup();
  getShellPage.mockReset();
});

const shell = (roles: string[], isAdmin = false) =>
  ({ account: { roles }, isAdmin }) as unknown as Shell;

describe('staffing route', () => {
  it('stops viewers outside management and HR before anything is read', async () => {
    getShellPage.mockResolvedValue(shell(['mentor']));
    render(await StaffingPage());
    expect(screen.getByText('这一页属于其他视角')).toBeTruthy();
    expect(
      screen.getByText('找 owner 和项目找人只对管理者和 HR 开放。'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: '回到工作台' })).toBeTruthy();
    expect(await generateMetadata()).toEqual({
      title: '这一页属于其他视角 · Niu-Talent',
    });
  });

  it('sends administrators to system management', async () => {
    getShellPage.mockResolvedValue(shell(['admin'], true));
    render(await StaffingPage());
    expect(screen.getByText('这一页属于业务视角')).toBeTruthy();
    expect(await generateMetadata()).toEqual({
      title: '这一页属于业务视角 · Niu-Talent',
    });
  });

  it('asks for sign-in again when the session no longer authorizes', async () => {
    getShellPage.mockResolvedValue(null);
    render(await StaffingPage());
    expect(screen.getByText('access-denied')).toBeTruthy();
    expect(await generateMetadata()).toEqual({
      title: '查看权限已更新 · Niu-Talent',
    });
  });

  it('tells managers and HR the page is not connected yet, without sample data', async () => {
    for (const roles of [['manager'], ['mentor', 'hr']]) {
      getShellPage.mockResolvedValue(shell(roles));
      render(await StaffingPage());
      expect(screen.getByText('找人还没接通')).toBeTruthy();
      expect(screen.queryByText(/候选人 /)).toBeNull();
      expect(await generateMetadata()).toEqual({ title: '找人 · Niu-Talent' });
      cleanup();
    }
  });
});
