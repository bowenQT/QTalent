// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ToastProvider } from '@/components/ui/Toast';
import type { SelectionRevision } from '@/contracts/selection-standard';
import { ShellTitleProvider } from '@/features/shell/ShellTitle';
import {
  sampleAiChanges,
  sampleAttribution,
  sampleBatch,
  sampleHr,
  sampleHrPage,
  sampleHypotheses,
  sampleManagerPage,
  samplePreview,
  sampleRaterPage,
  sampleStandard,
} from '@/app/dev/standard-iteration/samples';
import { managerView } from '@/app/dev/standard-iteration/sample-store';
import { Attribution } from './attribution/Attribution';
import { JudgeBatch } from './judge/JudgeBatch';
import { JudgeManager } from './judge/JudgeManager';
import { JudgeRater } from './judge/JudgeRater';
import { actionFailure, lost } from './ports';
import { ManagerRevision } from './revision/ManagerRevision';
import { HrRevision } from './revision/HrRevision';
import { ReviewPointsEditor } from './revision/ReviewPointsEditor';
import { SelectionRevisionPage } from './revision/SelectionStandard';
import type { ReviewPoint } from './revision/revision-view';

vi.mock('motion/react', async () => {
  const original =
    await vi.importActual<typeof import('motion/react')>('motion/react');
  return { ...original, useReducedMotion: () => true };
});
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wrap = (node: React.ReactNode) =>
  render(
    <ShellTitleProvider>
      <ToastProvider>{node}</ToastProvider>
    </ShellTitleProvider>,
  );
const conflict = { status: 'conflict' as const, message: '状态已更新' };
const lostText =
  '连接中断，结果待核实：刷新页面查看最新状态，或保持内容再点一次重发';
const network = new Error('network');
const fail = <T,>(value: T) => vi.fn(async () => value as never);

const draft: SelectionRevision = {
  id: 'rev-1',
  category: 'xe_selection',
  versionId: 'xe-select-v2',
  baseVersionId: 'xe-select-v1',
  revision: 1,
  contentRevision: 1,
  reason: '写清本人部分',
  effect: 'next_selection_cohort',
  basis: sampleAttribution,
  aiDraft: null,
  humanVersion: null,
  impactPreview: samplePreview(1, '2026-09-04T02:00:00Z'),
  state: 'draft',
  lastReturn: null,
};
const pending: SelectionRevision = {
  ...draft,
  revision: 3,
  humanVersion: {
    origin: 'hr_edited',
    changes: sampleAiChanges,
    editedBy: sampleHr,
    editedAt: '2026-09-04T02:00:00Z',
  },
  state: 'pending_confirmation',
  submittedBy: sampleHr,
  submittedAt: '2026-09-04T02:00:00Z',
};

describe('actionFailure', () => {
  it('phrases every failed status for the person who acted', () => {
    expect(actionFailure({ status: 'validation_error' })).toBe(
      '内容待补全，按提示修改后再试',
    );
    expect(actionFailure(conflict)).toMatch(/^状态已被更新/);
    expect(actionFailure({ status: 'forbidden', message: '' })).toMatch(
      /由有权限的人处理/,
    );
    expect(actionFailure({ status: 'not_found', message: '' })).toMatch(
      /已删除或链接有误/,
    );
    expect(actionFailure({ status: 'model_failed', message: '' })).toBe(
      'AI 整理失败，稍后再试',
    );
    expect(actionFailure(lost)).toBe(lostText);
  });
});

