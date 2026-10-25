// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectList } from '@/contracts/projects';
import { Projects } from './Projects';
const { action, refresh } = vi.hoisted(() => ({
  action: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/server/actions/projects', () => ({ createProjectAction: action }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const data: ProjectList = {
  canCreate: true,
  eligiblePeople: [
    {
      id: 'test-person',
      name: '测试成员',
      hue: 20,
      orgName: '测试组织',
      currentProjectCount: 2,
    },
  ],
  projects: [
    {
      id: 'test-project',
      name: '测试项目',
      type: '业务项目',
      status: '进行中',
      goal: '测试目标',
      orgName: '测试组织',
      from: '2026-09-04',
      to: '2026-12-31',
      owner: null,
      members: [],
      memberCount: 0,
    },
    {
      id: 'test-ended',
      name: '结束项目',
      type: '专项',
      status: '已结束',
      goal: '完成目标',
      orgName: '测试组织',
      from: '2026-07-06',
      to: '2026-09-04',
      owner: { id: 'test-person', name: '测试成员' },
      members: [{ id: 'test-person', name: '测试成员', hue: 20, photo: null }],
      memberCount: 1,
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);
describe('project reference interactions', () => {
  it('shows the filtered cards and owner action, then the empty state', async () => {
    const user = userEvent.setup();
    render(<Projects data={data} mentor={false} />);
    expect(
      screen.getByRole('link', { name: '发起找 owner' }).getAttribute('href'),
    ).toBe('/staffing?project=test-project');
    expect(screen.getByText('owner 测试成员 · 1 人参与')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '已归档' }));
    expect(screen.queryByRole('link', { name: '测试项目' })).toBeNull();
    expect(screen.getByText('这个状态的项目会出现在这里。')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '全部' }));
    expect(screen.getByRole('link', { name: '测试项目' })).toBeTruthy();
  });
  it('hides privileged controls for mentors', () => {
    render(<Projects data={{ ...data, canCreate: false }} mentor />);
    expect(screen.queryByRole('button', { name: '新建项目' })).toBeNull();
    expect(screen.queryByRole('link', { name: '发起找 owner' })).toBeNull();
    expect(
      screen.getByText('你所带批次的课题，以及你参与的项目。'),
    ).toBeTruthy();
  });
  it('keeps invalid input in the dialog and focuses name; escape restores trigger focus', async () => {
    const user = userEvent.setup();
    render(<Projects data={data} mentor={false} />);
    await user.click(screen.getByRole('button', { name: '新建项目' }));
    await user.click(screen.getByRole('button', { name: '创建' }));
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('项目名称');
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: /项目名称/ }),
    );
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: '新建项目' }),
      ),
    );
  });
  it('blocks repeated clicks, commits multi-selection and returns to the list', async () => {
    let resolve!: (value: unknown) => void;
    action.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const user = userEvent.setup();
    render(<Projects data={data} mentor={false} />);
    await user.click(screen.getByRole('button', { name: '新建项目' }));
    await user.type(
      screen.getByRole('textbox', { name: '项目名称' }),
      '  新项目  ',
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: /owner/ }),
      'test-person',
    );
    await user.click(screen.getByRole('checkbox', { name: /测试成员/ }));
    const form = screen.getByRole('dialog').querySelector('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(action).toHaveBeenCalledTimes(1);
    expect(action.mock.calls[0]?.[0]).toMatchObject({
      name: '新项目',
      ownerId: 'test-person',
      memberIds: ['test-person'],
    });
    expect(
      screen.getByRole('button', { name: '创建中' }).hasAttribute('disabled'),
    ).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeTruthy();
    resolve({ status: 'success', projectId: 'created', replayed: false });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toContain('项目已创建');
  });
  it('reuses the same key after an uncertain network response without clearing fields', async () => {
    action
      .mockRejectedValueOnce(new Error('connection'))
      .mockResolvedValueOnce({
        status: 'success',
        projectId: 'created',
        replayed: true,
      });
    const user = userEvent.setup();
    render(<Projects data={data} mentor={false} />);
    await user.click(screen.getByRole('button', { name: '新建项目' }));
    await user.type(
      screen.getByRole('textbox', { name: '项目名称' }),
      '保留的项目',
    );
    await user.click(screen.getByRole('button', { name: '创建' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(
      (screen.getByRole('textbox', { name: '项目名称' }) as HTMLInputElement)
        .value,
    ).toBe('保留的项目');
    await user.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    expect(action.mock.calls[0]?.[0].requestId).toBe(
      action.mock.calls[1]?.[0].requestId,
    );
  });
  it.each(['forbidden', 'not_found', 'conflict', 'validation_error'])(
    'retains the form for %s',
    async (status) => {
      action.mockResolvedValue({
        status,
        message: 'test',
        fieldErrors: { name: ['请更新名称'] },
      });
      const user = userEvent.setup();
      render(<Projects data={data} mentor={false} />);
      await user.click(screen.getByRole('button', { name: '新建项目' }));
      await user.type(
        screen.getByRole('textbox', { name: '项目名称' }),
        '保留',
      );
      await user.click(screen.getByRole('button', { name: '创建' }));
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(screen.getByRole('dialog')).toBeTruthy();
      if (status === 'validation_error')
        await waitFor(() =>
          expect(document.activeElement).toBe(
            screen.getByRole('textbox', { name: /项目名称/ }),
          ),
        );
      await user.click(screen.getByRole('button', { name: '取消' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    },
  );
});
