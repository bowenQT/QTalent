// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/Toast';
import {
  materialReferencesFixture as refs,
  recordBatchDraftFixture,
} from '@/contracts/materials.fixtures';
import type { MaterialBatchReceipt } from '@/contracts/materials';
import { copy } from './copy';
import { ReceiptItem } from './ReceiptItem';
import { ReceiptPage } from './ReceiptPage';
import { suggestedValues } from './receipt-model';
import type { ReceiptActions, ReceiptView } from './types';

afterEach(cleanup);

const draft = {
  ...recordBatchDraftFixture,
  sourceReferences: [refs.document, refs.code],
};
const other = { ...recordBatchDraftFixture, draftId: 'demo-event-draft-b' };
const resolved = {
  batchId: 'demo-batch',
  evaluationNodeId: 'demo-node',
  materialId: 'm1',
  originalVersionId: 'demo-document-v1',
  revision: 2,
  state: 'resolved',
  resolvedAt: '2026-09-03T10:00:00.000Z',
  auditId: 'a1',
  undo: { status: 'available' },
};

function make(
  over: Partial<ReceiptView> = {},
  receipt: object = {},
): ReceiptView {
  return {
    receipt: {
      batchId: 'demo-batch',
      revision: 1,
      evaluationNodeId: 'demo-node',
      personIds: ['demo-person'],
      projectId: null,
      hasHiddenContent: false,
      status: 'awaiting_confirmation',
      jobId: null,
      files: [
        {
          materialId: 'm1',
          clientFileId: 'c1',
          filename: '演示意见表.docx',
          status: 'parsed',
          originalVersionId: 'demo-document-v1',
          parseVersionId: 'p1',
        },
      ],
      textMaterial: null,
      items: [],
      resolvedItems: [],
      draftSet: {
        batchId: 'demo-batch',
        revision: 1,
        drafts: [draft, other],
        duplicateCandidates: [],
      },
      confirmedDrafts: [],
      counts: {
        files: {
          total: 1,
          processing: 0,
          parsed: 1,
          needs_review: 0,
          unsupported: 0,
          failed: 0,
          original_only: 0,
          attachment_only: 0,
        },
        events: { total: 2, awaiting_confirmation: 2, confirmed: 0 },
        reviewItems: 0,
      },
      error: null,
      ...receipt,
    } as MaterialBatchReceipt,
    title: 'PR 评审时记的一件事',
    entry: 'mcp',
    tool: 'record_moment',
    original: null,
    submittedBy: '叶青',
    submittedAt: '2026-09-03T08:20:00.000Z',
    people: {
      'demo-person': {
        name: '谷嘉树',
        hue: 14,
        photo: null,
        meta: '口语搭子 · 一组',
        demo: false,
      },
    },
    dimensions: { 'demo-professionalism': '专业度', 'demo-potential': '潜力' },
    confirmers: {
      'demo-event-draft-a': { mine: true, name: '叶青' },
      'demo-event-draft-b': { mine: false, name: '苏晚' },
    },
    ...over,
  };
}

const actions: ReceiptActions = {
  read: vi.fn(),
  save: vi.fn(),
  undo: vi.fn(),
};

function mount(view: ReceiptView) {
  render(
    <ToastProvider>
      <ReceiptPage
        batchId="demo-batch"
        initial={view}
        actions={actions}
        viewerName="叶青"
      />
    </ToastProvider>,
  );
}