describe('ReviewPointsEditor', () => {
  function Harness({ editable = true }: { editable?: boolean }) {
    const [points, setPoints] = useState<ReviewPoint[]>(
      sampleStandard.reviewPoints,
    );
    return (
      <ReviewPointsEditor
        base={sampleStandard.reviewPoints}
        working={points}
        editable={editable}
        onChange={setPoints}
        newId={() => 'point-new'}
      />
    );
  }

  it('edits, deletes, adds and restores points against the base version', async () => {
    const user = userEvent.setup();
    const view = render(<Harness />);
    const list = () => view.container.querySelectorAll('li');

    await user.click(screen.getByRole('button', { name: '改要点 2' }));
    const description = screen.getByLabelText('要点说明');
    await user.clear(description);
    expect(
      (screen.getByRole('button', { name: '保存' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await user.type(description, '看开发过程，写清本人部分');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(list()[1].className).toBe('is-changed');
    expect(list()[1].querySelector('ins')?.textContent).toBe('，写清本人部分');

    await user.click(screen.getByRole('button', { name: '改要点 1' }));
    fireEvent.keyDown(screen.getByLabelText('要点说明'), { key: 'Escape' });
    expect(screen.queryByLabelText('要点说明')).toBeNull();
    await user.click(screen.getByRole('button', { name: '改要点 1' }));
    await user.click(screen.getByRole('button', { name: '取消' }));

    await user.click(screen.getByRole('button', { name: '删除要点 3' }));
    expect(list()[2].querySelector('del')?.textContent).toMatch(/^演示与表达/);
    expect(list()[2].querySelector('b')?.textContent).toBe('—');

    await user.click(screen.getByRole('button', { name: '添加要点' }));
    await user.type(screen.getByLabelText('要点名称'), '个人贡献核验');
    await user.type(screen.getByLabelText('要点说明'), '每位成员说明本人部分');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(list()[4].querySelector('ins')?.textContent).toBe(
      '个人贡献核验：每位成员说明本人部分',
    );

    // A removed base point returns to its place; an edit returns to its base text.
    await user.click(
      screen.getByRole('button', { name: '还原要点「演示与表达」' }),
    );
    expect(list()[2].className).toBe('');
    await user.click(
      screen.getByRole('button', { name: '还原要点「开发过程与质量」' }),
    );
    expect(list()[1].className).toBe('');
    await user.click(screen.getByRole('button', { name: '删除要点 5' }));
    expect(list()).toHaveLength(4);
  });

  it('shows no controls when the draft is not editable', () => {
    render(<Harness editable={false} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Attribution failures', () => {
  const ports = {
    generate: vi.fn(),
    confirm: vi.fn(),
    createRevision: vi.fn(),
  };
  it('keeps the form and reuses the operation id when confirming fails', async () => {
    const user = userEvent.setup();
    ports.confirm.mockResolvedValue(conflict);
    wrap(
      <Attribution
        batchId={sampleBatch.id}
        baseVersionId="xe-select-v1"
        cases={sampleHrPage.cases}
        initialHypotheses={{ status: 'ready', items: sampleHypotheses }}
        initialAttributions={[]}
        ports={ports}
        onCase={vi.fn()}
        onDrafted={vi.fn()}
      />,
    );
    const block = document.querySelector(
      '[data-hyp="hyp-xe6-1"]',
    ) as HTMLElement;
    await user.click(within(block).getByRole('button', { name: '采纳并归因' }));
    await user.type(within(block).getByRole('textbox'), '只看成品');
    await user.click(within(block).getByRole('button', { name: '确认归因' }));
    expect(
      await screen.findByText('状态已被更新，刷新页面后按当前状态处理'),
    ).toBeTruthy();
    await user.click(within(block).getByRole('button', { name: '确认归因' }));
    await waitFor(() => expect(ports.confirm).toHaveBeenCalledTimes(2));
    const [first, second] = ports.confirm.mock.calls.map(([input]) => input);
    expect(second.operationId).toBe(first.operationId);
    expect(first).toMatchObject({
      categories: ['evaluation_standard'],
      rationale: '只看成品',
    });
  });

  it('leaves loading when AI 整理 is lost, and resends the same request', async () => {
    const user = userEvent.setup();
    ports.generate.mockReset();
    ports.generate
      .mockRejectedValueOnce(network)
      .mockResolvedValueOnce({ status: 'success', result: sampleHypotheses });
    wrap(
      <Attribution
        batchId={sampleBatch.id}
        baseVersionId="xe-select-v1"
        cases={sampleHrPage.cases}
        initialHypotheses={{ status: 'idle' }}
        initialAttributions={[]}
        ports={ports}
        onCase={vi.fn()}
        onDrafted={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: '整理 AI 假设' }));
    expect(await screen.findByText(lostText)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '重新整理' }));
    expect(
      await screen.findAllByRole('button', { name: '采纳并归因' }),
    ).not.toHaveLength(0);
    const [first, second] = ports.generate.mock.calls.map(([input]) => input);
    expect(second).toEqual(first);
  });

  it('resends the same confirmation after a lost answer, focusing the reason first', async () => {
    const user = userEvent.setup();
    ports.confirm.mockReset();
    ports.confirm
      .mockRejectedValueOnce(network)
      .mockResolvedValueOnce(conflict);
    wrap(
      <Attribution
        batchId={sampleBatch.id}
        baseVersionId="xe-select-v1"
        cases={sampleHrPage.cases}
        initialHypotheses={{ status: 'ready', items: sampleHypotheses }}
        initialAttributions={[]}
        ports={ports}
        onCase={vi.fn()}
        onDrafted={vi.fn()}
      />,
    );
    const block = document.querySelector(
      '[data-hyp="hyp-xe6-1"]',
    ) as HTMLElement;
    await user.click(within(block).getByRole('button', { name: '采纳并归因' }));
    expect(document.activeElement).toBe(within(block).getByRole('textbox'));
    await user.keyboard('只看成品');
    await user.click(within(block).getByRole('button', { name: '确认归因' }));
    expect(await screen.findByText(lostText)).toBeTruthy();
    const confirm = within(block).getByRole('button', { name: '确认归因' });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    await user.click(confirm);
    await waitFor(() => expect(ports.confirm).toHaveBeenCalledTimes(2));
    const [first, second] = ports.confirm.mock.calls.map(([input]) => input);
    expect(second).toEqual(first);
  });

  it('says the batch has no hypothesis yet when AI returns none', async () => {
    const user = userEvent.setup();
    ports.generate.mockResolvedValue({
      status: 'success',
      replayed: false,
      result: [],
    });
    wrap(
      <Attribution
        batchId={sampleBatch.id}
        baseVersionId="xe-select-v1"
        cases={sampleHrPage.cases}
        initialHypotheses={{ status: 'idle' }}
        initialAttributions={[]}
        ports={ports}
        onCase={vi.fn()}
        onDrafted={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: '整理 AI 假设' }));
    expect(
      await screen.findByText('AI 已看完这批案例，假设待更多案例后再整理。'),
    ).toBeTruthy();
  });

  it('marks a citation outside the viewer’s cases as hidden', () => {
    wrap(
      <Attribution
        batchId={sampleBatch.id}
        baseVersionId="xe-select-v1"
        cases={[]}
        initialHypotheses={{ status: 'ready', items: [sampleHypotheses[2]] }}
        initialAttributions={[]}
        ports={ports}
        onCase={vi.fn()}
        onDrafted={vi.fn()}
      />,
    );
    const chips = screen.getAllByRole('button', { name: '案例已隐藏' });
    expect(chips).toHaveLength(3);
    expect((chips[0] as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('HrRevision failures', () => {
  it('reports a failed save and submit without moving the draft', async () => {
    const user = userEvent.setup();
    const ports = {
      save: fail({ status: 'validation_error', issues: [] }),
      submit: fail(conflict),
      withdraw: fail({ status: 'forbidden', message: '' }),
    };
    wrap(
      <HrRevision
        initial={{ ...draft, aiDraft: null }}
        base={sampleStandard.reviewPoints}
        ports={ports}
        judgeHref="/judge"
      />,
    );
    // Nothing changed yet: saving asks for one change first.
    expect(screen.getByText('先在左边改，再保存并预览影响。')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '删除要点 4' }));
    expect(
      screen.getByText('草稿改过之后，保存一次，按当前草稿预览影响再提交。'),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '保存并预览影响' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      '内容待补全，按提示修改后再试',
    );
    expect(
      screen.getByText(/改了 1 处/, { selector: '.nt-caption' }),
    ).toBeTruthy();
  });

  it('reports a failed submit and withdraw', async () => {
    const user = userEvent.setup();
    const saved: SelectionRevision = {
      ...draft,
      humanVersion: pending.humanVersion,
    };
    const ports = {
      save: vi.fn(),
      submit: fail(conflict),
      withdraw: fail({ status: 'forbidden', message: '' }),
    };
    wrap(
      <HrRevision
        initial={saved}
        base={sampleStandard.reviewPoints}
        ports={ports}
        judgeHref="/judge"
      />,
    );
    await user.click(screen.getByRole('button', { name: '提交管理者确认' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /^状态已被更新/,
    );
    cleanup();
    wrap(
      <HrRevision
        initial={pending}
        base={sampleStandard.reviewPoints}
        ports={ports}
        judgeHref="/judge"
      />,
    );
    expect(screen.getByText(/已提交给管理者 · 09-04/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '撤回到草稿' }));
    expect(
      await screen.findByText('这一步由有权限的人处理，刷新页面查看当前权限'),
    ).toBeTruthy();
  });

  it('keeps the submit when the undo cannot withdraw it', async () => {
    const user = userEvent.setup();
    const ports = {
      save: vi.fn(),
      submit: vi.fn(async () => ({
        status: 'success' as const,
        replayed: false,
        result: pending,
      })),
      withdraw: fail(conflict),
    };
    wrap(
      <HrRevision
        initial={{ ...draft, humanVersion: pending.humanVersion }}
        base={sampleStandard.reviewPoints}
        ports={ports}
        judgeHref="/judge"
      />,
    );
    await user.click(screen.getByRole('button', { name: '提交管理者确认' }));
    await user.click(await screen.findByRole('button', { name: '撤销' }));
    expect(
      await screen.findByText(
        '撤回结果待核实：点「重试」按原请求再发一次，或刷新页面查看 xe-select-v2 的当前状态',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: '撤回到草稿' })).toBeTruthy();
  });
});

describe('HrRevision lost answers', () => {
  const saved: SelectionRevision = {
    ...draft,
    humanVersion: pending.humanVersion,
  };

  it('frees the form after a lost save and resends the same command', async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockRejectedValueOnce(network).mockResolvedValueOnce({
      status: 'success',
      replayed: true,
      result: saved,
    });
    wrap(
      <HrRevision
        initial={{ ...draft, aiDraft: null }}
        base={sampleStandard.reviewPoints}
        ports={{ save, submit: vi.fn(), withdraw: vi.fn() }}
        judgeHref="/judge"
      />,
    );
    await user.click(screen.getByRole('button', { name: '删除要点 4' }));
    await user.click(screen.getByRole('button', { name: '保存并预览影响' }));
    expect((await screen.findByRole('alert')).textContent).toBe(lostText);
    const again = screen.getByRole('button', { name: '保存并预览影响' });
    expect((again as HTMLButtonElement).disabled).toBe(false);
    await user.click(again);
    expect(
      await screen.findByText('已保存草稿，影响预览已按当前草稿计算'),
    ).toBeTruthy();
    const [first, second] = save.mock.calls.map(([input]) => input);
    expect(second).toEqual(first);
  });

  it('replays the same withdraw when the undo answer is lost', async () => {
    const user = userEvent.setup();
    const withdraw = vi
      .fn()
      .mockRejectedValueOnce(network)
      .mockResolvedValueOnce({
        status: 'success',
        replayed: true,
        result: saved,
      });
    wrap(
      <HrRevision
        initial={saved}
        base={sampleStandard.reviewPoints}
        ports={{
          save: vi.fn(),
          submit: vi.fn(async () => ({
            status: 'success' as const,
            replayed: false,
            result: pending,
          })),
          withdraw,
        }}
        judgeHref="/judge"
      />,
    );
    await user.click(screen.getByRole('button', { name: '提交管理者确认' }));
    await user.click(await screen.findByRole('button', { name: '撤销' }));
    await user.click(await screen.findByRole('button', { name: '重试' }));
    expect(
      await screen.findByText('已撤回，xe-select-v2 回到草稿'),
    ).toBeTruthy();
    const [first, second] = withdraw.mock.calls.map(([input]) => input);
    expect(second).toEqual(first);
  });
});

describe('ManagerRevision failures', () => {
  const view = managerView(pending);
  const receipt = {
    publicationId: 'pub-4',
    publishedBy: { id: 'p-chengyuan', name: '程远' },
    publishedAt: '2026-09-05T02:00:00Z',
    undoUntil: '2026-09-05T02:00:05Z',
    versionId: 'xe-select-v2',
    previousVersionId: 'xe-select-v1',
    revision: 4,
    previewId: view.impactPreview.id,
    nextCohort: { id: 'pg-xe7', name: 'XEngineer 第七期' },
  };
  const published = {
    status: 'success' as const,
    replayed: false,
    result: receipt,
  };

  it('reports a failed publish and a failed return', async () => {
    const user = userEvent.setup();
    const ports = {
      read: vi.fn(),
      publish: fail(conflict),
      undo: vi.fn(),
      return: fail({ status: 'not_found', message: '' }),
    };
    wrap(
      <ManagerRevision
        initial={view}
        base={sampleStandard.reviewPoints}
        ports={ports}
        onSeal={vi.fn()}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: '确认发布 xe-select-v2' }),
    );
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: '确认发布 xe-select-v2',
      }),
    );
    expect(
      await screen.findByText('状态已被更新，刷新页面后按当前状态处理'),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '退回修改' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('退回理由'), '再写清');
    await user.click(within(dialog).getByRole('button', { name: '退回修改' }));
    expect(await screen.findByText(/已删除或链接有误/)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: '确认发布 xe-select-v2' }),
    ).toBeTruthy();
  });

  it('keeps the publication when the undo is refused', async () => {
    const user = userEvent.setup();
    const onSeal = vi.fn();
    const ports = {
      read: vi.fn(),
      publish: vi.fn(async () => published),
      undo: fail(conflict),
      return: vi.fn(),
    };
    wrap(
      <ManagerRevision
        initial={view}
        base={sampleStandard.reviewPoints}
        ports={ports}
        onSeal={onSeal}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: '确认发布 xe-select-v2' }),
    );
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: '确认发布 xe-select-v2',
      }),
    );
    await user.click(await screen.findByRole('button', { name: '撤销' }));
    expect(
      await screen.findByText(
        '撤销结果待核实：点「重试」按原请求再发一次，或刷新页面查看当前发布状态',
      ),
    ).toBeTruthy();
    expect(onSeal).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/xe-select-v2 已发布/)).toBeTruthy();
  });

  it('asks for a reload when the undone revision cannot be read back', async () => {
    const user = userEvent.setup();
    const ports = {
      read: fail({ status: 'not_found', message: '' }),
      publish: vi.fn(async () => published),
      undo: vi.fn(async () => ({
        status: 'success' as const,
        replayed: false,
        result: {
          publicationId: 'pub-4',
          restoredVersionId: 'xe-select-v1',
          withdrawnVersionId: 'xe-select-v2',
          restoredDefaultForNewCohorts: 'xe-select-v1',
          preservedBindings: view.impactPreview.preservedBindings,
        },
      })),
      return: vi.fn(),
    };
    wrap(
      <ManagerRevision
        initial={view}
        base={sampleStandard.reviewPoints}
        ports={ports}
        onSeal={vi.fn()}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: '确认发布 xe-select-v2' }),
    );
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: '确认发布 xe-select-v2',
      }),
    );
    await user.click(await screen.findByRole('button', { name: '撤销' }));
    expect(
      await screen.findByText('状态已更新，刷新页面后按当前状态处理。'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: '刷新' })).toBeTruthy();
  });

  it('replays the same undo after a lost answer; a lost read-back asks for a reload', async () => {
    const user = userEvent.setup();
    const onSeal = vi.fn();
    const undo = vi
      .fn()
      .mockRejectedValueOnce(network)
      .mockResolvedValueOnce({
        status: 'success',
        replayed: true,
        result: {
          publicationId: 'pub-4',
          restoredVersionId: 'xe-select-v1',
          withdrawnVersionId: 'xe-select-v2',
          restoredDefaultForNewCohorts: 'xe-select-v1',
          preservedBindings: view.impactPreview.preservedBindings,
        },
      });
    wrap(
      <ManagerRevision
        initial={view}
        base={sampleStandard.reviewPoints}
        ports={{
          read: vi.fn().mockRejectedValue(network),
          publish: vi.fn(async () => published),
          undo,
          return: vi.fn(),
        }}
        onSeal={onSeal}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: '确认发布 xe-select-v2' }),
    );
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: '确认发布 xe-select-v2',
      }),
    );
    await user.click(await screen.findByRole('button', { name: '撤销' }));
    await user.click(await screen.findByRole('button', { name: '重试' }));
    expect(
      await screen.findByText('状态已更新，刷新页面后按当前状态处理。'),
    ).toBeTruthy();
    expect(onSeal.mock.calls).toEqual([[true], [false]]);
    const [first, second] = undo.mock.calls.map(([input]) => input);
    expect(second).toEqual(first);
  });

  it('keeps the publish dialog after a lost answer and resends the same command', async () => {
    const user = userEvent.setup();
    const publish = vi
      .fn()
      .mockRejectedValueOnce(network)
      .mockResolvedValueOnce(published);
    wrap(
      <ManagerRevision
        initial={view}
        base={sampleStandard.reviewPoints}
        ports={{ read: vi.fn(), publish, undo: vi.fn(), return: vi.fn() }}
        onSeal={vi.fn()}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: '确认发布 xe-select-v2' }),
    );
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', {
      name: '确认发布 xe-select-v2',
    });
    await user.click(confirm);
    expect(await screen.findByText(lostText)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBe(dialog);
    await user.click(confirm);
    expect(await screen.findByText(/xe-select-v2 已发布/)).toBeTruthy();
    const [first, second] = publish.mock.calls.map(([input]) => input);
    expect(second).toEqual(first);
  });

  it('shows a draft the manager cannot act on as read-only changes', () => {
    wrap(
      <SelectionRevisionPage
        view={{
          audience: 'manager',
          revision: managerView(draft),
          ports: {
            read: vi.fn(),
            publish: vi.fn(),
            undo: vi.fn(),
            return: vi.fn(),
          },
        }}
        base={sampleStandard}
        back={{ href: '/work', label: '回到工作台' }}
      />,
    );
    expect(screen.getByText('草稿 xe-select-v2')).toBeTruthy();
    expect(screen.getByText('HR 编辑后，改动会出现在这里。')).toBeTruthy();
    cleanup();
    wrap(
      <SelectionRevisionPage
        view={{
          audience: 'manager',
          revision: managerView({
            ...pending,
            state: 'draft',
            lastReturn: null,
          }),
          ports: {
            read: vi.fn(),
            publish: vi.fn(),
            undo: vi.fn(),
            return: vi.fn(),
          },
        }}
        base={sampleStandard}
        back={{ href: '/work', label: '回到工作台' }}
      />,
    );
    expect(screen.getByText('2 处')).toBeTruthy();
    expect(screen.getByText('新增要点')).toBeTruthy();
  });
});

