// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { copy } from './copy';
import { OrganizeProgress, trailSteps } from './OrganizeProgress';

afterEach(cleanup);

describe('trailSteps', () => {
  const states = (steps: ReturnType<typeof trailSteps>) =>
    steps.map((s) => s.state);

  it('处理中：回执不带分步进度，第一步进行中并说明已提交，不编造进度', () => {
    const steps = trailSteps(true, null);
    expect(states(steps)).toEqual(['active', 'pending', 'pending']);
    expect(steps[0]?.detail).toBe(copy.trail.queued);
  });

  it('失败：第一步标失败并写明原话已保留', () => {
    const steps = trailSteps(false, 'processing_failed', true);
    expect(states(steps)).toEqual(['failed', 'pending', 'pending']);
    expect(steps[0]?.detail).toBe(copy.trail.kept);
  });

  it('整理结束后全部完成', () => {
    expect(states(trailSteps(false, null, true))).toEqual([
      'done',
      'done',
      'done',
    ]);
  });
});

describe('OrganizeProgress', () => {
  it('显示 3 步轨迹，连接中断时说明内容还在', () => {
    const { rerender } = render(
      <OrganizeProgress processing failure={null} connection="connected" />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByText(copy.connection.lost)).toBeNull();
    rerender(<OrganizeProgress processing failure={null} connection="error" />);
    expect(screen.getByText(copy.connection.lost)).toBeTruthy();
  });
});
