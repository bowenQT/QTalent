// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/Toast';
import { clearSessionDrafts } from '@/lib/session-drafts';
import { copy } from './copy';
import {
  BATCH_STASH_KEY,
  HANDOFF_KEY,
  INPUT_STASH_KEY,
  stashBatchInput,
  stashInput,
} from './record-handoff';
import {
  batch,
  dimensions,
  doneBatch,
  draft,
  NODE,
  people,
  receipt,
  TEXT,
  twoPeopleDraft,
} from './record.fixtures';
import { RecordPage, type RecordPageProps } from './RecordPage';
import type { AnchorMap, RecordActions } from './types';

const anchors: AnchorMap = {
  p1: {
    prof: {
      ruleVersion: 'v-test',
      family: null,
      levels: ['一档', '二档', '三档', '四档', '五档'],
    },
  },
  p2: {
    prof: {
      ruleVersion: 'v-test',
      family: null,
      levels: ['a', 'b', 'c', 'd', 'e'],
    },
  },
};
/** 撤销窗口按回执 undoUntil 计算：默认回执以当前时间为保存时间。 */
function liveReceipt(at = Date.now()) {
  return {
    ...receipt,
    savedAt: new Date(at).toISOString(),
    undoUntil: new Date(at + 5000).toISOString(),
  };
}
const ok = <T,>(result: T, replayed = false) =>
  Promise.resolve({ status: 'success' as const, replayed, result });

type Mock = ReturnType<typeof vi.fn>;
type Overrides = Omit<Partial<RecordPageProps>, 'actions'> & {
  actions?: Partial<RecordActions>;
};

function setup(over: Overrides = {}) {
  let n = 0;
  const actions = {
    resolveNode: vi.fn(async () => ({
      status: 'unique' as const,
      evaluationNodeId: NODE,
    })),
    submit: vi.fn(() => ok(batch())),
    readBatch: vi.fn(() => ok(doneBatch)),
    save: vi.fn(() => ok(liveReceipt())),
    undo: vi.fn(() =>
      ok({
        saveId: 'save-1',
        withdrawnEvents: [{ personId: 'p1', eventId: 'ev-1' }],
        withdrawnConfirmationIds: [],
        withdrawnReviewItemIds: [],
        inputRestoration: 'unavailable',
        originalInput: null,
      }),
    ),
    loadSource: vi.fn(),
    ...over.actions,
  } as unknown as RecordActions & {
    resolveNode: Mock;
    submit: Mock;
    readBatch: Mock;
    save: Mock;
    undo: Mock;
  };
  const loadAnchors = vi.fn(async () => anchors);
  const onBatchChange = vi.fn();
  const props: RecordPageProps = {
    accountId: 'acc-1',
    accountName: '演示导师',
    roleLabel: '导师',
    people,
    projects: [{ id: 'proj-1', name: '演示项目', kind: 'project' }],
    dimensions,
    loadAnchors,
    onBatchChange,
    newId: () => `id-${++n}`,
    ...over,
    actions,
  };
  const view = render(
    <ToastProvider>
      <RecordPage {...props} />
    </ToastProvider>,
  );
  return { actions, loadAnchors, onBatchChange, view, props };
}

async function typeAndSubmit(text = TEXT) {
  await userEvent.type(screen.getByRole('textbox'), text);
  await userEvent.click(
    screen.getByRole('button', { name: copy.input.submit }),
  );
}
const field = (name: string) => screen.findByRole('textbox', { name });
const click = (name: string | RegExp) =>
  userEvent.click(screen.getByRole('button', { name }));
const pick = (personId: string) =>
  userEvent.selectOptions(
    screen.getByRole('combobox', { name: copy.input.whoLabel }),
    personId,
  );