describe('judge summaries', () => {
  it('lists manager batches waiting for attribution, or an empty state', () => {
    wrap(<JudgeManager page={sampleManagerPage([])} />);
    expect(screen.getByText('归因待确认')).toBeTruthy();
    expect(screen.queryByText('已归因')).toBeNull();
    cleanup();
    wrap(<JudgeManager page={{ ...sampleManagerPage([]), batches: [] }} />);
    expect(
      screen.getByRole('heading', { name: '判断对照会出现在这里' }),
    ).toBeTruthy();
  });

  it('gives a rater with no comparable judgment an empty state, not zero', () => {
    const page = sampleRaterPage('gu');
    wrap(
      <JudgeRater
        self
        raterName="谷牧野"
        cases={[]}
        sample={page.sample}
        mapping={null}
        back={{ href: '/work', label: '回到工作台' }}
      />,
    );
    expect(
      screen.getByRole('heading', {
        name: '你作为评价人给出的判断会出现在这里',
      }),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/0 个/);
    cleanup();
    wrap(
      <JudgeRater
        self={false}
        raterName="谷牧野"
        cases={[]}
        sample={page.sample}
        mapping={null}
        back={{ href: '/judge', label: '回到判断对照' }}
      />,
    );
    expect(
      screen.getByRole('heading', { name: '这位评价人的判断会出现在这里' }),
    ).toBeTruthy();
  });

  it('names a batch by its cohort when the caller has no batch name', () => {
    const page = sampleRaterPage('xu');
    wrap(
      <JudgeRater
        self
        raterName="许致远"
        cases={page.cases}
        sample={page.sample}
        mapping={null}
        back={{ href: '/work', label: '回到工作台' }}
      />,
    );
    expect(
      screen.getByRole('heading', { name: /^XEngineer 第六期xe-select/ }),
    ).toBeTruthy();
  });
});

