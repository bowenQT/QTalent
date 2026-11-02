// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RecordBatchDraft } from '@/contracts/record';
import { initEdit } from './build-save-input';
import { copy } from './copy';
import { dimensions, draft, people, twoPeopleDraft } from './record.fixtures';
import { ScoreList } from './ScoreList';
import { scoreKey } from './types';

afterEach(cleanup);

function setup(
  d: RecordBatchDraft,
  over: Partial<Parameters<typeof ScoreList>[0]> = {},
) {
  const handlers = {
    onPick: vi.fn(),
    onReason: vi.fn(),
    onPreview: vi.fn(),
  };
  const view = render(
    <ScoreList
      draft={d}
      edit={initEdit(d)}
      people={people}
      dimensions={dimensions}
      saved={false}
      pickDisabled={false}
      loadSource={vi.fn()}
      {...handlers}
      {...over}
    />,
  );
  return { view, ...handlers };
}

describe('ScoreList', () => {
  it('单人：维度名取自选项，建议分与资料不足各一行，没有人名小标题', () => {
    setup(draft);
    expect(screen.getByRole('radiogroup', { name: '专业度分数' })).toBeTruthy();
    expect(screen.getByText('驱动力')).toBeTruthy();
    expect(screen.getByText(copy.score.insufficient)).toBeTruthy();
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('不认识的维度 id 不把内部 id 显示出来', () => {
    setup(draft, { dimensions: [] });
    expect(screen.getAllByText(copy.score.unknownDimension)).toHaveLength(2);
    expect(screen.queryByText('prof')).toBeNull();
  });

  it('多人：按人分组，各自打分；一个人没有任何分数时写资料不足而不是 0', () => {
    const lopsided: RecordBatchDraft = {
      ...twoPeopleDraft,
      scores: twoPeopleDraft.scores.filter((s) => s.personId !== 'p2'),
    };
    setup(lopsided);
    const first = screen.getByRole('group', { name: '演示甲' });
    const second = screen.getByRole('group', { name: '演示乙' });
    expect(within(first).getByRole('radiogroup')).toBeTruthy();
    expect(within(second).getByText(copy.score.groupEmpty)).toBeTruthy();
    expect(within(second).queryByRole('radio')).toBeNull();
  });

  it('多人：每个人各有自己的分，不把一个人的分复制给另一个人', () => {
    setup(twoPeopleDraft);
    const second = screen.getByRole('group', { name: '演示乙' });
    const dots = within(second).getAllByRole('radio');
    expect(dots.filter((d) => d.classList.contains('is-on'))).toHaveLength(4);
    const first = screen.getByRole('group', { name: '演示甲' });
    expect(
      within(first)
        .getAllByRole('radio')
        .filter((d) => d.classList.contains('is-on')),
    ).toHaveLength(3);
  });

  it('不认识的人显示为「已选人员」', () => {
    setup(twoPeopleDraft, { people: [people[0]!] });
    expect(
      screen.getByRole('group', { name: copy.header.unknownPerson }),
    ).toBeTruthy();
  });

  it('点击和预览带上人与维度', async () => {
    const { onPick, onPreview } = setup(draft);
    await userEvent.click(screen.getByRole('radio', { name: '4 分' }));
    expect(onPick).toHaveBeenCalledWith(scoreKey('p1', 'prof'), 4);
    await userEvent.hover(screen.getByRole('radio', { name: '2 分' }));
    expect(onPreview).toHaveBeenLastCalledWith({
      personId: 'p1',
      dimensionId: 'prof',
      hit: 2,
    });
  });

  it('改分后的理由和保存后的只读状态', () => {
    const edit = initEdit(draft);
    edit.scores[scoreKey('p1', 'prof')] = {
      value: 5,
      touched: true,
      reason: '带着大家做',
    };
    setup(draft, { edit, saved: true });
    const why = screen.getByLabelText('专业度改分理由') as HTMLInputElement;
    expect(why.readOnly).toBe(true);
    expect(screen.getByText('+2')).toBeTruthy();
  });

  it('服务端指出的行内问题显示在对应行', () => {
    setup(draft, {
      problems: {
        scores: { [scoreKey('p1', 'prof')]: copy.sbi.fieldProblem },
        general: false,
      },
    });
    expect(screen.getByRole('alert').textContent).toBe(copy.sbi.fieldProblem);
  });
});
