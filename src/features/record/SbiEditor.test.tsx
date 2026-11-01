// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { copy } from './copy';
import { SbiEditor } from './SbiEditor';

afterEach(cleanup);

const sbi = {
  title: '独立完成合成任务',
  situation: '',
  behavior: '演示甲独立完成了合成任务',
  impact: '',
};

describe('SbiEditor', () => {
  it('标题和三段文字可直接改，空的情境和影响显示灰色占位', () => {
    const onChange = vi.fn();
    render(<SbiEditor sbi={sbi} editable onChange={onChange} />);
    const title = screen.getByRole('textbox', { name: copy.sbi.title });
    expect(title.textContent).toBe(sbi.title);
    expect(title.getAttribute('contenteditable')).toBe('plaintext-only');
    expect(title.classList.contains('is-light')).toBe(true);
    const situation = screen.getByRole('textbox', { name: copy.sbi.situation });
    expect(situation.textContent).toBe(copy.sbi.situationPlaceholder);
    expect(situation.getAttribute('data-empty')).toBe('1');
    expect(situation.classList.contains('is-light')).toBe(false);

    title.textContent = '新的标题';
    fireEvent.input(title);
    expect(onChange).toHaveBeenCalledWith('title', '新的标题');
    // 用户改过之后去掉 AI 整理的流光底
    expect(title.classList.contains('is-light')).toBe(false);
  });

  it('聚焦空字段清空占位，失焦且仍为空时恢复占位', () => {
    const onChange = vi.fn();
    render(<SbiEditor sbi={sbi} editable onChange={onChange} />);
    const impact = screen.getByRole('textbox', { name: copy.sbi.impact });
    fireEvent.focus(impact);
    expect(impact.textContent).toBe('');
    expect(impact.getAttribute('data-empty')).toBeNull();
    fireEvent.blur(impact);
    expect(impact.textContent).toBe(copy.sbi.impactPlaceholder);
  });

  it('输入内容后不回写 DOM，光标不跳', () => {
    const { rerender } = render(
      <SbiEditor sbi={sbi} editable onChange={() => undefined} />,
    );
    const behavior = screen.getByRole('textbox', { name: copy.sbi.behavior });
    behavior.textContent = '改了一半';
    fireEvent.input(behavior);
    rerender(
      <SbiEditor
        sbi={{ ...sbi, behavior: '改了一半' }}
        editable
        onChange={() => undefined}
      />,
    );
    expect(behavior.textContent).toBe('改了一半');
  });

  it('只读（已保存）：不可编辑，没有流光底，空字段照原型留灰字', () => {
    render(<SbiEditor sbi={sbi} editable={false} onChange={() => undefined} />);
    const title = screen.getByRole('textbox', { name: copy.sbi.title });
    expect(title.getAttribute('contenteditable')).toBeNull();
    expect(title.getAttribute('aria-readonly')).toBe('true');
    expect(title.classList.contains('is-light')).toBe(false);
    const situation = screen.getByRole('textbox', {
      name: copy.sbi.situation,
    });
    expect(situation.textContent).toBe(copy.sbi.situationPlaceholder);
    expect(situation.getAttribute('data-empty')).toBe('1');
  });

  it('必填项空着时给出提示；服务端指出的问题按字段显示', () => {
    const { rerender } = render(
      <SbiEditor
        sbi={sbi}
        editable
        onChange={() => undefined}
        required={{ title: true, behavior: true }}
      />,
    );
    expect(screen.getByText(copy.sbi.titleNeeded)).toBeTruthy();
    expect(screen.getByText(copy.sbi.behaviorNeeded)).toBeTruthy();
    rerender(
      <SbiEditor
        sbi={sbi}
        editable
        onChange={() => undefined}
        problems={{
          title: copy.sbi.titleNeeded,
          sbi: copy.sbi.fieldProblem,
          scores: {},
          general: false,
        }}
      />,
    );
    expect(screen.getByText(copy.sbi.titleNeeded)).toBeTruthy();
    expect(screen.getByText(copy.sbi.fieldProblem)).toBeTruthy();
    expect(screen.queryByText(copy.sbi.behaviorNeeded)).toBeNull();
  });
});