describe('入口与证据', () => {
  it('Claude Code 交的材料：回执写成终端输出，标题带工具名', () => {
    mount(make());
    expect(
      screen.getByText(/Claude（MCP）|Claude Code（MCP）/).textContent,
    ).toContain('Claude Code（MCP） · record_moment · 叶青交 · 09-03 16:20');
    const term = document.querySelector('.n-term')!;
    expect(term.textContent).toContain('⏺ 调用 niu · record_moment');
    expect(term.textContent).toContain('涉及的人  谷嘉树');
    expect(term.textContent).toContain('出处      演示意见表.docx');
    expect(screen.getByText(copy.channel.mcpCaption)).toBeTruthy();
    // 名字后面不标演示时就不标
    expect(
      screen.getByRole('link', { name: '谷嘉树' }).parentElement?.textContent,
    ).toBe('谷嘉树');
  });

  it('自己的事排在前，别人的事写等谁确认；资料不足不出分也不能改', async () => {
    const user = userEvent.setup();
    mount(make());
    const cards = document.querySelectorAll('.n-rcpt');
    expect(cards[0]!.id).toBe('rc-demo-event-draft-a');
    expect(
      within(cards[1] as HTMLElement).getByText('等苏晚确认'),
    ).toBeTruthy();
    expect(
      (cards[0] as HTMLElement).querySelector('.n-badge--unknown')?.textContent,
    ).toBe('资料不足');
    expect(
      within(cards[0] as HTMLElement).getByText(copy.confirm.merged(2)),
    ).toBeTruthy();
    await user.click(
      within(cards[0] as HTMLElement).getByRole('button', { name: '改分' }),
    );
    expect(
      within(cards[0] as HTMLElement).getAllByRole('combobox'),
    ).toHaveLength(1);
    expect(
      (cards[0] as HTMLElement).querySelector('div.n-rcpt__editrow')
        ?.textContent,
    ).toBe('潜力资料不足资料不足');
  });

  it('网页交的材料不写「回执也会发到」，也不放占位；整批失败写原因', () => {
    mount(
      make(
        { entry: 'web', tool: null },
        {
          status: 'failed',
          draftSet: null,
          counts: {
            files: {
              total: 1,
              processing: 0,
              parsed: 0,
              needs_review: 0,
              unsupported: 0,
              failed: 1,
              original_only: 0,
              attachment_only: 0,
            },
            events: { total: 0, awaiting_confirmation: 0, confirmed: 0 },
            reviewItems: 0,
          },
          error: {
            code: 'all_materials_unusable',
            message: '这次的材料都读不出内容',
            retryable: false,
          },
        },
      ),
    );
    expect(screen.queryByText(copy.channel.web)).toBeNull();
    expect(screen.queryByText(copy.channel.webText)).toBeNull();
    expect(document.querySelectorAll('aside .n-imcard')).toHaveLength(0);
    expect(screen.getByText(copy.people)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(
      '这次的材料都读不出内容',
    );
    expect(document.querySelector('.n-rstate')?.textContent).toBe('处理失败');
    expect(screen.getByText('1 个失败')).toBeTruthy();
  });
});

describe('已核对与隐藏', () => {
  it('已核对的一处写「问题 → 结果」；名单外的人另列一张卡', () => {
    mount(
      make(
        { people: {}, confirmers: {} },
        {
          personIds: [],
          hasHiddenContent: true,
          draftSet: null,
          counts: {
            files: {
              total: 1,
              processing: 0,
              parsed: 1,
              needs_review: 0,
              unsupported: 0,
              failed: 0,
              original_only: 0,
              attachment_only: 0,
            },
            events: { total: 0, awaiting_confirmation: 0, confirmed: 0 },
            reviewItems: 0,
          },
          resolvedItems: [
            {
              ...resolved,
              kind: 'unknown_person',
              itemId: 'r1',
              observedName: '阿泽',
              source: refs.document,
              resolution: { action: 'keep_original_only' },
            },
          ],
        },
      ),
    );
    const row = screen.getByText('已核对').closest('li')!;
    expect(row.textContent).toContain(
      '演示意见表.docx 第 2 段的「阿泽」指谁 → 名单外的人',
    );
    const skipped = document.querySelector('.n-rcpt[data-state="skipped"]')!;
    expect(skipped.textContent).toContain(copy.confirm.skippedNote);
    expect(skipped.textContent).not.toContain(copy.review.pending);
    // 没有可见的人：人员卡也只写一句，不给数量
    expect(screen.getAllByText(copy.confirm.hidden)).toHaveLength(2);
    expect(screen.queryByText('等你确认')).toBeNull();
  });
});

function mountWith(view: ReceiptView, using: ReceiptActions) {
  render(
    <ToastProvider>
      <ReceiptPage
        batchId="demo-batch"
        initial={view}
        actions={using}
        viewerName="叶青"
      />
    </ToastProvider>,
  );
}

function saved(over: { savedAt?: number } = {}) {
  const at = over.savedAt ?? Date.now();
  return {
    status: 'success' as const,
    replayed: false,
    result: {
      saveId: 'save-1',
      events: [{ personId: 'demo-person', eventId: 'ev-1' }],
      revision: 2,
      confirmationIds: ['c-1'],
      reviewItemIds: [],
      savedBy: 'acct',
      savedAt: new Date(at).toISOString(),
      undoUntil: new Date(at + 5000).toISOString(),
    },
  };
}

const cardOf = (id: string) => document.getElementById(`rc-${id}`)!;

describe('确认之后', () => {
  it('保存成功就给撤销入口，不等重读；重读失败时卡片仍是已确认，撤销后回到待确认', async () => {
    const user = userEvent.setup();
    const using: ReceiptActions = {
      read: vi.fn().mockRejectedValue(new Error('offline')),
      save: vi.fn().mockResolvedValue(saved()),
      undo: vi.fn().mockResolvedValue({
        status: 'success',
        replayed: false,
        result: {
          saveId: 'save-1',
          withdrawnEvents: [{ personId: 'demo-person', eventId: 'ev-1' }],
          withdrawnConfirmationIds: ['c-1'],
          withdrawnReviewItemIds: [],
          // 846 撤销推进了草稿版本；重读失败时页面按这个版本再保存
          draftRestoration: {
            status: 'available',
            draftId: 'demo-event-draft-a',
            draftRevision: 7,
          },
          inputRestoration: 'unavailable',
          originalInput: null,
        },
      }),
    };
    mountWith(make(), using);
    await user.click(
      within(cardOf('demo-event-draft-a')).getByRole('button', {
        name: /确认这件事/,
      }),
    );
    const undo = await screen.findByRole('button', { name: '撤销' });
    const card = cardOf('demo-event-draft-a');
    expect(card.dataset.state).toBe('confirmed');
    expect(
      within(card).queryByRole('button', { name: /确认这件事/ }),
    ).toBeNull();
    await user.click(undo);
    expect(await screen.findByText(copy.toast.undone)).toBeTruthy();
    const again = within(cardOf('demo-event-draft-a')).getByRole('button', {
      name: /确认这件事/,
    });
    await user.click(again);
    await waitFor(() => expect(using.save).toHaveBeenCalledTimes(2));
    const [first, second] = vi.mocked(using.save).mock.calls;
    expect(first![0].expected_revision).not.toBe(7);
    expect(second![0]).toMatchObject({
      draftId: 'demo-event-draft-a',
      expected_revision: 7,
    });
    expect(second![0].operation_id).not.toBe(first![0].operation_id);
  });

  it('保存这次中断时说明改动还在，不当作网络断开', async () => {
    const user = userEvent.setup();
    mountWith(make(), {
      read: vi.fn(),
      save: vi.fn().mockResolvedValue({ status: 'unavailable' }),
      undo: vi.fn(),
    });
    await user.click(
      within(cardOf('demo-event-draft-a')).getByRole('button', {
        name: /确认这件事/,
      }),
    );
    expect(await screen.findByText(copy.problem.unavailable)).toBeTruthy();
    expect(screen.queryByText(copy.problem.offline)).toBeNull();
    expect(cardOf('demo-event-draft-a').dataset.state).not.toBe('confirmed');
  });

  it('重读一直不回也有撤销入口；保存回执的撤销时间已过就只提示已确认', async () => {
    const user = userEvent.setup();
    const using: ReceiptActions = {
      read: vi.fn(() => new Promise(() => {})) as never,
      save: vi
        .fn()
        .mockResolvedValueOnce(saved())
        .mockResolvedValueOnce(saved({ savedAt: Date.now() - 6000 })),
      undo: vi.fn(),
    };
    mountWith(make(), using);
    await user.click(
      within(cardOf('demo-event-draft-a')).getByRole('button', {
        name: /确认这件事/,
      }),
    );
    expect(await screen.findByRole('button', { name: '撤销' })).toBeTruthy();
    cleanup();
    mountWith(make(), using);
    await user.click(
      within(cardOf('demo-event-draft-a')).getByRole('button', {
        name: /确认这件事/,
      }),
    );
    expect(
      await screen.findByText(copy.toast.confirmed('谷嘉树', false)),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull();
  });

  it('载入新版本后分值换成新建议，正在改的分作废并说明', async () => {
    const user = userEvent.setup();
    const next = make(
      {},
      {
        draftSet: {
          batchId: 'demo-batch',
          revision: 2,
          drafts: [
            {
              ...draft,
              revision: 2,
              scores: draft.scores.map((s) =>
                s.state === 'suggested' ? { ...s, value: 4 } : s,
              ),
            },
            other,
          ],
          duplicateCandidates: [],
        },
      },
    );
    const using: ReceiptActions = {
      read: vi.fn().mockResolvedValue({ status: 'success', view: next }),
      save: vi.fn().mockResolvedValue({
        status: 'conflict',
        message: '这件事刚有新的版本，载入后再确认',
        input: {},
      }),
      undo: vi.fn(),
    };
    mountWith(make(), using);
    const card = () => cardOf('demo-event-draft-a');
    await user.click(within(card()).getByRole('button', { name: '改分' }));
    await user.selectOptions(within(card()).getByRole('combobox'), '5');
    await user.type(within(card()).getByRole('textbox'), '两人合作');
    await user.click(
      within(card()).getByRole('button', { name: '保存并确认' }),
    );
    await user.click(
      await within(card()).findByRole('button', { name: copy.problem.reload }),
    );
    await waitFor(() =>
      expect(
        (within(card()).getByRole('combobox') as HTMLSelectElement).value,
      ).toBe('4'),
    );
    expect(within(card()).getByText(copy.edit.refreshed)).toBeTruthy();
    expect(within(card()).getByText(copy.edit.aiSuggest(4))).toBeTruthy();
  });

  it('一件事涉及多人时，每个分数和改分框写明是谁的', async () => {
    const user = userEvent.setup();
    const pair = {
      ...draft,
      personIds: ['demo-person', 'demo-person-2'],
      scores: [
        draft.scores[0]!,
        { ...draft.scores[0]!, personId: 'demo-person-2' },
      ],
    };
    mountWith(
      make(
        {
          people: {
            ...make().people,
            'demo-person-2': {
              name: '林知夏',
              hue: 30,
              photo: null,
              meta: '口语搭子 · 一组',
              demo: true,
            },
          },
        },
        {
          draftSet: {
            batchId: 'demo-batch',
            revision: 1,
            drafts: [pair],
            duplicateCandidates: [],
          },
        },
      ),
      actions,
    );
    const card = cardOf('demo-event-draft-a');
    expect(
      [...card.querySelectorAll('.n-rcpt__score .n-score__dim')].map(
        (el) => el.textContent,
      ),
    ).toEqual(['谷嘉树 · 专业度', '林知夏 · 专业度']);
    await user.click(within(card).getByRole('button', { name: '改分' }));
    expect(
      within(card).getByRole('combobox', { name: /林知夏 · 专业度/ }),
    ).toBeTruthy();
  });
});

const undoneResult = (draftRevision: number) => ({
  status: 'success' as const,
  replayed: false,
  result: {
    saveId: 'save-1',
    withdrawnEvents: [{ personId: 'demo-person', eventId: 'ev-1' }],
    withdrawnConfirmationIds: ['c-1'],
    withdrawnReviewItemIds: [],
    draftRestoration: {
      status: 'available' as const,
      draftId: 'demo-event-draft-a',
      draftRevision,
    },
    inputRestoration: 'unavailable' as const,
    originalInput: null,
  },
});

describe('撤销链路', () => {
  it('撤销的响应丢了：不说已确认，也不说失败；再试沿用同一次撤销，服务端重放后回到待确认', async () => {
    const user = userEvent.setup();
    const undo = vi
      .fn()
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({ ...undoneResult(3), replayed: true });
    mountWith(make(), {
      read: vi.fn().mockRejectedValue(new Error('offline')),
      save: vi.fn().mockResolvedValue(saved()),
      undo,
    });
    const card = () => cardOf('demo-event-draft-a');
    await user.click(
      within(card()).getByRole('button', { name: /确认这件事/ }),
    );
    await user.click(await screen.findByRole('button', { name: '撤销' }));
    expect(await screen.findByText(copy.toast.undoUnknown)).toBeTruthy();
    expect(within(card()).getByText(copy.confirm.undoPending)).toBeTruthy();
    expect(within(card()).queryByText(/已进入档案/)).toBeNull();
    expect(screen.queryByText(copy.toast.undoFailed)).toBeNull();
    expect(screen.queryByText(copy.toast.undone)).toBeNull();

    await user.click(
      within(card()).getByRole('button', { name: copy.confirm.undoRetry }),
    );
    await waitFor(() =>
      expect(
        within(card()).getByRole('button', { name: /确认这件事/ }),
      ).toBeTruthy(),
    );
    const [first, second] = undo.mock.calls;
    expect(second![0]).toEqual(first![0]);
    expect(within(card()).queryByText(copy.confirm.undoPending)).toBeNull();
  });

  it('撤销先超时、重试又被拒：不说仍已确认，请用户刷新回执，以重读到的为准', async () => {
    const user = userEvent.setup();
    // 那次撤销其实生效了、只是响应丢了；之后评价关系被撤权，服务端先鉴权再重放，返回 forbidden
    const undo = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ status: 'forbidden', message: '无权' });
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ status: 'success', view: make() });
    mountWith(make(), {
      read,
      save: vi.fn().mockResolvedValue(saved()),
      undo,
    });
    const card = () => cardOf('demo-event-draft-a');
    await user.click(
      within(card()).getByRole('button', { name: /确认这件事/ }),
    );
    await user.click(await screen.findByRole('button', { name: '撤销' }));
    await user.click(
      await within(card()).findByRole('button', {
        name: copy.confirm.undoRetry,
      }),
    );
    expect(
      await within(card()).findByText(copy.confirm.undoVerify),
    ).toBeTruthy();
    expect(within(card()).queryByText(/已进入档案/)).toBeNull();
    expect(screen.queryByText(/仍是已确认/)).toBeNull();
    const calls = read.mock.calls.length;
    await user.click(
      within(card()).getByRole('button', { name: copy.confirm.undoReread }),
    );
    await waitFor(() => expect(read.mock.calls.length).toBe(calls + 1));
    // 重读到的回执里这件事在待确认：照它显示
    expect(
      await within(card()).findByRole('button', { name: /确认这件事/ }),
    ).toBeTruthy();
    expect(within(card()).queryByText(copy.confirm.undoVerify)).toBeNull();
  });

  it('改分保存后撤销：版本按回执推进，分和理由照保存时的留着，再保存用新版本和新编号', async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue(saved());
    mountWith(make(), {
      read: vi.fn().mockRejectedValue(new Error('offline')),
      save,
      undo: vi.fn().mockResolvedValue(undoneResult(7)),
    });
    const card = () => cardOf('demo-event-draft-a');
    await user.click(within(card()).getByRole('button', { name: '改分' }));
    await user.selectOptions(within(card()).getByRole('combobox'), '5');
    await user.type(within(card()).getByRole('textbox'), '两人合作');
    await user.click(
      within(card()).getByRole('button', { name: '保存并确认' }),
    );
    await user.click(await screen.findByRole('button', { name: '撤销' }));
    await waitFor(() =>
      expect(
        (within(card()).getByRole('combobox') as HTMLSelectElement).value,
      ).toBe('5'),
    );
    expect(
      (within(card()).getByRole('textbox') as HTMLTextAreaElement).value,
    ).toBe('两人合作');
    expect(within(card()).queryByText(copy.edit.refreshed)).toBeNull();
    await user.click(
      within(card()).getByRole('button', { name: '保存并确认' }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    const [first, second] = save.mock.calls;
    expect(second![0]).toMatchObject({
      expected_revision: 7,
      decisions: [
        expect.objectContaining({
          action: 'edit',
          value: 5,
          reason: '两人合作',
        }),
        ...first![0].decisions.slice(1),
      ],
    });
    expect(second![0].operation_id).not.toBe(first![0].operation_id);
  });

  it('改分 → 保存 → 重读成功 → 撤销（之后的重读失败）：卡片换组也不丢改过的分和理由', async () => {
    const user = userEvent.setup();
    // 保存后的快照：这件事在 confirmedDrafts，确认人里没有它，卡片排到别人的事后面
    const afterSave = make(
      { confirmers: { 'demo-event-draft-b': { mine: false, name: '苏晚' } } },
      {
        draftSet: {
          batchId: 'demo-batch',
          revision: 2,
          drafts: [other],
          duplicateCandidates: [],
        },
        confirmedDrafts: [
          {
            draftId: 'demo-event-draft-a',
            revision: 2,
            events: [{ personId: 'demo-person', eventId: 'ev-1' }],
          },
        ],
      },
    );
    const read = vi
      .fn()
      .mockResolvedValueOnce({ status: 'success', view: afterSave })
      // 撤销后的重读失败：页面还拿着保存后的快照，这件事的确认人信息不在里面
      .mockRejectedValue(new Error('offline'));
    const save = vi.fn().mockResolvedValue(saved());
    mountWith(make(), {
      read,
      save,
      undo: vi.fn().mockResolvedValue(undoneResult(3)),
    });
    const card = () => cardOf('demo-event-draft-a');
    await user.click(within(card()).getByRole('button', { name: '改分' }));
    await user.selectOptions(within(card()).getByRole('combobox'), '5');
    await user.type(within(card()).getByRole('textbox'), '两人合作');
    await user.click(
      within(card()).getByRole('button', { name: '保存并确认' }),
    );
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    await user.click(await screen.findByRole('button', { name: '撤销' }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        (within(card()).getByRole('combobox') as HTMLSelectElement).value,
      ).toBe('5'),
    );
    expect(
      (within(card()).getByRole('textbox') as HTMLTextAreaElement).value,
    ).toBe('两人合作');
    expect(within(card()).queryByText(copy.edit.refreshed)).toBeNull();
    await user.click(
      within(card()).getByRole('button', { name: '保存并确认' }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]![0]).toMatchObject({
      expected_revision: 3,
      decisions: [
        expect.objectContaining({
          action: 'edit',
          value: 5,
          reason: '两人合作',
        }),
        ...save.mock.calls[0]![0].decisions.slice(1),
      ],
    });
  });

  it('保存后重读成功、撤销后重读失败：这件事回到待确认，确认入口还在', async () => {
    const user = userEvent.setup();
    // 保存后的快照：这件事已在 confirmedDrafts，待确认和确认人里都没有它
    const after = make(
      {
        confirmers: {
          'demo-event-draft-b': { mine: false, name: '苏晚' },
        },
      },
      {
        draftSet: {
          batchId: 'demo-batch',
          revision: 2,
          drafts: [other],
          duplicateCandidates: [],
        },
        confirmedDrafts: [
          {
            draftId: 'demo-event-draft-a',
            revision: 2,
            events: [{ personId: 'demo-person', eventId: 'ev-1' }],
          },
        ],
        counts: {
          files: {
            total: 1,
            processing: 0,
            parsed: 1,
            needs_review: 0,
            unsupported: 0,
            failed: 0,
            original_only: 0,
            attachment_only: 0,
          },
          events: { total: 2, awaiting_confirmation: 1, confirmed: 1 },
          reviewItems: 0,
        },
      },
    );
    const read = vi
      .fn()
      .mockResolvedValueOnce({ status: 'success', view: after })
      .mockRejectedValue(new Error('offline'));
    const save = vi.fn().mockResolvedValue(saved());
    mountWith(make(), {
      read,
      save,
      undo: vi.fn().mockResolvedValue(undoneResult(3)),
    });
    const card = () => cardOf('demo-event-draft-a');
    await user.click(
      within(card()).getByRole('button', { name: /确认这件事/ }),
    );
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    await user.click(await screen.findByRole('button', { name: '撤销' }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    const again = await within(card()).findByRole('button', {
      name: /确认这件事/,
    });
    expect(within(card()).queryByText(/等.*确认/)).toBeNull();
    await user.click(again);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]![0].expected_revision).toBe(3);
  });
});

