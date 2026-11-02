// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/Toast';
import type { RecordBatchDraft } from '@/contracts/record';
import type { ShellData } from '@/contracts/shell';
import {
  materialReferencesFixture as refs,
  recordBatchDraftFixture,
} from '@/contracts/materials.fixtures';
import { ReceiptPage } from '@/features/receipt/ReceiptPage';
import type { ReceiptView } from '@/features/receipt/types';
import ReceiptRoute from './page';

/*
 * H3：从真实入口走到目标动作。page.tsx → LiveReceipt → ReceiptPage 都是生产代码，只替换
 * 服务端查询、Server Action 和读取路由的网络。Next 默认把同一页的 Server Action 排成一条
 * 串行队列，这里用一条 promise 链给它建模：前一个 action 没返回，后一个不开始。
 */
const queue = vi.hoisted(() => {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    reset: () => (tail = Promise.resolve()),
    serial:
      <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
      (...args: A): Promise<R> => {
        const run = tail.then(() => fn(...args));
        tail = run.catch(() => undefined);
        return run;
      },
  };
});
const mocks = vi.hoisted(() => ({
  shell: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  undo: vi.fn(),
}));
vi.mock('@/server/queries/shell', () => ({ getShellPage: mocks.shell }));
vi.mock('@/server/queries/receipt-page', () => ({
  readReceiptForCurrentUser: mocks.read,
}));
vi.mock('@/server/actions/record-batch', () => ({
  saveRecordBatchAction: queue.serial((input: unknown) => mocks.save(input)),
}));
vi.mock('@/server/actions/record', () => ({
  undoRecordAction: queue.serial((input: unknown) => mocks.undo(input)),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/receipt',
  useRouter: () => ({ refresh: vi.fn() }),
}));

