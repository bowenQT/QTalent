// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Shell } from '@/contracts/shell';
import type { StaffingDemand } from '@/contracts/staffing';

const getShellPage = vi.hoisted(() => vi.fn());
const getProjectsPage = vi.hoisted(() => vi.fn());
const readStaffingDemand = vi.hoisted(() => vi.fn());
const live = vi.hoisted(() => vi.fn());
vi.mock('@/server/queries/shell', () => ({ getShellPage }));
vi.mock('@/server/queries/projects', () => ({ getProjectsPage }));
vi.mock('@/server/queries/staffing-demand', () => ({ readStaffingDemand }));
vi.mock('@/features/shell/AccessDenied', () => ({
  AccessDenied: () => <p>access-denied</p>,
}));
vi.mock('@/features/shell/ShellTitle', () => ({ ShellTitle: () => null }));
vi.mock('@/features/staffing/LiveStaffing', async () => {
  const { useState } = await import('react');
  return {
    LiveStaffing: (props: { project: { id: string } }) => {
      live(props);
      // State taken at mount, the way the real page keeps its ports and sentence.
      const [mountedFor] = useState(props.project.id);
      return <p data-mounted-for={mountedFor}>live-staffing</p>;
    },
  };
});

import StaffingPage, { generateMetadata } from './page';

afterEach(() => {
  cleanup();
  for (const mock of [getShellPage, getProjectsPage, readStaffingDemand, live])
    mock.mockReset();
});

const shell = (roles: string[], isAdmin = false) =>
  ({ account: { id: 'acct-hr', roles }, isAdmin }) as unknown as Shell;
const project = {
  id: 'demo-project',
  name: '演示项目',
  goal: '演示：给服务端补一个负责人。',
  status: '筹备中' as const,
  type: '用人项目',
};
const demand: StaffingDemand = {
  id: 'demo-demand',
  projectId: project.id,
  revision: 1,
  inputText: '演示：寻找服务端负责人',
  requirements: [{ id: 'r1', text: '独立交付模块', priority: 'required' }],
  status: 'draft',
};
const open = (params: Record<string, string>) =>
  StaffingPage({ searchParams: Promise.resolve(params) });

describe('staffing route', () => {
  it('stops viewers outside management and HR before anything is read', async () => {
    getShellPage.mockResolvedValue(shell(['mentor']));
    render(await open({ project: project.id }));
    expect(screen.getByText('这一页属于其他视角')).toBeTruthy();
    expect(
      screen.getByText('找 owner 和项目找人只对管理者和 HR 开放。'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: '回到工作台' })).toBeTruthy();
    expect(getProjectsPage).not.toHaveBeenCalled();
    expect(readStaffingDemand).not.toHaveBeenCalled();
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

  it('asks for a project first: a demand is saved per project', async () => {
    getShellPage.mockResolvedValue(shell(['manager']));
    for (const params of [{}, { new: '1' }] as Record<string, string>[]) {
      render(await open(params));
      expect(screen.getByText('选一个项目再找人')).toBeTruthy();
      expect(
        screen
          .getByRole('link', { name: '打开项目与课题' })
          .getAttribute('href'),
      ).toBe('/projects');
      expect(live).not.toHaveBeenCalled();
      cleanup();
    }
    expect(await generateMetadata()).toEqual({ title: '找人 · Niu-Talent' });
  });

  it('says the link is stale for a project the viewer cannot read', async () => {
    getShellPage.mockResolvedValue(shell(['hr']));
    getProjectsPage.mockResolvedValueOnce({
      status: 'ok',
      data: { projects: [project] },
    });
    render(await open({ project: 'other-project' }));
    expect(screen.getByText('项目链接失效')).toBeTruthy();
    cleanup();
    getProjectsPage.mockResolvedValueOnce({ status: 'forbidden' });
    render(await open({ project: project.id }));
    expect(screen.getByText('项目链接失效')).toBeTruthy();
    expect(readStaffingDemand).not.toHaveBeenCalled();
  });

  it('opens the sentence entry for a project, keeping a drafting job and the workbench sentence', async () => {
    getShellPage.mockResolvedValue(shell(['manager']));
    getProjectsPage.mockResolvedValue({
      status: 'ok',
      data: { projects: [project] },
    });
    render(await open({ project: project.id, job: 'job-1', draft: 'work' }));
    expect(screen.getByText('live-staffing')).toBeTruthy();
    expect(live).toHaveBeenCalledWith({
      project: {
        id: project.id,
        name: project.name,
        goal: project.goal,
        status: project.status,
      },
      demand: null,
      resumeJobId: 'job-1',
      accountId: 'acct-hr',
      fromWorkbench: true,
    });
    expect(readStaffingDemand).not.toHaveBeenCalled();
  });

  it('reads the demand of the link and drops the job it came from', async () => {
    getShellPage.mockResolvedValue(shell(['hr']));
    getProjectsPage.mockResolvedValue({
      status: 'ok',
      data: { projects: [project] },
    });
    readStaffingDemand.mockResolvedValue(demand);
    render(
      await open({ project: project.id, demand: demand.id, job: 'job-1' }),
    );
    expect(readStaffingDemand).toHaveBeenCalledWith(demand.id);
    expect(live).toHaveBeenCalledWith(
      expect.objectContaining({ demand, resumeJobId: null }),
    );
  });

  it('says the demand link is stale when the demand is unreadable or belongs to another project', async () => {
    getShellPage.mockResolvedValue(shell(['hr']));
    getProjectsPage.mockResolvedValue({
      status: 'ok',
      data: { projects: [project] },
    });
    for (const read of [null, { ...demand, projectId: 'other-project' }]) {
      readStaffingDemand.mockResolvedValueOnce(read);
      render(await open({ project: project.id, demand: demand.id }));
      expect(screen.getByText('需求链接失效')).toBeTruthy();
      expect(live).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it('gives another project, or another account, a fresh page instead of keeping the last one', async () => {
    const other = { ...project, id: 'other-project', name: '演示项目二' };
    getProjectsPage.mockResolvedValue({
      status: 'ok',
      data: { projects: [project, other] },
    });
    const mountedFor = () =>
      screen.getByText('live-staffing').getAttribute('data-mounted-for');
    getShellPage.mockResolvedValue(shell(['hr']));
    const { rerender } = render(await open({ project: project.id }));
    expect(mountedFor()).toBe(project.id);
    // In-app navigation re-renders the same route without unmounting it.
    rerender(await open({ project: other.id }));
    expect(mountedFor()).toBe(other.id);
    const page = await open({ project: other.id });
    getShellPage.mockResolvedValue({
      ...shell(['hr']),
      account: { id: 'acct-other', roles: ['hr'] },
    });
    const signedIn = await open({ project: other.id });
    expect(page.key).not.toBe(signedIn.key);
  });
});