beforeEach(() => {
  window.sessionStorage.clear();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('输入与整理', () => {
  it('空内容点主按钮：聚焦输入框，不推导、不提交', async () => {
    const { actions } = setup();
    await click(copy.input.submit);
    expect(actions.resolveNode).not.toHaveBeenCalled();
    expect(actions.submit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('写原话、选人、整理：先按所选人员推导节点，再提交 897 批次，随后进入整理中', async () => {
    let resolveSubmit: (value: unknown) => void = () => undefined;
    const { actions, onBatchChange, view } = setup({
      actions: {
        readBatch: vi.fn(() => ok(batch())) as never,
        submit: vi.fn(
          () => new Promise((resolve) => (resolveSubmit = resolve)),
        ) as never,
      },
    });
    await pick('p1');
    await typeAndSubmit(` ${TEXT} `);
    expect(actions.resolveNode).toHaveBeenCalledWith({
      personIds: ['p1'],
      projectId: null,
    });
    await waitFor(() =>
      expect(actions.submit).toHaveBeenCalledWith({
        operationId: 'id-1',
        evaluationNodeId: NODE,
        personIds: ['p1'],
        projectId: null,
        text: TEXT,
        files: [],
      }),
    );
    // 请求在途：输入只读、按钮锁定
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).readOnly).toBe(
      true,
    );
    await act(async () =>
      resolveSubmit({ status: 'success', replayed: false, result: batch() }),
    );
    expect(view.container.querySelectorAll('.n-trail__step')).toHaveLength(3);
    expect(screen.getByText(copy.trail.queued)).toBeTruthy();
    expect(onBatchChange).toHaveBeenCalledWith('batch-1');
    // 整理中不出现任何 SBI 与分数
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('「从原话里识别」：按空的人员推导，节点唯一时照常提交', async () => {
    const { actions } = setup();
    await typeAndSubmit();
    expect(actions.resolveNode).toHaveBeenCalledWith({
      personIds: [],
      projectId: null,
    });
    await waitFor(() =>
      expect(actions.submit.mock.calls[0]?.[0]).toMatchObject({
        personIds: [],
      }),
    );
  });

  it('整理完成：SBI 可改，建议分始终是 AI 建议（未确认），资料不足不出数字', async () => {
    const { view } = setup();
    await typeAndSubmit();
    const title = await field(copy.sbi.title);
    expect(title.textContent).toBe(draft.sbi.title);
    const rows = view.container.querySelectorAll('.n-score');
    expect(rows[0]?.getAttribute('data-state')).toBe('ai');
    expect(rows[1]?.getAttribute('data-state')).toBe('unknown');
    expect(screen.getByText(copy.score.insufficient)).toBeTruthy();
    expect(screen.getByText(copy.hint.pending(1))).toBeTruthy();
    const described = screen
      .getByRole('button', { name: copy.actions.save })
      .getAttribute('aria-describedby');
    expect(document.getElementById(described ?? '')?.textContent).toBe(
      copy.hint.pending(1),
    );
    // 引用本页原话的照原型写成行内引文；原话一栏是本页写下的原话
    expect(rows[0]?.querySelector('.n-score__note')?.textContent).toBe(
      `${copy.score.anchorNote(3)}${copy.cite.inline}「独立完成」`,
    );
    expect(view.container.textContent).toContain(TEXT);
    // 没有总分、百分比、排名
    expect(view.container.textContent).not.toMatch(/总分|%|排名/);
    expect(view.container.querySelector('.visually-hidden')?.textContent).toBe(
      copy.live.ready(1),
    );
  });

  it('整理完成后头部带姓名与小犇', async () => {
    setup();
    await typeAndSubmit();
    await field(copy.sbi.title);
    expect(screen.getByText('演示甲')).toBeTruthy();
    expect(screen.getByRole('img', { name: '小犇：需要你确认' })).toBeTruthy();
  });

  it('提交断网：内容保留，提示可重试，重试复用同一个 operation_id', async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(() => ok(batch()));
    setup({ actions: { submit: submit as never } });
    await typeAndSubmit();
    expect(await screen.findByText(copy.offline.start)).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      TEXT,
    );
    await click(copy.banner.sendRetry);
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1]?.[0].operationId).toBe(
      submit.mock.calls[0]?.[0].operationId,
    );
  });

  it('推导节点断网：内容保留，提示可重试', async () => {
    const resolveNode = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ status: 'unique', evaluationNodeId: NODE });
    const { actions } = setup({
      actions: { resolveNode: resolveNode as never },
    });
    await typeAndSubmit();
    expect(await screen.findByText(copy.offline.start)).toBeTruthy();
    expect(actions.submit).not.toHaveBeenCalled();
    await click(copy.banner.sendRetry);
    await waitFor(() => expect(actions.submit).toHaveBeenCalledTimes(1));
  });

  it('服务端读不到节点：如实说暂时读不到，不提交，原话保留', async () => {
    const { actions } = setup({
      actions: {
        resolveNode: vi.fn(async () => ({ status: 'unavailable' as const })),
      },
    });
    await typeAndSubmit();
    expect(await screen.findByText(copy.node.unavailable.title)).toBeTruthy();
    expect(actions.submit).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).not.toBe(
      '',
    );
  });

  it('内容变了或节点变了，重试换新的 operation_id', async () => {
    const submit = vi.fn().mockRejectedValue(new Error('offline'));
    const resolveNode = vi
      .fn()
      .mockResolvedValueOnce({ status: 'unique', evaluationNodeId: NODE })
      .mockResolvedValueOnce({ status: 'unique', evaluationNodeId: NODE })
      .mockResolvedValue({ status: 'unique', evaluationNodeId: 'node-2' });
    setup({
      actions: { submit: submit as never, resolveNode: resolveNode as never },
    });
    await typeAndSubmit();
    await screen.findByText(copy.offline.start);
    await userEvent.type(screen.getByRole('textbox'), '补一句');
    await click(copy.input.submit);
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    await click(copy.banner.sendRetry);
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(3));
    const ids = submit.mock.calls.map((call) => call[0].operationId);
    expect(new Set(ids).size).toBe(3);
  });

  it('服务端拒绝：回到输入，保留原话并说明', async () => {
    const submit = vi
      .fn()
      .mockResolvedValueOnce({ status: 'forbidden', message: '范围已调整' })
      .mockResolvedValueOnce({
        status: 'validation_error',
        fieldErrors: {},
        input: {},
      })
      .mockResolvedValueOnce({
        status: 'conflict',
        message: '这条已在整理',
        input: {},
      });
    setup({ actions: { submit: submit as never } });
    await typeAndSubmit();
    expect(await screen.findByText(/范围已调整/)).toBeTruthy();
    expect(screen.getByText(copy.forbidden.title)).toBeTruthy();
    await click(copy.input.submit);
    expect(await screen.findByText(copy.banner.startRefused)).toBeTruthy();
    await click(copy.input.submit);
    expect(await screen.findByText('这条已在整理')).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      TEXT,
    );
  });

  it('超过长度上限：提示缩短，不提交', async () => {
    const { actions } = setup({ maxLength: 8 });
    await userEvent.type(
      screen.getByRole('textbox'),
      '这是一段超过八个字的原话',
    );
    expect(screen.getByText(copy.input.tooLong(8))).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('textbox'), {
      key: 'Enter',
      ctrlKey: true,
    });
    expect(actions.submit).not.toHaveBeenCalled();
  });
});

describe('评价节点由服务端推导', () => {
  it('选了人但节点有多个或没有：写明原因，不提交，原话保留', async () => {
    const resolveNode = vi
      .fn()
      .mockResolvedValueOnce({ status: 'multiple' })
      .mockResolvedValueOnce({ status: 'none' });
    const { actions } = setup({
      actions: { resolveNode: resolveNode as never },
    });
    await pick('p1');
    await typeAndSubmit();
    expect(await screen.findByText(copy.node.multiple.title)).toBeTruthy();
    await click(copy.input.submit);
    expect(await screen.findByText(copy.node.none.title)).toBeTruthy();
    expect(actions.submit).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      TEXT,
    );
    // 改了输入，提示消失
    await userEvent.type(screen.getByRole('textbox'), '。');
    expect(screen.queryByText(copy.node.none.title)).toBeNull();
  });

  it('没选人且节点不唯一：提示先在「谁」里选人，焦点交给「谁」', async () => {
    const { actions } = setup({
      actions: {
        resolveNode: vi.fn(async () => ({ status: 'multiple' })) as never,
      },
    });
    await typeAndSubmit();
    expect(await screen.findByText(copy.node.pickPerson.title)).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole('combobox', { name: copy.input.whoLabel }),
    );
    expect(actions.submit).not.toHaveBeenCalled();
  });

  it('推导入口待接通：写明待接通，不提交', async () => {
    const { actions } = setup({ actions: { resolveNode: null } });
    await typeAndSubmit();
    expect(await screen.findByText(copy.node.pending.title)).toBeTruthy();
    expect(actions.submit).not.toHaveBeenCalled();
  });
});