const draft: RecordBatchDraft = {
  ...recordBatchDraftFixture,
  sourceReferences: [refs.document, refs.code],
};
const other = { ...recordBatchDraftFixture, draftId: 'demo-event-draft-b' };
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
/** pending：待确认的草稿；confirmed：[草稿, 事件编号]。 */
function view(
  pending: RecordBatchDraft[],
  confirmed: [string, string][] = [],
  revision = 1,
): ReceiptView {
  return {
    receipt: {
      batchId: 'demo-batch',
      revision,
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
      draftSet: pending.length
        ? {
            batchId: 'demo-batch',
            revision,
            drafts: pending,
            duplicateCandidates: [],
          }
        : null,
      confirmedDrafts: confirmed.map(([draftId, eventId]) => ({
        draftId,
        revision,
        events: [{ personId: 'demo-person', eventId }],
      })),
      counts: counts(pending.length, confirmed.length),
      error: null,
    },
    title: '演示项目 · 演示节点',
    entry: 'web',
    tool: null,
    original: null,
    submittedBy: '叶青',
    submittedAt: '2026-09-03T10:00:00.000Z',
    people: {
      'demo-person': {
        name: '谷嘉树',
        hue: 14,
        photo: null,
        meta: '演示',
        demo: true,
      },
    },
    dimensions: {
      'demo-professionalism': '专业度',
      'demo-potential': '潜力',
    },
    confirmers: {
      'demo-event-draft-a': { mine: true, name: '叶青' },
      'demo-event-draft-b': { mine: true, name: '叶青' },
    },
  } as unknown as ReceiptView;
}
const saved = (saveId: string, eventId: string) => ({
  status: 'success' as const,
  replayed: false,
  result: {
    saveId,
    events: [{ personId: 'demo-person', eventId }],
    revision: 2,
    confirmationIds: ['c-' + saveId],
    reviewItemIds: [],
    savedBy: 'acct',
    savedAt: new Date().toISOString(),
    undoUntil: new Date(Date.now() + 5000).toISOString(),
  },
});
const undone = (saveId: string, draftRevision: number) => ({
  status: 'success' as const,
  replayed: false,
  result: {
    saveId,
    withdrawnEvents: [{ personId: 'demo-person', eventId: 'ev-1' }],
    withdrawnConfirmationIds: ['c-' + saveId],
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
const shell: ShellData = {
  account: {
    id: 'test',
    name: '叶青',
    email: 'test@qtalent.test',
    roles: ['mentor'],
    hue: 20,
    roleLabel: '导师',
    scopeLabel: '演示',
  },
  navigation: [],
  counts: { status: 'not_connected' },
  recent: { status: 'not_connected' },
  canSearch: false,
  isAdmin: false,
  role: 'mentor',
};

/** 读取路由的网络：每次请求挂起，测试按顺序给出响应。 */
function stubRoute() {
  const replies: ((body: unknown) => void)[] = [];
  const fetch = vi.fn<(url: string) => Promise<Response>>(
    () =>
      new Promise<Response>((resolve) =>
        replies.push((body) => resolve(Response.json(body))),
      ),
  );
  vi.stubGlobal('fetch', fetch);
  return { fetch, reply: (i: number, body: unknown) => replies[i]!(body) };
}

beforeEach(() => {
  queue.reset();
  vi.resetAllMocks();
  mocks.shell.mockResolvedValue(shell);
  mocks.read.mockResolvedValue({
    status: 'success',
    view: view([draft, other]),
    viewerName: '叶青',
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const card = () => document.getElementById('rc-demo-event-draft-a')!;

describe('生产接线：保存 → 撤销 → 再保存', () => {
  it('保存后的重读很慢：撤销照样立刻送到服务端，回到待确认，再保存用撤销回执的版本和新编号', async () => {
    const user = userEvent.setup();
    const route = stubRoute();
    mocks.save
      .mockResolvedValueOnce(saved('save-1', 'ev-1'))
      .mockResolvedValueOnce(saved('save-2', 'ev-2'));
    mocks.undo.mockResolvedValue(undone('save-1', 3));
    render(
      <ToastProvider>
        {await ReceiptRoute({
          searchParams: Promise.resolve({ id: 'demo-batch' }),
        })}
      </ToastProvider>,
    );
    expect(mocks.read).toHaveBeenCalledWith({ batchId: 'demo-batch' });

    await user.click(within(card()).getByRole('button', { name: '改分' }));
    await user.selectOptions(within(card()).getByRole('combobox'), '5');
    await user.type(within(card()).getByRole('textbox'), '两人合作');
    await user.click(
      within(card()).getByRole('button', { name: '保存并确认' }),
    );
    // 保存后的重读发出去了，一直没回
    await waitFor(() => expect(route.fetch).toHaveBeenCalledTimes(1));
    expect(route.fetch.mock.calls[0]![0]).toBe('/api/receipt/demo-batch');

    await user.click(await screen.findByRole('button', { name: '撤销' }));
    // 读取不在 Server Action 队列里：撤销不用等它
    await waitFor(() => expect(mocks.undo).toHaveBeenCalledTimes(1));
    expect(mocks.undo.mock.calls[0]![0]).toMatchObject({ saveId: 'save-1' });

    // 撤销后的重读：这件事回到待确认，版本 3
    await waitFor(() => expect(route.fetch).toHaveBeenCalledTimes(2));
    route.reply(1, {
      status: 'success',
      view: view([{ ...draft, revision: 3 }, other], [], 3),
    });
    // 保存后那次慢读取这时才回来：比已显示的快照发起得早，不采用
    route.reply(0, {
      status: 'success',
      view: view([other], [['demo-event-draft-a', 'ev-1']]),
    });
    await waitFor(() => expect(card().dataset.state).toBe('ai'));
    expect(
      (within(card()).getByRole('combobox') as HTMLSelectElement).value,
    ).toBe('5');

    await user.click(
      within(card()).getByRole('button', { name: '保存并确认' }),
    );
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    const [first, second] = mocks.save.mock.calls.map(([input]) => input);
    expect(second.expected_revision).toBe(3);
    expect(second.operation_id).not.toBe(first.operation_id);
    expect(second.decisions[0]).toMatchObject({ action: 'edit', value: 5 });
    await waitFor(() => expect(route.fetch).toHaveBeenCalledTimes(3));
    route.reply(2, {
      status: 'success',
      view: view([other], [['demo-event-draft-a', 'ev-2']], 3),
    });
    await waitFor(() => expect(card().dataset.state).toBe('confirmed'));
    expect(within(card()).getByText(/AI 原为/)).toBeTruthy();
  });

  it('对照：读取也走同一条 Server Action 队列时，慢读取会挡住撤销（这正是换成 GET 路由的原因）', async () => {
    const user = userEvent.setup();
    let release!: (value: unknown) => void;
    const slowRead = queue.serial(
      () => new Promise((resolve) => (release = resolve)),
    );
    mocks.save.mockResolvedValue(saved('save-1', 'ev-1'));
    mocks.undo.mockResolvedValue(undone('save-1', 3));
    const { saveRecordBatchAction } =
      await import('@/server/actions/record-batch');
    const { undoRecordAction } = await import('@/server/actions/record');
    render(
      <ToastProvider>
        <ReceiptPage
          batchId="demo-batch"
          initial={view([draft, other])}
          viewerName="叶青"
          actions={{
            read: slowRead as never,
            save: saveRecordBatchAction,
            undo: undoRecordAction,
          }}
        />
      </ToastProvider>,
    );
    await user.click(
      within(card()).getByRole('button', { name: /确认这件事/ }),
    );
    await user.click(await screen.findByRole('button', { name: '撤销' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.undo).not.toHaveBeenCalled();
    release({ status: 'unavailable' });
    await waitFor(() => expect(mocks.undo).toHaveBeenCalledTimes(1));
  });
});