describe('只写了原话的批次', () => {
  const textOnly = (original: string | null) =>
    make(
      { entry: 'web', tool: null, original },
      {
        status: 'processing',
        jobId: 'job-1',
        files: [],
        textMaterial: {
          materialId: 'frag-text',
          originalVersionId: 'ver-text',
        },
        draftSet: null,
        counts: {
          files: {
            total: 0,
            processing: 0,
            parsed: 0,
            needs_review: 0,
            unsupported: 0,
            failed: 0,
            original_only: 0,
            attachment_only: 0,
          },
          events: { total: 0, awaiting_confirmation: 0, confirmed: 0 },
          reviewItems: 0,
        },
      },
    );

  it('原话放在「原话」卡里，计数写一段原话，没有「0 个文件」和空的文件卡', () => {
    mount(textOnly('演示：今天主动同步了进度。'));
    const card = screen.getByRole('heading', {
      name: copy.files.originalTitle,
    }).parentElement!;
    expect(within(card).getByText('演示：今天主动同步了进度。')).toBeTruthy();
    expect(within(card).getByText(copy.files.arranging)).toBeTruthy();
    expect(
      screen.queryByRole('heading', { name: copy.files.title }),
    ).toBeNull();
    expect(screen.queryByText(copy.files.stillProcessing)).toBeNull();
    const summary = screen.getByRole('list', { name: copy.summary.label });
    expect(summary.textContent).toContain(`1${copy.summary.original}`);
    expect(summary.textContent).not.toContain(copy.summary.files);
  });

  it('读不到原话时只留标题和整理说明，也不出文件卡', () => {
    mount(textOnly(null));
    expect(
      screen.getByRole('heading', { name: copy.files.originalTitle }),
    ).toBeTruthy();
    expect(document.querySelector('.n-cite__quote')).toBeNull();
    expect(
      screen.queryByRole('heading', { name: copy.files.title }),
    ).toBeNull();
  });
});