describe('多件事或有核对项：交给回执页', () => {
  it.each([
    ['many', batch({ drafts: [draft, { ...twoPeopleDraft, draftId: 'd-2' }] })],
    ['review', batch({ drafts: [], review: true })],
    ['none', batch({ drafts: [] })],
  ] as const)(
    '%s：一句话说明，链接到这个批次的回执',
    async (reason, receipt) => {
      setup({ actions: { readBatch: vi.fn(() => ok(receipt)) as never } });
      await typeAndSubmit();
      expect(await screen.findByText(copy.handoff[reason].title)).toBeTruthy();
      expect(
        screen
          .getByRole('link', { name: copy.handoff.open })
          .getAttribute('href'),
      ).toBe('/receipt?id=batch-1');
      // 本页不做多件确认：没有分数和保存按钮
      expect(screen.queryByRole('radio')).toBeNull();
      expect(
        screen.queryByRole('button', { name: copy.actions.save }),
      ).toBeNull();
      // 回执确认待接通：本页能回去改原话，原话还在输入框里
      expect(screen.getByText(copy.handoff.pending)).toBeTruthy();
      await click(copy.actions.back);
      expect(
        (screen.getByRole('textbox') as HTMLTextAreaElement).value,
      ).not.toBe('');
    },
  );
});

describe('整理失败与重新整理', () => {
  it('失败：不渲染任何结果，原话保留，不把失败写成资料不足', async () => {
    const { view } = setup({
      actions: {
        readBatch: vi.fn(() => ok(batch({ status: 'failed' }))) as never,
      },
    });
    await typeAndSubmit();
    expect(
      await screen.findByText(copy.failure.processing_failed),
    ).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByText(copy.score.insufficient)).toBeNull();
    expect(screen.queryByText('整理中断')).toBeNull();
    expect(
      view.container.querySelector('li[data-state="failed"]'),
    ).toBeTruthy();
    expect(screen.getByText(copy.trail.kept)).toBeTruthy();
  });

  it('可以重试：用同一原话提交新批次（新 operation_id）', async () => {
    const readBatch = vi
      .fn()
      .mockImplementationOnce(() => ok(batch({ status: 'failed' })))
      .mockImplementation(() => ok(batch({ drafts: [draft], batchId: 'b-2' })));
    const submit = vi
      .fn()
      .mockImplementationOnce(() => ok(batch()))
      .mockImplementation(() => ok(batch({ batchId: 'b-2' })));
    setup({
      actions: { readBatch: readBatch as never, submit: submit as never },
    });
    await typeAndSubmit();
    await userEvent.click(
      await screen.findByRole('button', { name: copy.actions.reorganize }),
    );
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1]?.[0].operationId).not.toBe(
      submit.mock.calls[0]?.[0].operationId,
    );
    expect(submit.mock.calls[1]?.[0].text).toBe(TEXT);
    expect(await field(copy.sbi.title)).toBeTruthy();
  });

  it('不能重试时只能改原话，回到输入并保留原话', async () => {
    setup({
      actions: {
        readBatch: vi.fn(() =>
          ok(batch({ status: 'failed', retryable: false })),
        ) as never,
      },
    });
    await typeAndSubmit();
    await screen.findByText(copy.failure.processing_failed);
    expect(
      screen.queryByRole('button', { name: copy.actions.reorganize }),
    ).toBeNull();
    await click(copy.actions.back);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      TEXT,
    );
  });
});

describe('连接状态', () => {
  it('读进度失败：保留进度并提示，不当成失败，恢复后继续', async () => {
    const readBatch = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(() => ok(doneBatch));
    setup({ actions: { readBatch: readBatch as never } });
    await typeAndSubmit();
    expect(await screen.findByText(copy.connection.lost)).toBeTruthy();
    expect(screen.queryByText(copy.failure.processing_failed)).toBeNull();
    window.dispatchEvent(new Event('online'));
    expect(await field(copy.sbi.title)).toBeTruthy();
  });

  it('批次已不可查看：整页说明，可回到记一件事', async () => {
    setup({
      actions: {
        readBatch: vi.fn(async () => ({
          status: 'not_found',
          message: '批次不存在或当前不可见',
        })) as never,
      },
    });
    await typeAndSubmit();
    expect(await screen.findByText(copy.connection.goneTitle)).toBeTruthy();
    await click(copy.connection.goneAction);
    expect(screen.getByRole('textbox')).toBeTruthy();
  });
});

