// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
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
      '演示意见表.docx 第 2 段 的「阿泽」指谁 → 名单外的人',
    );
    const skipped = document.querySelector('.n-rcpt[data-state="skipped"]')!;
    expect(skipped.textContent).toContain(copy.confirm.skippedNote);
    expect(skipped.textContent).not.toContain(copy.review.pending);
    // 没有可见的人：人员卡也只写一句，不给数量
    expect(screen.getAllByText(copy.confirm.hidden)).toHaveLength(2);
    expect(screen.queryByText('等你确认')).toBeNull();
  });
});
