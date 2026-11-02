// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { copy } from './copy';
import {
  OrganizeProgress,
  completedSteps,
  trailSteps,
} from './OrganizeProgress';
import { job } from './record.fixtures';

afterEach(cleanup);

describe('completedSteps', () => {
  it('没有进度时为 0，不编造分步进度', () => {
    expect(completedSteps(null)).toBe(0);
    expect(completedSteps({ completed: 0, total: 0 })).toBe(0);
  });
  it('按完成比例映射到 3 步，且不超过 3', () => {
    expect(completedSteps({ completed: 1, total: 3 })).toBe(1);
    expect(completedSteps({ completed: 2, total: 3 })).toBe(2);
    expect(completedSteps({ completed: 3, total: 3 })).toBe(3);
    expect(completedSteps({ completed: 9, total: 3 })).toBe(3);
  });
});

describe('trailSteps', () => {
  const states = (steps: ReturnType<typeof trailSteps>) =>
    steps.map((s) => s.state);

  it('排队：第一步进行中并说明已提交', () => {
    const steps = trailSteps(job({ status: 'queued' }), null);
    expect(states(steps)).toEqual(['active', 'pending', 'pending']);
    expect(steps[0]?.detail).toBe(copy.trail.queued);
  });

  it('运行中没有进度：只有第一步进行中，没有排队说明', () => {
    const steps = trailSteps(job({ status: 'running' }), null);
    expect(states(steps)).toEqual(['active', 'pending', 'pending']);
    expect(steps[0]?.detail).toBeUndefined();
  });

  it('有进度时按步映射', () => {
    const steps = trailSteps(
      job({ status: 'running', progress: { completed: 2, total: 3 } }),
      null,
    );
    expect(states(steps)).toEqual(['done', 'done', 'active']);
  });

  it('失败：当前步标失败并写明原话已保留', () => {
    const steps = trailSteps(
      job({ status: 'failed', progress: { completed: 1, total: 3 } }),
      'processing_failed',
    );
    expect(states(steps)).toEqual(['done', 'failed', 'pending']);
    expect(steps[1]?.detail).toBe(copy.trail.kept);
  });

  it('尚未收到任务快照时按排队处理；完成后全部完成', () => {
    expect(states(trailSteps(null, null))).toEqual([
      'active',
      'pending',
      'pending',
    ]);
    expect(states(trailSteps(null, null, true))).toEqual([
      'done',
      'done',
      'done',
    ]);
  });
});

describe('OrganizeProgress', () => {
  it('显示 3 步轨迹，连接中断时说明内容还在', () => {
    const { rerender } = render(
      <OrganizeProgress job={job()} failure={null} connection="connected" />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByText(copy.connection.lost)).toBeNull();
    rerender(
      <OrganizeProgress job={job()} failure={null} connection="error" />,
    );
    expect(screen.getByText(copy.connection.lost)).toBeTruthy();
  });
});
