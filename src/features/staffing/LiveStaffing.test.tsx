// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { StaffingDemand } from '@/contracts/staffing';
import type { StaffingProps } from './Staffing';

const seen = vi.hoisted(() => ({ props: null as StaffingProps | null }));
vi.mock('./Staffing', () => ({
  Staffing: (props: StaffingProps) => {
    seen.props = props;
    return null;
  },
}));
vi.mock('@/features/shell/ShellTitle', () => ({ ShellTitle: () => null }));
vi.mock('@/server/actions/staffing-demand', () => ({
  createStaffingDemandAction: vi.fn(),
  editStaffingDemandAction: vi.fn(),
  confirmStaffingDemandAction: vi.fn(),
}));

import { LiveStaffing } from './LiveStaffing';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

const project = {
  id: 'demo project',
  name: '演示项目',
  goal: '演示：给服务端补一个负责人。',
  status: '筹备中' as const,
};
const demand: StaffingDemand = {
  id: 'demo-demand',
  projectId: project.id,
  revision: 1,
  inputText: '演示：寻找服务端负责人，不进地址栏',
  requirements: [{ id: 'r1', text: '独立交付模块', priority: 'required' }],
  status: 'draft',
};

describe('LiveStaffing', () => {
  it('keeps the project and the job, then the demand, in the address; never the sentence', () => {
    render(
      <LiveStaffing
        project={project}
        demand={null}
        resumeJobId="job-1"
        accountId="me"
        fromWorkbench
      />,
    );
    const props = seen.props!;
    expect(props).toMatchObject({
      project,
      demand: null,
      resumeJobId: 'job-1',
      accountId: 'me',
      fromWorkbench: true,
    });
    act(() => props.onJobStarted!('job-2'));
    expect(window.location.pathname + window.location.search).toBe(
      '/staffing?project=demo+project&job=job-2',
    );
    act(() => props.onDemandReady!(demand));
    expect(window.location.search).toBe(
      '?project=demo+project&demand=demo-demand',
    );
    expect(decodeURIComponent(window.location.href)).not.toContain('寻找');
  });
});
