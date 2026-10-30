// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { copy } from './copy';
import { people } from './record.fixtures';
import type { SelectionState } from './record-flow';
import { SelectionPanel } from './SelectionPanel';

afterEach(cleanup);

const ambiguous: SelectionState = {
  draftId: 'draft-1',
  inputVersion: 'v1',
  people: [
    {
      state: 'needs_selection',
      candidates: [
        { id: 'p1', label: '演示甲（一组）' },
        { id: 'p2', label: '演示乙（二组）' },
      ],
      reason: '原话里的名字对应两位同事',
    },
  ],
  project: {
    state: 'needs_selection',
    candidates: [
      { id: 'proj-1', label: '演示项目' },
      { id: 'proj-2', label: '另一个演示项目' },
    ],
    reason: '原话可能指两个项目',
  },
};

function setup(selection: SelectionState = ambiguous, busy = false) {
  const onSubmit = vi.fn();
  render(
    <SelectionPanel
      selection={selection}
      people={people}
      busy={busy}
      onSubmit={onSubmit}
    />,
  );
  return onSubmit;
}

describe('SelectionPanel', () => {
  it('原样显示服务端的候选和原因，不替用户选第一个', () => {
    setup();
    expect(screen.getByText('原话里的名字对应两位同事')).toBeTruthy();
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => !b.checked)).toBe(true);
    expect(
      (
        screen.getByRole('button', {
          name: copy.selection.submit,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText(copy.selection.needOne)).toBeTruthy();
  });

  it('选人和项目后提交；人员可多选，项目单选', async () => {
    const onSubmit = setup();
    await userEvent.click(screen.getByLabelText('演示甲（一组）'));
    await userEvent.click(screen.getByLabelText('演示乙（二组）'));
    // 项目还没选，仍不可提交
    expect(
      (
        screen.getByRole('button', {
          name: copy.selection.submit,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: '演示项目' }));
    await userEvent.click(
      screen.getByRole('button', { name: '另一个演示项目' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: copy.selection.submit }),
    );
    expect(onSubmit).toHaveBeenCalledWith({
      personIds: ['p1', 'p2'],
      projectId: 'proj-2',
    });
  });

  it('可以取消勾选；选「单独记录」即不关联项目', async () => {
    const onSubmit = setup();
    await userEvent.click(screen.getByLabelText('演示甲（一组）'));
    await userEvent.click(screen.getByLabelText('演示乙（二组）'));
    await userEvent.click(screen.getByLabelText('演示乙（二组）'));
    await userEvent.click(
      screen.getByRole('button', { name: copy.selection.noProject }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: copy.selection.submit }),
    );
    expect(onSubmit).toHaveBeenCalledWith({
      personIds: ['p1'],
      projectId: null,
    });
  });

  it('已确定的人带入选择，只剩项目待选时也能提交', async () => {
    const onSubmit = setup({
      ...ambiguous,
      people: [{ state: 'resolved', id: 'p1' }],
    });
    expect((screen.getByLabelText('演示甲') as HTMLInputElement).checked).toBe(
      true,
    );
    await userEvent.click(screen.getByRole('button', { name: '演示项目' }));
    await userEvent.click(
      screen.getByRole('button', { name: copy.selection.submit }),
    );
    expect(onSubmit).toHaveBeenCalledWith({
      personIds: ['p1'],
      projectId: 'proj-1',
    });
  });

  it('只有人待选择时项目保持原样，提交中控件锁定', async () => {
    const onSubmit = setup(
      {
        ...ambiguous,
        project: { state: 'resolved', id: 'proj-1' },
      },
      false,
    );
    await userEvent.click(screen.getByLabelText('演示甲（一组）'));
    await userEvent.click(
      screen.getByRole('button', { name: copy.selection.submit }),
    );
    expect(onSubmit).toHaveBeenCalledWith({
      personIds: ['p1'],
      projectId: 'proj-1',
    });
  });

  it('提交中：按钮与选项都锁定', () => {
    setup(ambiguous, true);
    expect(
      (
        screen.getByRole('button', {
          name: copy.selection.submitting,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getAllByRole('checkbox')[0] as HTMLInputElement).disabled,
    ).toBe(true);
  });

  it('候选里已确定的人若不在选项里，显示为「已选人员」', () => {
    setup({
      ...ambiguous,
      people: [{ state: 'resolved', id: 'unknown-id' }],
      project: { state: 'none' },
    });
    expect(screen.getByLabelText(copy.header.unknownPerson)).toBeTruthy();
  });
});