describe('撤销回来的卡片重新挂载时', () => {
  it('一挂载就带着保存时的分和理由，停在改分里', () => {
    const key = Object.keys(suggestedValues(draft))[0]!;
    render(
      <ReceiptItem
        view={make()}
        draft={{ ...draft, revision: 3 }}
        mode="mine"
        busy={false}
        problem={null}
        restore={{ values: { [key]: 5 }, reason: '两人合作' }}
        onConfirm={vi.fn()}
        onReload={vi.fn()}
      />,
    );
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('5');
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      '两人合作',
    );
    expect(screen.queryByText(copy.edit.refreshed)).toBeNull();
  });
});

describe('建议分比较不看 scores 的顺序', () => {
  it('同一组建议分只是换了顺序：正在改的分和理由留着，不提示有新版本', async () => {
    const user = userEvent.setup();
    const [first] = draft.scores;
    const two = {
      ...draft,
      scores: [
        first!,
        { ...first!, dimensionId: 'demo-potential', value: 4 },
      ] as typeof draft.scores,
    };
    const props = {
      view: make(),
      mode: 'mine' as const,
      busy: false,
      problem: null,
      onConfirm: vi.fn(),
      onReload: vi.fn(),
    };
    const { rerender } = render(<ReceiptItem {...props} draft={two} />);
    await user.click(screen.getByRole('button', { name: '改分' }));
    const [select] = screen.getAllByRole('combobox');
    await user.selectOptions(select!, '5');
    await user.type(screen.getByRole('textbox'), '两人合作');
    rerender(
      <ReceiptItem
        {...props}
        draft={{ ...two, revision: 2, scores: [...two.scores].reverse() }}
      />,
    );
    expect(
      screen
        .getAllByRole('combobox')
        .map((el) => (el as HTMLSelectElement).value)
        .sort(),
    ).toEqual(['4', '5']);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      '两人合作',
    );
    expect(screen.queryByText(copy.edit.refreshed)).toBeNull();
  });
});