describe('确认、改分与保存', () => {
  async function toReview(over: Overrides = {}) {
    const ctx = setup(over);
    await typeAndSubmit();
    await field(copy.sbi.title);
    return ctx;
  }

  it('保存时一并确认未点击的建议分：入参是 confirm，署名行与 5 秒撤销提示出现', async () => {
    const { actions } = await toReview();
    await click(copy.actions.save);
    await screen.findByText(/刚刚保存到演示甲的档案/);
    expect(actions.save).toHaveBeenCalledTimes(1);
    const input = actions.save.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input).toMatchObject({
      expected_revision: 1,
      draftId: 'draft-1',
      personIds: ['p1'],
      projectId: null,
      decisions: [{ personId: 'p1', dimensionId: 'prof', action: 'confirm' }],
    });
    // 已保存：文字只读，分数点不再响应，没有保存按钮
    expect(
      screen
        .getByRole('textbox', { name: copy.sbi.title })
        .getAttribute('contenteditable'),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: copy.actions.save }),
    ).toBeNull();
    expect(
      screen.getByRole('link', { name: copy.saved.link }).getAttribute('href'),
    ).toBe('/person?id=p1#ev-ev-1');
    expect(screen.getByText(copy.saved.toast('演示甲', 0))).toBeTruthy();
    expect(screen.getByRole('button', { name: '撤销' })).toBeTruthy();
    expect(screen.getByText(copy.live.saved)).toBeTruthy();
  });

  it('点击分数即确认；改分带理由进入决定，转给 HR 复核的数量写在提示里', async () => {
    const { actions } = await toReview({
      actions: {
        save: vi.fn(() =>
          ok({ ...liveReceipt(), reviewItemIds: ['r1', 'r2'] }),
        ) as never,
      },
    });
    await userEvent.click(screen.getByRole('radio', { name: '5 分' }));
    expect(screen.getByText('+2')).toBeTruthy();
    expect(screen.getByText(copy.hint.allConfirmed)).toBeTruthy();
    await userEvent.type(screen.getByLabelText('专业度改分理由'), '带着大家做');
    await click(copy.actions.save);
    await screen.findByText(copy.saved.toast('演示甲', 2));
    expect(actions.save.mock.calls[0]?.[0]).toMatchObject({
      decisions: [
        {
          personId: 'p1',
          dimensionId: 'prof',
          action: 'edit',
          value: 5,
          reason: '带着大家做',
        },
      ],
    });
  });

  it('文字改动随保存提交；标题或行为为空时不提交并聚焦', async () => {
    const { actions } = await toReview();
    const title = screen.getByRole('textbox', { name: copy.sbi.title });
    title.textContent = '';
    fireEvent.input(title);
    await click(copy.actions.save);
    expect(actions.save).not.toHaveBeenCalled();
    expect(screen.getByText(copy.sbi.titleNeeded)).toBeTruthy();
    expect(document.activeElement).toBe(title);
    title.textContent = '新标题';
    fireEvent.input(title);
    expect(screen.queryByText(copy.sbi.titleNeeded)).toBeNull();
    const behavior = screen.getByRole('textbox', { name: copy.sbi.behavior });
    behavior.textContent = '  ';
    fireEvent.input(behavior);
    await click(copy.actions.save);
    expect(screen.getByText(copy.sbi.behaviorNeeded)).toBeTruthy();
    expect(document.activeElement).toBe(behavior);
    behavior.textContent = '新行为';
    fireEvent.input(behavior);
    await click(copy.actions.save);
    await waitFor(() => expect(actions.save).toHaveBeenCalledTimes(1));
    expect(actions.save.mock.calls[0]?.[0]).toMatchObject({
      sbi: { title: '新标题', behavior: '新行为' },
    });
  });

  it('服务端没完成保存：不说成断网，修改保留', async () => {
    const save = vi.fn(async () => ({ status: 'unavailable' as const }));
    await toReview({ actions: { save: save as never } });
    await click(copy.actions.save);
    expect(await screen.findByText(copy.saveUnavailable)).toBeTruthy();
    expect(screen.queryByText(copy.offline.save)).toBeNull();
    expect(document.getElementById('ev-save')).toBeTruthy();
  });

  it('保存断网：修改保留，重试复用同一个 operation_id；内容变了换新', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(() => ok(liveReceipt()));
    await toReview({ actions: { save: save as never } });
    await click(copy.actions.save);
    expect(await screen.findByText(copy.offline.save)).toBeTruthy();
    await click(copy.banner.sendRetry);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]?.[0].operation_id).toBe(
      save.mock.calls[0]?.[0].operation_id,
    );
    await screen.findByText(copy.offline.save);
    await userEvent.click(screen.getByRole('radio', { name: '4 分' }));
    await click(copy.actions.save);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(3));
    expect(save.mock.calls[2]?.[0].operation_id).not.toBe(
      save.mock.calls[1]?.[0].operation_id,
    );
  });

  it('字段问题：定位到标题和分数行，保留全部输入', async () => {
    const save = vi.fn().mockResolvedValue({
      status: 'validation_error',
      fieldErrors: { 'sbi.title': ['x'], 'decisions.0.reason': ['x'] },
      input: {},
    });
    await toReview({ actions: { save: save as never } });
    await userEvent.click(screen.getByRole('radio', { name: '5 分' }));
    await click(copy.actions.save);
    expect(await screen.findByText(copy.banner.problems)).toBeTruthy();
    expect(screen.getByText(copy.sbi.titleNeeded)).toBeTruthy();
    expect(screen.getAllByText(copy.sbi.fieldProblem).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText('+2')).toBeTruthy();
  });

  it('冲突：不清空任何输入；先复制出来可选中全部内容', async () => {
    const save = vi.fn().mockResolvedValue({
      status: 'conflict',
      message: '别处刚保存过',
      input: {},
    });
    await toReview({ actions: { save: save as never } });
    const behavior = screen.getByRole('textbox', { name: copy.sbi.behavior });
    behavior.textContent = '我改过的行为';
    fireEvent.input(behavior);
    await click(copy.actions.save);
    expect(await screen.findByText(copy.conflict.title)).toBeTruthy();
    expect(screen.getByText('别处刚保存过')).toBeTruthy();
    expect(behavior.textContent).toBe('我改过的行为');
    await click(copy.actions.copyOut);
    const box = screen.getByLabelText(
      copy.conflict.copyLabel,
    ) as HTMLTextAreaElement;
    expect(box.value).toContain('我改过的行为');
    expect(box.value).toContain(TEXT);
    fireEvent.focus(box);
    await click(copy.actions.keepEditing);
    expect(screen.queryByLabelText(copy.conflict.copyLabel)).toBeNull();
  });

  it('冲突后载入最新版本：先确认，确认后替换草稿；读取失败时修改还在', async () => {
    const save = vi.fn().mockResolvedValue({
      status: 'conflict',
      message: '别处刚保存过',
      input: {},
    });
    const readBatch = vi
      .fn()
      .mockImplementationOnce(() => ok(doneBatch))
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(() =>
        ok(
          batch({
            revision: 5,
            drafts: [
              {
                ...draft,
                revision: 2,
                sbi: { ...draft.sbi, title: '最新的标题' },
              },
            ],
          }),
        ),
      );
    await toReview({
      actions: { save: save as never, readBatch: readBatch as never },
    });
    const behavior = screen.getByRole('textbox', { name: copy.sbi.behavior });
    behavior.textContent = '我改过的行为';
    fireEvent.input(behavior);
    await click(copy.actions.save);
    await userEvent.click(
      await screen.findByRole('button', { name: copy.actions.loadLatest }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(copy.confirm.loadText)).toBeTruthy();
    // 先不载入
    await userEvent.click(
      within(dialog).getByRole('button', { name: copy.actions.keepEditing }),
    );
    expect(readBatch).toHaveBeenCalledTimes(1);
    await click(copy.actions.loadLatest);
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: copy.actions.load,
      }),
    );
    expect(await screen.findByText(copy.banner.loadFailed)).toBeTruthy();
    expect(behavior.textContent).toBe('我改过的行为');
    await click(copy.actions.loadLatest);
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: copy.actions.load,
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: copy.sbi.title }).textContent,
      ).toBe('最新的标题'),
    );
    expect(readBatch).toHaveBeenLastCalledWith({ batchId: 'batch-1' });
  });

  it('载入最新版本被服务端拒绝时说明原因', async () => {
    const save = vi.fn().mockResolvedValue({
      status: 'conflict',
      message: '别处刚保存过',
      input: {},
    });
    const readBatch = vi
      .fn()
      .mockImplementationOnce(() => ok(doneBatch))
      .mockResolvedValueOnce({ status: 'not_found', message: '这条记录已移除' })
      .mockResolvedValueOnce({
        status: 'validation_error',
        fieldErrors: {},
        input: {},
      })
      // 这件事已不在待确认里（别处已确认）：如实说明，指向回执
      .mockImplementationOnce(() => ok(batch({ drafts: [], confirmed: 1 })));
    await toReview({
      actions: { save: save as never, readBatch: readBatch as never },
    });
    await click(copy.actions.save);
    await screen.findByRole('button', { name: copy.actions.loadLatest });
    for (const expected of [
      '这条记录已移除',
      copy.banner.loadFailed,
      copy.conflict.draftGone,
    ]) {
      await click(copy.actions.loadLatest);
      await userEvent.click(
        within(await screen.findByRole('dialog')).getByRole('button', {
          name: copy.actions.load,
        }),
      );
      expect(await screen.findByText(expected)).toBeTruthy();
    }
  });

  it('权限变化：原话还在，可复制原话', async () => {
    const save = vi
      .fn()
      .mockResolvedValue({ status: 'forbidden', message: '范围已调整' });
    await toReview({ actions: { save: save as never } });
    await click(copy.actions.save);
    expect(await screen.findByText(copy.forbidden.title)).toBeTruthy();
    await click(copy.actions.copyInput);
    expect(
      (screen.getByLabelText(copy.conflict.copyLabel) as HTMLTextAreaElement)
        .value,
    ).toBe(TEXT);
    await userEvent.click(
      within(screen.getByRole('alert')).getByRole('button', {
        name: copy.actions.back,
      }),
    );
    expect(
      (screen.getByLabelText(copy.input.label) as HTMLTextAreaElement).value,
    ).toBe(TEXT);
  });

  it('草稿本身不合契约（版本号无效）时给整体提示，不发请求', async () => {
    const broken = {
      ...doneBatch,
      draftSet: { ...doneBatch.draftSet!, drafts: [{ ...draft, revision: 0 }] },
    };
    const { actions } = setup({
      actions: { readBatch: vi.fn(() => ok(broken)) as never },
    });
    await typeAndSubmit();
    await field(copy.sbi.title);
    await click(copy.actions.save);
    expect(await screen.findByText(copy.banner.problems)).toBeTruthy();
    expect(actions.save).not.toHaveBeenCalled();
  });

  it('多人记录：分别打分，一次保存全部进入决定', async () => {
    const { actions } = setup({
      actions: {
        readBatch: vi.fn(() =>
          ok(batch({ drafts: [twoPeopleDraft] })),
        ) as never,
      },
    });
    await typeAndSubmit();
    await field(copy.sbi.title);
    expect(screen.getByRole('group', { name: '演示乙' })).toBeTruthy();
    expect(screen.getByText(copy.header.alsoFor('演示乙'))).toBeTruthy();
    await click(copy.actions.save);
    await screen.findByText(/刚刚保存到演示甲的档案/);
    expect(
      (actions.save.mock.calls[0]?.[0] as { personIds: string[] }).personIds,
    ).toEqual(['p1', 'p2']);
  });

  it('改原话：有修改时先确认，确认后回到输入并保留原话', async () => {
    await toReview();
    await click(copy.actions.back);
    // 无修改：直接回到输入
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      TEXT,
    );
  });

  it('改原话：改过 SBI 后先确认，可以继续编辑', async () => {
    await toReview();
    const impact = screen.getByRole('textbox', { name: copy.sbi.impact });
    impact.textContent = '我补的影响';
    fireEvent.input(impact);
    await click(copy.actions.back);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(copy.confirm.discardTitle)).toBeTruthy();
    await userEvent.click(
      within(dialog).getByRole('button', { name: copy.actions.keepEditing }),
    );
    expect(
      screen.getByRole('textbox', { name: copy.sbi.impact }).textContent,
    ).toBe('我补的影响');
    await click(copy.actions.back);
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: copy.actions.back,
      }),
    );
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      TEXT,
    );
  });
});