describe('dialogs close without acting', () => {
  it('cancels publish and return, and refuses an empty return reason', async () => {
    const user = userEvent.setup();
    const ports = {
      read: vi.fn(),
      publish: vi.fn(),
      undo: vi.fn(),
      return: vi.fn(),
    };
    wrap(
      <ManagerRevision
        initial={managerView(pending)}
        base={sampleStandard.reviewPoints}
        ports={ports}
        onSeal={vi.fn()}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: '确认发布 xe-select-v2' }),
    );
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: '取消',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: '退回修改' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '退回修改' }));
    expect(within(dialog).getByText('写一句退回理由')).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(ports.publish).not.toHaveBeenCalled();
    expect(ports.return).not.toHaveBeenCalled();
  });

  it('cancels a revision draft from an attribution', async () => {
    const user = userEvent.setup();
    const ports = {
      generate: vi.fn(),
      confirm: vi.fn(),
      createRevision: vi.fn(),
    };
    wrap(
      <Attribution
        batchId={sampleBatch.id}
        baseVersionId="xe-select-v1"
        cases={sampleHrPage.cases}
        initialHypotheses={{ status: 'idle' }}
        initialAttributions={[sampleAttribution]}
        ports={ports}
        onCase={vi.fn()}
        onDrafted={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: '起草修订' }));
    const dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByRole('textbox'));
    await user.click(within(dialog).getByRole('button', { name: '起草修订' }));
    expect(within(dialog).getByText('写一句修订理由')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: '起草修订' }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(ports.createRevision).not.toHaveBeenCalled();
  });

  it('keeps the revision dialog after a lost answer and resends the same command', async () => {
    const user = userEvent.setup();
    const onDrafted = vi.fn();
    const createRevision = vi
      .fn()
      .mockRejectedValueOnce(network)
      .mockResolvedValueOnce({
        status: 'success',
        replayed: true,
        result: { ...draft, id: 'draft-9' },
      });
    wrap(
      <Attribution
        batchId={sampleBatch.id}
        baseVersionId="xe-select-v1"
        cases={sampleHrPage.cases}
        initialHypotheses={{ status: 'idle' }}
        initialAttributions={[sampleAttribution]}
        ports={{ generate: vi.fn(), confirm: vi.fn(), createRevision }}
        onCase={vi.fn()}
        onDrafted={onDrafted}
      />,
    );
    await user.click(screen.getByRole('button', { name: '起草修订' }));
    const dialog = await screen.findByRole('dialog');
    const go = within(dialog).getByRole('button', { name: '起草修订' });
    await user.click(go);
    expect(await screen.findByText(lostText)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBe(dialog);
    await user.click(go);
    await waitFor(() => expect(onDrafted).toHaveBeenCalledWith('draft-9'));
    const [first, second] = createRevision.mock.calls.map(([input]) => input);
    expect(second).toEqual(first);
  });

  it('keeps the return dialog and its reason after a lost answer', async () => {
    const user = userEvent.setup();
    const sendBack = vi
      .fn()
      .mockRejectedValueOnce(network)
      .mockResolvedValueOnce({
        status: 'success',
        replayed: false,
        result: managerView(draft),
      });
    wrap(
      <ManagerRevision
        initial={managerView(pending)}
        base={sampleStandard.reviewPoints}
        ports={{
          read: vi.fn(),
          publish: vi.fn(),
          undo: vi.fn(),
          return: sendBack,
        }}
        onSeal={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: '退回修改' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('退回理由'), '再写清');
    const go = within(dialog).getByRole('button', { name: '退回修改' });
    await user.click(go);
    expect(await screen.findByText(lostText)).toBeTruthy();
    expect(
      (within(dialog).getByLabelText('退回理由') as HTMLTextAreaElement).value,
    ).toBe('再写清');
    await user.click(go);
    await waitFor(() => expect(sendBack).toHaveBeenCalledTimes(2));
    expect((await screen.findAllByText(/已退回给/)).length).toBeGreaterThan(0);
    const [first, second] = sendBack.mock.calls.map(([input]) => input);
    expect(second).toEqual(first);
  });
});

