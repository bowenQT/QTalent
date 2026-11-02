// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnchorPanel } from './AnchorPanel';
import { copy } from './copy';
import { dimensions } from './record.fixtures';
import type { AnchorMap } from './types';

afterEach(cleanup);

const map: AnchorMap = {
  p1: {
    prof: {
      ruleVersion: 'v-test',
      family: '演示甲属于演示族 · 演示族锚点',
      levels: ['一档', '二档', '三档', '四档', '五档'],
    },
    mot: {
      ruleVersion: 'v-test',
      family: null,
      levels: ['a', 'b', 'c', 'd', 'e'],
    },
  },
};
const focus = { personId: 'p1', dimensionId: 'prof', hit: 3 };

describe('AnchorPanel', () => {
  it('显示五档锚点、规则版本和岗位族说明，命中档高亮', () => {
    const { container } = render(
      <AnchorPanel
        focus={focus}
        load={{ status: 'ready', map }}
        dimensions={dimensions}
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByText(copy.anchor.title('专业度'))).toBeTruthy();
    expect(screen.getByText('v-test')).toBeTruthy();
    expect(screen.getByText('演示甲属于演示族 · 演示族锚点')).toBeTruthy();
    expect(container.querySelectorAll('li')).toHaveLength(5);
    expect(container.querySelector('li.is-hit')?.textContent).toBe('3三档');
  });

  it('没有岗位族说明和命中时不显示多余内容', () => {
    const { container } = render(
      <AnchorPanel
        focus={{ personId: 'p1', dimensionId: 'mot', hit: null }}
        load={{ status: 'ready', map }}
        dimensions={dimensions}
        onRetry={() => undefined}
      />,
    );
    expect(container.querySelector('.nt-muted')).toBeNull();
    expect(container.querySelector('li.is-hit')).toBeNull();
  });

  it('没有焦点时说明如何查看', () => {
    render(
      <AnchorPanel
        focus={null}
        load={{ status: 'ready', map: {} }}
        dimensions={dimensions}
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByText(copy.anchor.idle)).toBeTruthy();
  });

  it('读取中给出状态', () => {
    render(
      <AnchorPanel
        focus={focus}
        load={{ status: 'loading' }}
        dimensions={dimensions}
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe(copy.anchor.loading);
  });

  it('读取失败：说明并给重试', async () => {
    const onRetry = vi.fn();
    render(
      <AnchorPanel
        focus={focus}
        load={{ status: 'error' }}
        dimensions={dimensions}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain(copy.anchor.failed);
    await userEvent.click(
      screen.getByRole('button', { name: copy.anchor.retry }),
    );
    expect(onRetry).toHaveBeenCalled();
  });

  it('当前这一行没有对应锚点时只给通用说明', () => {
    render(
      <AnchorPanel
        focus={{ personId: 'p9', dimensionId: 'x', hit: 1 }}
        load={{ status: 'ready', map }}
        dimensions={dimensions}
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByText(copy.anchor.idle)).toBeTruthy();
  });
});