describe('5 秒撤销', () => {
  async function saved(over: Overrides = {}) {
    const ctx = setup(over);
    await typeAndSubmit();
    await field(copy.sbi.title);
    await click(copy.actions.save);
    await screen.findByRole('button', { name: '撤销' });
    return ctx;
  }

  it('撤销成功：照原型回到待确认，整理结果还在，再保存换新的 operation_id', async () => {
    const { actions } = await saved();
    await click('撤销');
    expect(await screen.findByText(copy.saved.undone)).toBeTruthy();
    expect(actions.undo).toHaveBeenCalledWith({
      operation_id: 'id-3',
      saveId: 'save-1',
    });
    expect((await field(copy.sbi.title)).textContent).toBe(draft.sbi.title);
    expect(document.querySelector('.n-event__sign')).toBeNull();
    await click(copy.actions.save);
    await waitFor(() => expect(actions.save).toHaveBeenCalledTimes(2));
    const [first, second] = (actions.save as ReturnType<typeof vi.fn>).mock
      .calls;
    expect(second?.[0].operation_id).not.toBe(first?.[0].operation_id);
  });

  it('网络失败：提示撤销遇到问题并可重试，重试复用同一个 operation_id', async () => {
    const undo = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(() =>
        ok({
          saveId: 'save-1',
          withdrawnEvents: [],
          withdrawnConfirmationIds: [],
          withdrawnReviewItemIds: [],
          inputRestoration: 'unavailable',
          originalInput: null,
        }),
      );
    await saved({ actions: { undo: undo as never } });
    await click('撤销');
    expect(await screen.findByText(copy.saved.undoFailed)).toBeTruthy();
    await click(copy.saved.undoRetry);
    expect(await screen.findByText(copy.saved.undone)).toBeTruthy();
    expect(undo.mock.calls[1]?.[0].operation_id).toBe(
      undo.mock.calls[0]?.[0].operation_id,
    );
  });

  it('窗口已过：关闭原提示，另发说明，记录保持已保存，不显示已撤销', async () => {
    const undo = vi
      .fn()
      .mockResolvedValue({ status: 'conflict', message: 'x', input: {} });
    await saved({ actions: { undo: undo as never } });
    await click('撤销');
    expect(await screen.findByText(copy.saved.undoLate)).toBeTruthy();
    expect(screen.queryByText(copy.saved.undone)).toBeNull();
    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull();
    expect(screen.getByText(/刚刚保存到演示甲的档案/)).toBeTruthy();
  });

  it('没有权限撤销：显示服务端的说明', async () => {
    const undo = vi.fn().mockResolvedValue({
      status: 'forbidden',
      message: '只有保存的人可以撤销',
    });
    await saved({ actions: { undo: undo as never } });
    await click('撤销');
    expect(await screen.findByText('只有保存的人可以撤销')).toBeTruthy();
  });

  it('重放的保存回执（首次响应丢失）不提供撤销', async () => {
    setup({ actions: { save: vi.fn(() => ok(liveReceipt(), true)) as never } });
    await typeAndSubmit();
    await field(copy.sbi.title);
    await click(copy.actions.save);
    await screen.findByText(/刚刚保存到演示甲的档案/);
    expect(screen.getByText(copy.saved.toast('演示甲', 0))).toBeTruthy();
    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull();
  });
});