describe('JudgeBatch', () => {
  const ports = {
    generate: vi.fn(),
    confirm: vi.fn(),
    createRevision: vi.fn(),
  };
  it('opens a row from the link and scrolls smoothly unless motion is reduced', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    wrap(
      <JudgeBatch
        page={sampleHrPage}
        standard={null}
        currentStandardVersionId="xe-select-v1"
        initialHypotheses={{ status: 'ready', items: sampleHypotheses }}
        initialAttributions={[]}
        ports={ports}
        raterHref={(id) => `/judge?rater=${id}`}
        onDrafted={vi.fn()}
        initialOpen="overall"
      />,
    );
    expect(screen.getAllByTestId('judge-case').length).toBeGreaterThan(0);
    fireEvent.click(
      within(
        document.querySelector('[data-hyp="hyp-xe6-1"]') as HTMLElement,
      ).getAllByRole('button', { name: /综合判断$/ })[0],
    );
    await waitFor(() =>
      expect(scroll).toHaveBeenCalledWith({
        block: 'center',
        behavior: 'smooth',
      }),
    );
  });

  it('renders an empty batch without a scope line or invented counts', () => {
    wrap(
      <JudgeBatch
        page={{ ...sampleHrPage, cases: [] }}
        standard={sampleStandard}
        currentStandardVersionId="xe-select-v1"
        initialHypotheses={{ status: 'idle' }}
        initialAttributions={[]}
        ports={ports}
        raterHref={(id) => `/judge?rater=${id}`}
        onDrafted={vi.fn()}
      />,
    );
    expect(screen.queryByText(/人进入对照/)).toBeNull();
    expect(screen.getByText(/作品完整度与创新性：/)).toBeTruthy();
    expect(screen.queryAllByTestId('judge-case')).toHaveLength(0);
  });
});
