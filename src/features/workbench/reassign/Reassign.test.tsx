// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { ToastProvider } from '@/components/ui/Toast';
import { ShellTitleProvider } from '@/features/shell/ShellTitle';
import { Reassign } from './Reassign';
import {
  candidatesFor,
  changedReason,
  groupItems,
  itemLabel,
  type ReassignItem,
  type ReassignResult,
} from './reassign-model';

const { action, refresh } = vi.hoisted(() => ({
  action: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/server/actions/evaluation-reassignment', () => ({
  reassignEvaluationWorkAction: action,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => {
  vi.clearAllMocks();
  let n = 0;
  vi.stubGlobal('crypto', { randomUUID: () => `op-${++n}` });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const candidate = (
  evaluatorId: string,
  displayName: string,
  kind: ReassignItem['candidates'][number]['kind'] = 'mentor',
) => ({ relationId: `rel-${evaluatorId}`, evaluatorId, displayName, kind });
const item = (
  id: string,
  person: string,
  overrides: Partial<ReassignItem> = {},
): ReassignItem => ({
  workItemId: id,
  revision: 2,
  kind: 'confirmation',
  resourceId: `res-${id}`,
  state: 'pending',
  node: { id: 'node-1', name: '演示期次', kind: 'program_cohort' },
  person: { id: `p-${id}`, name: person },
  previousEvaluator: { id: 'old', displayName: '演示原导师' },
  candidates: [
    candidate('new', '演示新导师'),
    candidate('hr', '演示 HR', 'evaluator'),
  ],
  ...overrides,
});
const items = [
  item('w-1', '演示甲'),
  item('w-2', '演示乙', { kind: 'speaker', state: 'processing' }),
  item('w-3', '演示丙', {
    kind: 'unknown_interviewer',
    candidates: [candidate('hr', '演示 HR', 'evaluator')],
  }),
];
const success = (id: string): ReassignResult => ({
  status: 'success',
  replayed: false,
  receipt: {
    workItemId: id,
    evaluationNodeId: 'node-1',
    personId: 'p',
    kind: 'confirmation',
    resourceId: 'r',
    previousRelationId: 'rel-old',
    previousEvaluatorId: 'old',
    assignedRelationId: 'rel-new',
    assignedEvaluatorId: 'new',
    revision: 3,
    reassignedBy: 'hr-account',
    reassignedAt: '2026-09-04T07:00:00.000Z',
  },
});

function setup(list = items) {
  return render(
    <ShellTitleProvider>
      <ToastProvider>
        <Reassign items={list} />
      </ToastProvider>
    </ShellTitleProvider>,
  );
}
const choice = (name: string) =>
  screen.getByRole('radio', { name: new RegExp(name) });
const go = () => document.querySelector<HTMLButtonElement>('#ra-go')!;
const uncheck = (name: string) =>
  fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(name) }));
async function confirm(label: string) {
  fireEvent.click(go());
  const dialog = screen.getByRole('dialog');
  await act(async () =>
    fireEvent.click(within(dialog).getByRole('button', { name: label })),
  );
}

describe('reassign model', () => {
  it('labels each kind and groups per previous evaluator and node', () => {
    expect(items.map(itemLabel)).toEqual([
      '确认建议分',
      '核对说话人 · 处理中',
      '核对未知面试官',
    ]);
    const other = item('w-9', '演示戊', {
      previousEvaluator: { id: 'gone', displayName: null },
    });
    expect(
      groupItems([...items, other]).map((group) => [
        group.evaluator.name,
        group.items.length,
      ]),
    ).toEqual([
      ['演示原导师', 3],
      ['原评价人', 1],
    ]);
  });

  it('offers everyone eligible for a picked item and counts how many each can take', () => {
    expect(candidatesFor(items)).toEqual([
      {
        evaluatorId: 'new',
        displayName: '演示新导师',
        label: '导师',
        eligible: 2,
      },
      {
        evaluatorId: 'hr',
        displayName: '演示 HR',
        label: '评价人',
        eligible: 3,
      },
    ]);
    expect(changedReason('forbidden')).toBe('已移出你的分派范围');
    expect(changedReason('not_found')).toBe('这件事已移出列表');
    expect(changedReason('validation_error')).toBe('提交内容待刷新');
    expect(changedReason('conflict')).toBe('分派状态已更新');
  });
});

describe('Reassign page', () => {
  it('lists the items per previous evaluator, all picked', () => {
    setup();
    const card = screen.getByText('演示原导师').closest('article')!;
    expect(card.textContent).toContain('演示原导师 · 演示期次评价关系已结束');
    expect(
      within(card)
        .getAllByRole('checkbox')
        .map((box) => (box as HTMLInputElement).checked),
    ).toEqual([true, true, true]);
    expect(go().textContent).toBe('选接手人 · 3 件');
    expect(go().disabled).toBe(true);
  });

  it('only lets HR pick someone who can take every picked item', () => {
    setup();
    expect(choice('演示新导师').hasAttribute('disabled')).toBe(true);
    expect(choice('演示新导师').textContent).toContain(
      '可接手其中 2 件，先取消勾选其余的',
    );
    uncheck('演示丙');
    expect(choice('演示新导师').hasAttribute('disabled')).toBe(false);
    fireEvent.click(choice('演示新导师'));
    expect(choice('演示新导师').getAttribute('aria-checked')).toBe('true');
    expect(go().textContent).toBe('交给演示新导师 · 2 件');
    // Picking 演示丙 again makes the choice invalid: the button asks again.
    uncheck('演示丙');
    expect(go().textContent).toBe('选接手人 · 3 件');
  });

  it('hands the picked items over, one request each, then refreshes', async () => {
    action.mockImplementation(async (input: { workItemId: string }) =>
      success(input.workItemId),
    );
    setup();
    fireEvent.click(choice('演示 HR'));
    await confirm('交给演示 HR');
    expect(action.mock.calls.map(([input]) => input)).toEqual([
      {
        operationId: 'op-1',
        workItemId: 'w-1',
        expectedRevision: 2,
        targetRelationId: 'rel-hr',
      },
      {
        operationId: 'op-2',
        workItemId: 'w-2',
        expectedRevision: 2,
        targetRelationId: 'rel-hr',
      },
      {
        operationId: 'op-3',
        workItemId: 'w-3',
        expectedRevision: 2,
        targetRelationId: 'rel-hr',
      },
    ]);
    expect(screen.getByText('已交给演示 HR 3 件')).toBeTruthy();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('reports items that changed meanwhile and focuses the notice', async () => {
    action
      .mockResolvedValueOnce({
        status: 'conflict',
        message: '事项版本或分派状态已变化，请刷新后重试',
        input: {},
      })
      .mockResolvedValueOnce({ status: 'forbidden', message: '无权' });
    setup(items.slice(0, 2));
    fireEvent.click(choice('演示新导师'));
    await confirm('交给演示新导师');
    const notice = screen.getByRole('alert');
    expect(notice.textContent).toContain('2 件已有变化，以最新状态为准');
    expect(
      within(notice)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual([
      '演示甲 · 确认建议分：分派状态已更新',
      '演示乙 · 核对说话人 · 处理中：已移出你的分派范围',
    ]);
    expect(document.activeElement?.textContent).toBe('知道了');
    expect(refresh).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '知道了' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps an unanswered request and replays it with the same operation id', async () => {
    action
      .mockResolvedValueOnce(success('w-1'))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(success('w-2'));
    setup(items.slice(0, 2));
    fireEvent.click(choice('演示新导师'));
    await confirm('交给演示新导师');
    const failed = screen.getByRole('alert');
    expect(failed.textContent).toContain('提交中断：1 件待重新提交。');
    expect(screen.getByText('已交给演示新导师 1 件')).toBeTruthy();
    await act(async () =>
      fireEvent.click(within(failed).getByRole('button', { name: '重试' })),
    );
    expect(action.mock.calls[2][0]).toEqual(action.mock.calls[1][0]);
    expect(action.mock.calls[2][0]).toMatchObject({ operationId: 'op-2' });
    expect(screen.queryByRole('alert')).toBeNull();
    // Two toasts now, one per answered request.
    expect(screen.getAllByText('已交给演示新导师 1 件')).toHaveLength(2);
  });

  it('keeps an earlier unanswered request when another batch goes through', async () => {
    action
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(success('w-2'))
      .mockResolvedValueOnce(success('w-1'));
    setup(items.slice(0, 2));
    // A alone gets no answer.
    uncheck('演示乙');
    fireEvent.click(choice('演示新导师'));
    await confirm('交给演示新导师');
    expect(screen.getByRole('alert').textContent).toContain(
      '提交中断：1 件待重新提交。',
    );
    // Then B alone goes through.
    uncheck('演示甲');
    uncheck('演示乙');
    fireEvent.click(choice('演示新导师'));
    await confirm('交给演示新导师');
    expect(action.mock.calls[1][0]).toMatchObject({ workItemId: 'w-2' });
    expect(screen.getByText('已交给演示新导师 1 件')).toBeTruthy();
    // A is still waiting, and its retry replays the first request exactly.
    const failed = screen.getByRole('alert');
    expect(failed.textContent).toContain('提交中断：1 件待重新提交。');
    await act(async () =>
      fireEvent.click(within(failed).getByRole('button', { name: '重试' })),
    );
    expect(action.mock.calls[2][0]).toEqual(action.mock.calls[0][0]);
    expect(action.mock.calls[2][0]).toMatchObject({
      operationId: 'op-1',
      workItemId: 'w-1',
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says the list is done when nothing waits, with a way back', () => {
    setup([]);
    expect(screen.getByText('需要重新分派的事都处理完了')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: '回到工作台' }).getAttribute('href'),
    ).toBe('/work');
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });
});