describe('本页状态和读取快照的优先规则', () => {
  const bothMine = {
    'demo-event-draft-a': { mine: true, name: '叶青' },
    'demo-event-draft-b': { mine: true, name: '叶青' },
  };
  const counts = (awaiting: number, done: number) => ({
    files: {
      total: 1,
      processing: 0,
      parsed: 1,
      needs_review: 0,
      unsupported: 0,
      failed: 0,
      original_only: 0,
      attachment_only: 0,
    },
    events: { total: 2, awaiting_confirmation: awaiting, confirmed: done },
    reviewItems: 0,
  });
  const snapshot = (
    pending: object[],
    // 已确认的事；写成 [id, eventId] 时指定这次确认的事件编号
    confirmedIds: (string | [string, string])[],
    confirmers: ReceiptView['confirmers'] = bothMine,
  ) =>
    make(
      { confirmers },
      {
        draftSet: pending.length
          ? {
              batchId: 'demo-batch',
              revision: 3,
              drafts: pending,
              duplicateCandidates: [],
            }
          : null,
        confirmedDrafts: confirmedIds.map((entry) => {
          const [draftId, eventId] =
            typeof entry === 'string' ? [entry, `ev-${entry}`] : entry;
          return {
            draftId,
            revision: 2,
            events: [{ personId: 'demo-person', eventId }],
          };
        }),
        counts: counts(pending.length, confirmedIds.length),
      },
    );
  const b = { ...other, draftId: 'demo-event-draft-b' };

  it('保存之后发起的读取读到这件事在待确认（别处撤销了）：按快照回到待确认，分和理由照保存时的留着', async () => {
    const user = userEvent.setup();
    const read = vi.fn().mockResolvedValue({
      status: 'success',
      view: snapshot([{ ...draft, revision: 3 }, b], []),
    });
    mountWith(make({ confirmers: bothMine }), {
      read,
      save: vi.fn().mockResolvedValue(saved()),
      undo: vi.fn(),
    });
    const card = () => cardOf('demo-event-draft-a');
    await user.click(within(card()).getByRole('button', { name: '改分' }));
    await user.selectOptions(within(card()).getByRole('combobox'), '5');
    await user.type(within(card()).getByRole('textbox'), '两人合作');
    await user.click(
      within(card()).getByRole('button', { name: '保存并确认' }),
    );
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(card().dataset.state).toBe('ai'));
    expect(
      (within(card()).getByRole('combobox') as HTMLSelectElement).value,
    ).toBe('5');
    expect(
      (within(card()).getByRole('textbox') as HTMLTextAreaElement).value,
    ).toBe('两人合作');
  });

  it('快照确认过这次保存之后，别处撤销：按快照回到待确认，换回 AI 建议（编辑输入已在快照确认时丢弃）', async () => {
    const user = userEvent.setup();
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'success',
        view: snapshot([b], [['demo-event-draft-a', 'ev-1']]),
      })
      .mockResolvedValue({
        status: 'success',
        view: snapshot([{ ...draft, revision: 3 }], ['demo-event-draft-b']),
      });
    mountWith(make({ confirmers: bothMine }), {
      read,
      save: vi.fn().mockResolvedValue(saved()),
      undo: vi.fn(),
    });
    const card = () => cardOf('demo-event-draft-a');
    await user.click(within(card()).getByRole('button', { name: '改分' }));
    await user.selectOptions(within(card()).getByRole('combobox'), '5');
    await user.type(within(card()).getByRole('textbox'), '两人合作');
    await user.click(
      within(card()).getByRole('button', { name: '保存并确认' }),
    );
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    // 快照里的确认就是本页这次保存：照它补署名和分数
    expect(card().dataset.state).toBe('confirmed');
    expect(within(card()).getByText(/AI 原为/)).toBeTruthy();
    await user.click(
      within(cardOf('demo-event-draft-b')).getByRole('button', {
        name: /确认这件事/,
      }),
    );
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(
      await within(card()).findByRole('button', { name: /确认这件事/ }),
    ).toBeTruthy();
  });

  it('保存还没返回时最新一次读取先落定：它带回的待确认纠正不了随后保存成功的「已确认」', async () => {
    const user = userEvent.setup();
    let releaseRead!: (value: unknown) => void;
    let releaseSave!: (value: unknown) => void;
    const read = vi
      .fn()
      .mockReturnValueOnce(new Promise((resolve) => (releaseRead = resolve)))
      // 保存第一件事之后的读取一直不回
      .mockReturnValue(new Promise(() => undefined));
    const save = vi
      .fn()
      .mockResolvedValueOnce(saved())
      .mockReturnValueOnce(new Promise((resolve) => (releaseSave = resolve)));
    mountWith(make({ confirmers: bothMine }), { read, save, undo: vi.fn() });
    await user.click(
      within(cardOf('demo-event-draft-b')).getByRole('button', {
        name: /确认这件事/,
      }),
    );
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    await user.click(
      within(cardOf('demo-event-draft-a')).getByRole('button', {
        name: /确认这件事/,
      }),
    );
    // 读取在保存返回之前落定，当时这件事确实还在待确认
    releaseRead({
      status: 'success',
      view: snapshot([draft], ['demo-event-draft-b']),
    });
    await waitFor(() =>
      expect(cardOf('demo-event-draft-b').dataset.state).toBe('confirmed'),
    );
    releaseSave(saved());
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(cardOf('demo-event-draft-a').dataset.state).toBe('confirmed'),
    );
    expect(
      within(cardOf('demo-event-draft-a')).queryByRole('button', {
        name: /确认这件事/,
      }),
    ).toBeNull();
  });

  it('更早发起、更晚落定的读取：不替换已经显示的更新快照', async () => {
    const user = userEvent.setup();
    let release!: (value: unknown) => void;
    const read = vi
      .fn()
      .mockReturnValueOnce(new Promise((resolve) => (release = resolve)))
      // 后发起的读取先回来：第一件事在别处被撤销，回到了待确认
      .mockResolvedValue({
        status: 'success',
        view: snapshot([{ ...draft, revision: 3 }], ['demo-event-draft-b']),
      });
    mountWith(make({ confirmers: bothMine }), {
      read,
      save: vi.fn().mockResolvedValue(saved()),
      undo: vi.fn(),
    });
    const card = () => cardOf('demo-event-draft-a');
    await user.click(
      within(card()).getByRole('button', { name: /确认这件事/ }),
    );
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    await user.click(
      within(cardOf('demo-event-draft-b')).getByRole('button', {
        name: /确认这件事/,
      }),
    );
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(
      await within(card()).findByRole('button', { name: /确认这件事/ }),
    ).toBeTruthy();
    // 第一次读取现在才回来，带着第一件事还是已确认的样子
    release({ status: 'success', view: snapshot([b], ['demo-event-draft-a']) });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(card().dataset.state).toBe('ai');
    expect(
      within(card()).getByRole('button', { name: /确认这件事/ }),
    ).toBeTruthy();
  });

  it('撤销之后才发起的读取读到这件事已确认：撤销记录作废，照快照显示已确认', async () => {
    const user = userEvent.setup();
    const read = vi.fn().mockResolvedValue({
      status: 'success',
      view: snapshot([b], ['demo-event-draft-a']),
    });
    mountWith(make({ confirmers: bothMine }), {
      read,
      save: vi.fn().mockResolvedValue(saved()),
      undo: vi.fn().mockResolvedValue(undoneResult(3)),
    });
    const card = () => cardOf('demo-event-draft-a');
    await user.click(
      within(card()).getByRole('button', { name: /确认这件事/ }),
    );
    await user.click(await screen.findByRole('button', { name: '撤销' }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        within(card()).getByText(copy.confirm.confirmedShort),
      ).toBeTruthy(),
    );
    expect(
      within(card()).queryByRole('button', { name: /确认这件事/ }),
    ).toBeNull();
  });

  it('快照明确写了不是本人确认：撤销记录不覆盖它', async () => {
    const user = userEvent.setup();
    const read = vi.fn().mockResolvedValue({
      status: 'success',
      view: snapshot([{ ...draft, revision: 3 }, b], [], {
        'demo-event-draft-a': { mine: false, name: '苏晚' },
        'demo-event-draft-b': { mine: true, name: '叶青' },
      }),
    });
    mountWith(make({ confirmers: bothMine }), {
      read: vi
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockImplementation(read),
      save: vi.fn().mockResolvedValue(saved()),
      undo: vi.fn().mockResolvedValue(undoneResult(3)),
    });
    const card = () => cardOf('demo-event-draft-a');
    await user.click(
      within(card()).getByRole('button', { name: /确认这件事/ }),
    );
    await user.click(await screen.findByRole('button', { name: '撤销' }));
    expect(
      await within(card()).findByText(copy.confirm.waitFor('苏晚')),
    ).toBeTruthy();
    expect(
      within(card()).queryByRole('button', { name: /确认这件事/ }),
    ).toBeNull();
  });

  it('只有版本号变了、建议分没变：正在改的分和理由留着，不提示有新版本', async () => {
    const user = userEvent.setup();
    const same = make(
      {},
      {
        draftSet: {
          batchId: 'demo-batch',
          revision: 2,
          drafts: [{ ...draft, revision: 2 }, other],
          duplicateCandidates: [],
        },
      },
    );
    mountWith(make(), {
      read: vi.fn().mockResolvedValue({ status: 'success', view: same }),
      save: vi.fn().mockResolvedValue({
        status: 'conflict',
        message: '这件事刚有新的版本，载入后再确认',
        input: {},
      }),
      undo: vi.fn(),
    });
    const card = () => cardOf('demo-event-draft-a');
    await user.click(within(card()).getByRole('button', { name: '改分' }));
    await user.selectOptions(within(card()).getByRole('combobox'), '5');
    await user.type(within(card()).getByRole('textbox'), '两人合作');
    await user.click(
      within(card()).getByRole('button', { name: '保存并确认' }),
    );
    await user.click(
      await within(card()).findByRole('button', { name: copy.problem.reload }),
    );
    await waitFor(() => expect(within(card()).queryByRole('alert')).toBeNull());
    expect(
      (within(card()).getByRole('combobox') as HTMLSelectElement).value,
    ).toBe('5');
    expect(
      (within(card()).getByRole('textbox') as HTMLTextAreaElement).value,
    ).toBe('两人合作');
    expect(within(card()).queryByText(copy.edit.refreshed)).toBeNull();
  });

  describe('Codex 最终轮的两个场景', () => {
    const c = { ...other, draftId: 'demo-event-draft-c' };
    const threeMine = {
      ...bothMine,
      'demo-event-draft-c': { mine: true, name: '叶青' },
    };
    const three = make(
      { confirmers: threeMine },
      {
        draftSet: {
          batchId: 'demo-batch',
          revision: 1,
          drafts: [draft, b, c],
          duplicateCandidates: [],
        },
      },
    );

    it('撤销成功但响应丢了、之后撤权、重试被拒，刷新读取又失败：一直是待核实，不退回「已确认」', async () => {
      const user = userEvent.setup();
      const read = vi
        .fn()
        // 保存后的读取：这件事已确认，事件编号和这次保存一致
        .mockResolvedValueOnce({
          status: 'success',
          view: snapshot([b], [['demo-event-draft-a', 'ev-1']]),
        })
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce({ status: 'forbidden', message: '无权' })
        .mockResolvedValueOnce({ status: 'unavailable' });
      const undo = vi
        .fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValue({ status: 'forbidden', message: '无权' });
      mountWith(make({ confirmers: bothMine }), {
        read,
        save: vi.fn().mockResolvedValue(saved()),
        undo,
      });
      const card = () => cardOf('demo-event-draft-a');
      await user.click(
        within(card()).getByRole('button', { name: /确认这件事/ }),
      );
      await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
      await user.click(await screen.findByRole('button', { name: '撤销' }));
      await user.click(
        await within(card()).findByRole('button', {
          name: copy.confirm.undoRetry,
        }),
      );
      expect(
        await within(card()).findByText(copy.confirm.undoVerify),
      ).toBeTruthy();
      // 刷新读取抛错、forbidden、unavailable：都留在待核实，刷新入口还在
      for (const calls of [2, 3, 4]) {
        await user.click(
          within(card()).getByRole('button', {
            name: copy.confirm.undoReread,
          }),
        );
        await waitFor(() => expect(read).toHaveBeenCalledTimes(calls));
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(within(card()).queryByText(/已进入档案/)).toBeNull();
        expect(within(card()).getByText(copy.confirm.undoVerify)).toBeTruthy();
        expect(
          await within(card()).findByText(copy.confirm.undoReadFailed),
        ).toBeTruthy();
        await waitFor(() =>
          expect(
            within(card()).getByRole('button', {
              name: copy.confirm.undoReread,
            }),
          ).toHaveProperty('disabled', false),
        );
      }
    });

    it('本页 5 分保存，别处撤销、改 3 分重存：读到别处的确认时只显示摘要，不补回本页的 5 分', async () => {
      const user = userEvent.setup();
      const read = vi
        .fn()
        // 本页保存后：这件事已确认，是本页这次保存（ev-1）
        .mockResolvedValueOnce({
          status: 'success',
          view: snapshot([b, c], [['demo-event-draft-a', 'ev-1']], threeMine),
        })
        // 别处撤销了：这件事回到待确认
        .mockResolvedValueOnce({
          status: 'success',
          view: snapshot(
            [{ ...draft, revision: 3 }, c],
            [['demo-event-draft-b', 'ev-b']],
            threeMine,
          ),
        })
        // 别处改 3 分重新保存：新的事件编号
        .mockResolvedValue({
          status: 'success',
          view: snapshot(
            [],
            [
              ['demo-event-draft-a', 'ev-2'],
              ['demo-event-draft-b', 'ev-b'],
              ['demo-event-draft-c', 'ev-c'],
            ],
            threeMine,
          ),
        });
      mountWith(three, {
        read,
        save: vi.fn().mockResolvedValue(saved()),
        undo: vi.fn(),
      });
      const card = () => cardOf('demo-event-draft-a');
      await user.click(within(card()).getByRole('button', { name: '改分' }));
      await user.selectOptions(within(card()).getByRole('combobox'), '5');
      await user.type(within(card()).getByRole('textbox'), '两人合作');
      await user.click(
        within(card()).getByRole('button', { name: '保存并确认' }),
      );
      await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
      await user.click(
        within(cardOf('demo-event-draft-b')).getByRole('button', {
          name: /确认这件事/,
        }),
      );
      await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(card().dataset.state).toBe('ai'));
      await user.click(
        within(cardOf('demo-event-draft-c')).getByRole('button', {
          name: /确认这件事/,
        }),
      );
      await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
      await waitFor(() =>
        expect(
          within(card()).getByText(copy.confirm.confirmedShort),
        ).toBeTruthy(),
      );
      expect(within(card()).queryByText(/AI 原为/)).toBeNull();
      expect(within(card()).queryByText('5')).toBeNull();
      expect(within(card()).queryByText(/叶青/)).toBeNull();
    });
  });
});