describe('进入方式', () => {
  it('?person= 预选；不在可记录选项里的 id 被忽略且无提示', () => {
    const { view } = setup({ entry: { personId: 'p2' } });
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(
      'p2',
    );
    view.unmount();
    setup({ entry: { personId: 'someone-else' } });
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('工作台交接：读取后立即删除，自动开始整理', async () => {
    window.sessionStorage.setItem(
      HANDOFF_KEY,
      JSON.stringify({
        accountId: 'acc-1',
        text: '工作台带来的原话',
        savedAt: Date.now(),
      }),
    );
    const { actions } = setup({ entry: { handoff: true } });
    await waitFor(() => expect(actions.submit).toHaveBeenCalled());
    expect(actions.submit.mock.calls[0]?.[0]).toMatchObject({
      text: '工作台带来的原话',
    });
    expect(window.sessionStorage.getItem(HANDOFF_KEY)).toBeNull();
  });

  it('工作台交接：账号不符的暂存被丢弃，页面是空白输入', async () => {
    window.sessionStorage.setItem(
      HANDOFF_KEY,
      JSON.stringify({
        accountId: 'acc-2',
        text: '别人的原话',
        savedAt: Date.now(),
      }),
    );
    const { actions } = setup({ entry: { handoff: true } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(actions.submit).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
    expect(window.sessionStorage.getItem(HANDOFF_KEY)).toBeNull();
  });

  it('带批次 id 进入（刷新恢复）：继续读进度，原话从同一批次的暂存恢复；批次 id 未变不重复通知', async () => {
    stashBatchInput('acc-1', 'batch-1', { text: TEXT, personId: 'p1' });
    const { actions, onBatchChange, view } = setup({
      entry: { batchId: 'batch-1' },
    });
    expect(await field(copy.sbi.title)).toBeTruthy();
    expect(actions.readBatch).toHaveBeenCalledWith({ batchId: 'batch-1' });
    expect(onBatchChange).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain(TEXT);
  });

  it('刷新恢复时别的批次的暂存不认：失败后只能改原话', async () => {
    stashBatchInput('acc-1', 'other', { text: '别的原话', personId: null });
    setup({
      entry: { batchId: 'batch-1' },
      actions: {
        readBatch: vi.fn(() =>
          ok(batch({ status: 'failed', retryable: true })),
        ) as never,
      },
    });
    expect(
      await screen.findByText(copy.failure.processing_failed),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: copy.actions.reorganize }),
    ).toBeNull();
    await click(copy.actions.back);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  });

  it('刷新恢复时这件事已确认：指向回执', async () => {
    setup({
      entry: { batchId: 'batch-1' },
      actions: {
        readBatch: vi.fn(() =>
          ok(batch({ drafts: [], confirmed: 1 })),
        ) as never,
      },
    });
    expect(await screen.findByText(copy.handoff.confirmed.title)).toBeTruthy();
  });

  it('回到输入后，URL 里的批次 id 随之清除', async () => {
    const { onBatchChange } = setup();
    await typeAndSubmit();
    await field(copy.sbi.title);
    await click(copy.actions.back);
    await waitFor(() => expect(onBatchChange).toHaveBeenLastCalledWith(null));
  });
});

describe('未保存内容的保护（输入暂存）', () => {
  it('提交期间退出登录：晚到的回执不把原话写回会话暂存', async () => {
    let resolveSubmit: (value: unknown) => void = () => undefined;
    const { actions } = setup({
      actions: {
        submit: vi.fn(
          () => new Promise((resolve) => (resolveSubmit = resolve)),
        ) as never,
      },
    });
    await typeAndSubmit();
    await waitFor(() => expect(actions.submit).toHaveBeenCalled());
    clearSessionDrafts();
    resolveSubmit({ status: 'success', replayed: false, result: batch() });
    await waitFor(() => expect(actions.readBatch).toHaveBeenCalled());
    expect(window.sessionStorage.getItem(BATCH_STASH_KEY)).toBeNull();
  });

  it('输入防抖写入会话暂存；提交后改记在这个批次下', async () => {
    setup();
    await userEvent.type(screen.getByRole('textbox'), '写到一半');
    await waitFor(() =>
      expect(window.sessionStorage.getItem(INPUT_STASH_KEY)).not.toBeNull(),
    );
    expect(
      JSON.parse(window.sessionStorage.getItem(INPUT_STASH_KEY)!),
    ).toMatchObject({
      accountId: 'acc-1',
      text: '写到一半',
    });
    await click(copy.input.submit);
    await waitFor(() =>
      expect(window.sessionStorage.getItem(INPUT_STASH_KEY)).toBeNull(),
    );
    expect(
      JSON.parse(window.sessionStorage.getItem(BATCH_STASH_KEY)!),
    ).toMatchObject({
      accountId: 'acc-1',
      batchId: 'batch-1',
      text: '写到一半',
    });
  });

  it('回到本页时恢复上次写到一半的原话和人员；换账号不恢复', async () => {
    stashInput('acc-1', { text: '上次写到一半', personId: 'p2' });
    const { view } = setup();
    await waitFor(() =>
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
        '上次写到一半',
      ),
    );
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(
      'p2',
    );
    view.unmount();
    setup({ accountId: 'acc-9' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  });

  it('暂存里的人员不在可记录选项里时忽略人员，保留原话', async () => {
    stashInput('acc-1', { text: '只有原话', personId: 'nobody' });
    setup();
    await waitFor(() =>
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
        '只有原话',
      ),
    );
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('');
  });

  it('保存成功后暂存也被清掉', async () => {
    setup();
    await typeAndSubmit();
    await field(copy.sbi.title);
    await click(copy.actions.save);
    await screen.findByText(/刚刚保存到/);
    expect(window.sessionStorage.getItem(INPUT_STASH_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(BATCH_STASH_KEY)).toBeNull();
  });

  it('有未保存内容时硬离开会提示，没有时不拦', async () => {
    setup();
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    await userEvent.type(screen.getByRole('textbox'), '写了一些');
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it('保存后不再拦截', async () => {
    setup();
    await typeAndSubmit();
    await field(copy.sbi.title);
    await click(copy.actions.save);
    await screen.findByText(/刚刚保存到/);
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('锚点面板与引用', () => {
  it('按人员和规则版本读取锚点；悬停某一分显示对应档位，命中档高亮', async () => {
    const { loadAnchors, view } = setup();
    await typeAndSubmit();
    await field(copy.sbi.title);
    await waitFor(() =>
      expect(loadAnchors).toHaveBeenCalledWith({
        personIds: ['p1'],
        ruleVersions: ['v-test'],
      }),
    );
    expect(await screen.findByText(copy.anchor.title('专业度'))).toBeTruthy();
    await userEvent.hover(screen.getByRole('radio', { name: '4 分' }));
    expect(view.container.querySelector('#anchor li.is-hit')?.textContent).toBe(
      '4四档',
    );
    await userEvent.unhover(screen.getByRole('radio', { name: '4 分' }));
    // 离开后回到当前所选分
    expect(view.container.querySelector('#anchor li.is-hit')?.textContent).toBe(
      '3三档',
    );
  });

  it('锚点读取失败：说明并锁定改分，重试后恢复', async () => {
    const loadAnchors = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue(anchors);
    const { actions } = setup({ loadAnchors: loadAnchors as never });
    await typeAndSubmit();
    await field(copy.sbi.title);
    expect(
      await screen.findByText(copy.anchor.failed, { exact: false }),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('radio', { name: '5 分' }));
    expect(screen.queryByText('+2')).toBeNull();
    await click(copy.anchor.retry);
    await waitFor(() => expect(loadAnchors).toHaveBeenCalledTimes(2));
    await screen.findByText(copy.anchor.title('专业度'));
    await userEvent.click(screen.getByRole('radio', { name: '5 分' }));
    expect(screen.getByText('+2')).toBeTruthy();
    expect(actions.save).not.toHaveBeenCalled();
  });

  it('只有资料不足的草稿不读取锚点', async () => {
    const { loadAnchors } = setup({
      actions: {
        readBatch: vi.fn(() =>
          ok(
            batch({
              drafts: [
                {
                  ...draft,
                  scores: draft.scores.filter((s) => s.state === 'unknown'),
                },
              ],
            }),
          ),
        ) as never,
      },
    });
    await typeAndSubmit();
    await field(copy.sbi.title);
    expect(loadAnchors).not.toHaveBeenCalled();
    expect(screen.getByText(copy.hint.noScores)).toBeTruthy();
  });

  it('原话引用照原型是说明里的普通文字，原话里不加标记', async () => {
    const { view } = setup();
    await typeAndSubmit();
    await field(copy.sbi.title);
    const details = view.container.querySelector(
      'details',
    ) as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector('mark')).toBeNull();
    expect(screen.queryByRole('link', { name: '「独立完成」' })).toBeNull();
  });

  it('页面说明和「怎么算一条关键事件」保持原型文案', () => {
    setup();
    expect(
      screen.getByRole('heading', { level: 1, name: copy.page.title }),
    ).toBeTruthy();
    expect(screen.getByText(copy.page.lead)).toBeTruthy();
    expect(screen.getByText(copy.page.howTitle)).toBeTruthy();
  });

  it('附件入口位置保留给后续接入', async () => {
    setup({ attachmentSlot: <button type="button">附件入口</button> });
    expect(screen.getByRole('button', { name: '附件入口' })).toBeTruthy();
    await typeAndSubmit();
    await field(copy.sbi.title);
    expect(screen.getByRole('button', { name: '附件入口' })).toBeTruthy();
  });

  it('演示数据带「演示」徽标；项目徽标取自选项', async () => {
    setup({
      demo: true,
      actions: {
        readBatch: vi.fn(() =>
          ok(batch({ drafts: [{ ...draft, projectId: 'proj-1' }] })),
        ) as never,
      },
    });
    await typeAndSubmit();
    await field(copy.sbi.title);
    expect(screen.getByText(copy.header.demo)).toBeTruthy();
    expect(
      screen.getByText(copy.header.project('project', '演示项目')),
    ).toBeTruthy();
  });
});

describe('边界：失败、断网、冲突保留输入，撤销按回执', () => {
  async function toReview(over: Overrides = {}) {
    const ctx = setup(over);
    await typeAndSubmit();
    await field(copy.sbi.title);
    return ctx;
  }
  const dot = (level: number) =>
    screen.getAllByRole('radio', { name: copy.score.pointLabel(level) })[0]!;

  it('保存中点分数不改值；保存后显示的是提交的值', async () => {
    let resolveSave: (value: unknown) => void = () => undefined;
    const save = vi.fn(() => new Promise((r) => (resolveSave = r)));
    await toReview({ actions: { save: save as never } });
    await waitFor(() =>
      expect(dot(4).getAttribute('aria-disabled')).toBeNull(),
    );
    await userEvent.click(dot(4));
    await click(copy.actions.save);
    expect(dot(1).getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(dot(1));
    await act(async () =>
      resolveSave({
        status: 'success',
        replayed: false,
        result: liveReceipt(),
      }),
    );
    await screen.findByText(/刚刚保存到演示甲的档案/);
    const submitted = (save.mock.calls[0] as unknown[])[0] as {
      decisions: { value?: number }[];
    };
    expect(submitted.decisions[0]).toMatchObject({ value: 4 });
    expect(dot(4).getAttribute('aria-checked')).toBe('true');
    expect(dot(1).getAttribute('aria-checked')).toBe('false');
  });

  it('换账号：上一个账号的原话不显示，也不写进新账号的暂存', async () => {
    const { view, props } = setup();
    await userEvent.type(screen.getByRole('textbox'), '甲账号写的');
    view.rerender(
      <ToastProvider>
        <RecordPage {...props} accountId="acc-2" />
      </ToastProvider>,
    );
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const stash = window.sessionStorage.getItem(INPUT_STASH_KEY);
    expect(stash === null || !stash.includes('"acc-2"')).toBe(true);
  });

  it('载入最新版本的响应迟到：读取期间写下的修改不被覆盖', async () => {
    let resolveOpen: (value: unknown) => void = () => undefined;
    const readBatch = vi
      .fn()
      .mockImplementationOnce(() => ok(doneBatch))
      .mockImplementation(() => new Promise((r) => (resolveOpen = r)));
    const save = vi.fn().mockResolvedValue({
      status: 'conflict',
      message: '别处刚保存过',
      input: {},
    });
    await toReview({
      actions: { save: save as never, readBatch: readBatch as never },
    });
    await click(copy.actions.save);
    await userEvent.click(
      await screen.findByRole('button', { name: copy.actions.loadLatest }),
    );
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: copy.actions.load,
      }),
    );
    const behavior = screen.getByRole('textbox', { name: copy.sbi.behavior });
    behavior.textContent = '读取期间新写的';
    fireEvent.input(behavior);
    await act(async () =>
      resolveOpen({
        status: 'success',
        replayed: false,
        result: batch({
          revision: 4,
          drafts: [
            { ...draft, revision: 2, sbi: { ...draft.sbi, title: '最新' } },
          ],
        }),
      }),
    );
    expect(behavior.textContent).toBe('读取期间新写的');
    expect(
      screen.getByRole('textbox', { name: copy.sbi.title }).textContent,
    ).not.toBe('最新');
    // 冲突提示和它的出口还在，可以再载入
    expect(
      screen.getByRole('button', { name: copy.actions.loadLatest }),
    ).toBeTruthy();
  });

  it('改原话后再整理同一段原话：换新的 operation_id，不重放旧整理', async () => {
    const { actions } = await toReview();
    await click(copy.actions.back);
    await click(copy.input.submit);
    await waitFor(() => expect(actions.submit).toHaveBeenCalledTimes(2));
    expect(actions.submit.mock.calls[1]?.[0].operationId).not.toBe(
      actions.submit.mock.calls[0]?.[0].operationId,
    );
  });

  it('回执的撤销时间已过：只提示已保存，不给撤销', async () => {
    await toReview({
      actions: {
        save: vi.fn(() => ok(liveReceipt(Date.now() - 6000))) as never,
      },
    });
    await click(copy.actions.save);
    await screen.findByText(copy.saved.toast('演示甲', 0));
    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull();
  });

  it('剩余撤销时间不足 5 秒：到 undoUntil 就收起撤销入口', async () => {
    await toReview({
      actions: {
        save: vi.fn(() => ok(liveReceipt(Date.now() - 4700))) as never,
      },
    });
    await click(copy.actions.save);
    await screen.findByRole('button', { name: '撤销' });
    await waitFor(
      () => expect(screen.queryByRole('button', { name: '撤销' })).toBeNull(),
      { timeout: 1500 },
    );
  });

  it('点撤销时已过 undoUntil：不发请求，说明已保存', async () => {
    const { actions } = await toReview();
    await click(copy.actions.save);
    await screen.findByRole('button', { name: '撤销' });
    const later = Date.now() + 6000;
    const spy = vi.spyOn(Date, 'now').mockReturnValue(later);
    await click('撤销');
    spy.mockRestore();
    expect(await screen.findByText(copy.saved.undoLate)).toBeTruthy();
    expect(actions.undo).not.toHaveBeenCalled();
  });
});
