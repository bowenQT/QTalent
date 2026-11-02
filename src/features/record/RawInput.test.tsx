// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { RawInput } from './RawInput';

afterEach(cleanup);

describe('RawInput', () => {
  it('照原型收起显示原话，不加标记', () => {
    const { container } = render(
      <RawInput text="演示甲今天独立完成了合成任务" />,
    );
    const details = container.querySelector('details');
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe('原话');
    expect(details?.querySelector('p')?.textContent).toBe(
      '演示甲今天独立完成了合成任务',
    );
    expect(container.querySelector('mark')).toBeNull();
  });
});
