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
import { ReceiptPage } from './ReceiptPage';
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

  it('网页交的材料只说明回执也会发到企业微信；整批失败写原因', () => {
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
    expect(screen.getByText(copy.channel.webText)).toBeTruthy();
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
    expect(
      within(cardOf('demo-event-draft-a')).getByRole('button', {
        name: /确认这件事/,
      }),
    ).toBeTruthy();
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
