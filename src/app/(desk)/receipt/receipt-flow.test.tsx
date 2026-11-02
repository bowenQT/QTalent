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
import { materialBatchReceiptSchema } from '@/contracts/materials';
import type { RecordBatchDraft } from '@/contracts/record';
import type { ShellData } from '@/contracts/shell';
import {
  materialReferencesFixture as refs,
  recordBatchDraftFixture,
} from '@/contracts/materials.fixtures';
import { copy } from '@/features/receipt/copy';
import { ReceiptPage } from '@/features/receipt/ReceiptPage';
import type { ReceiptView } from '@/features/receipt/types';
import ReceiptRoute from './page';

/*
 * H3：从真实入口走到目标动作。page.tsx → LiveReceipt → ReceiptPage 都是生产代码，只替换
 * 服务端查询、Server Action 和路由的网络。Next 默认把同一页的 Server Action 排成一条
 * 串行队列，这里用一条 promise 链给它建模：前一个 action 没返回，后一个不开始。
 * 保存和撤销的替身按契约 schema 校验入参和返回，不合契约的替身让用例直接失败。
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
/** 撤销替身：先校验入参，再按契约校验返回。撤销路由和（旧接线的）Server Action 共用它。 */
const serveUndo = vi.hoisted(() => async (input: unknown) => {
  const { recordUndoInputSchema, recordUndoResultSchema } =
    await import('@/contracts/record');
  recordUndoInputSchema.parse(input);
  return recordUndoResultSchema.parse(await mocks.undo(input));
});
vi.mock('@/server/queries/shell', () => ({ getShellPage: mocks.shell }));
vi.mock('@/server/queries/receipt-page', () => ({
  readReceiptForCurrentUser: mocks.read,
}));
vi.mock('@/server/actions/record-batch', async () => {
  const { recordSaveInputSchema, recordSaveResultSchema } =
    await import('@/contracts/record');
  return {
    saveRecordBatchAction: queue.serial(async (input: unknown) => {
      recordSaveInputSchema.parse(input);
      return recordSaveResultSchema.parse(await mocks.save(input));
    }),
  };
});
vi.mock('@/server/actions/record', () => ({
  undoRecordAction: queue.serial(serveUndo),
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
    receipt: materialBatchReceiptSchema.parse({
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
    }),
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
const saved = (
  saveId: string,
  eventId: string,
  draftId = 'demo-event-draft-a',
) => {
  const at = Date.now();
  return {
    status: 'success' as const,
    replayed: false,
    result: {
      saveId,
      events: [{ personId: 'demo-person', eventId }],
      revision: 2,
      confirmationIds: ['c-' + saveId + draftId],
      reviewItemIds: [],
      savedBy: 'acct',
      savedAt: new Date(at).toISOString(),
      undoUntil: new Date(at + 5000).toISOString(),
    },
  };
};
const undone = (saveId: string, draftRevision: number, replayed = false) => ({
  status: 'success' as const,
  replayed,
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

/**
 * 路由的网络。GET 读取：每次请求挂起，测试按顺序给出响应；POST 撤销：交给撤销替身，
 * 替身抛错时这次请求就是网络中断。
 */
function stubRoute() {
  const replies: ((body: unknown, status?: number) => void)[] = [];
  const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    (url, init) => {
      if (url === '/api/record/undo' && init?.method === 'POST')
        return serveUndo(JSON.parse(String(init.body))).then((body) =>
          Response.json(body),
        );
      return new Promise<Response>((resolve) =>
        replies.push((body, status = 200) =>
          resolve(Response.json(body, { status })),
        ),
      );
    },
  );
  vi.stubGlobal('fetch', fetch);
  const reads = () =>
    fetch.mock.calls.filter(([url]) => url.startsWith('/api/receipt/'));
  return {
    fetch,
    reads,
    reply: (i: number, body: unknown, status?: number) =>
      replies[i]!(body, status),
  };
}
/** 撤销替身的每次调用挂起，测试按顺序让它成功或网络中断。 */
function holdUndo() {
  const calls: { ok: (body: unknown) => void; drop: () => void }[] = [];
  mocks.undo.mockImplementation(
    () =>
      new Promise((ok, fail) =>
        calls.push({ ok, drop: () => fail(new Error('offline')) }),
      ),
  );
  return calls;
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
    await waitFor(() => expect(route.reads()).toHaveLength(1));
    expect(route.reads()[0]![0]).toBe('/api/receipt/demo-batch');

    await user.click(await screen.findByRole('button', { name: '撤销' }));
    // 读取不在 Server Action 队列里：撤销不用等它
    await waitFor(() => expect(mocks.undo).toHaveBeenCalledTimes(1));
    expect(route.fetch).toHaveBeenCalledWith(
      '/api/record/undo',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(mocks.undo.mock.calls[0]![0]).toMatchObject({ saveId: 'save-1' });

    // 撤销后的重读：这件事回到待确认，版本 3
    await waitFor(() => expect(route.reads()).toHaveLength(2));
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
    await waitFor(() => expect(route.reads()).toHaveLength(3));
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

describe('第二次裁决：撤销走路由、撤销结果按快照比对', () => {
  const cardB = () => document.getElementById('rc-demo-event-draft-b')!;
  async function mount() {
    render(
      <ToastProvider>
        {await ReceiptRoute({
          searchParams: Promise.resolve({ id: 'demo-batch' }),
        })}
      </ToastProvider>,
    );
  }

  it('用例 A：另一件事的保存很慢、占着 Server Action 队列：撤销照样立刻送到服务端并成功', async () => {
    const user = userEvent.setup();
    stubRoute();
    let releaseB!: (value: unknown) => void;
    mocks.save
      .mockResolvedValueOnce(saved('save-1', 'ev-1'))
      .mockImplementationOnce(
        () => new Promise((resolve) => (releaseB = resolve)),
      );
    mocks.undo.mockResolvedValue(undone('save-1', 3));
    await mount();
    await user.click(
      within(card()).getByRole('button', { name: /确认这件事/ }),
    );
    const undo = await screen.findByRole('button', { name: '撤销' });
    // 撤销窗口内，B 的保存发出去了，一直没回
    await user.click(
      within(cardB()).getByRole('button', { name: /确认这件事/ }),
    );
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    await user.click(undo);
    await waitFor(() => expect(mocks.undo).toHaveBeenCalledTimes(1));
    expect(mocks.undo.mock.calls[0]![0]).toMatchObject({ saveId: 'save-1' });
    expect(await screen.findByText(copy.toast.undone)).toBeTruthy();
    releaseB(saved('save-2', 'ev-2', 'demo-event-draft-b'));
  });

  it('用例 B：撤销结果待核实期间读到别处的再次确认，旧回放随后返回成功：卡片仍按快照显示已确认', async () => {
    const user = userEvent.setup();
    const route = stubRoute();
    const undos = holdUndo();
    mocks.save.mockResolvedValueOnce(saved('save-1', 'ev-1'));
    await mount();
    await user.click(
      within(card()).getByRole('button', { name: /确认这件事/ }),
    );
    // 保存后的读取：本页这次保存
    await waitFor(() => expect(route.reads()).toHaveLength(1));
    route.reply(0, {
      status: 'success',
      view: view([other], [['demo-event-draft-a', 'ev-1']], 2),
    });
    await user.click(await screen.findByRole('button', { name: '撤销' }));
    // 撤销其实生效了，回应丢了：结果待核实
    await waitFor(() => expect(undos).toHaveLength(1));
    undos[0]!.drop();
    await user.click(
      await within(card()).findByRole('button', { name: '再试一次撤销' }),
    );
    // 重试（同一个操作编号，服务端回放）的回应迟迟不回
    await waitFor(() => expect(undos).toHaveLength(2));
    const [first, second] = mocks.undo.mock.calls.map(([input]) => input);
    expect(second.operation_id).toBe(first.operation_id);
    // 这期间另一个标签页撤销后重新确认（新事件、新版本），本页联网恢复读到了它
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(route.reads()).toHaveLength(2));
    route.reply(1, {
      status: 'success',
      view: view([other], [['demo-event-draft-a', 'ev-2']], 4),
    });
    await waitFor(() =>
      expect(
        within(card()).queryByRole('button', { name: '再试一次撤销' }),
      ).toBeNull(),
    );
    expect(card().dataset.state).toBe('confirmed');
    // 旧的回放这时才回来：撤销的是 save-1，不说明快照里这次确认
    undos[1]!.ok(undone('save-1', 3, true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(card().dataset.state).toBe('confirmed');
    expect(screen.queryByText(copy.toast.undone)).toBeNull();
    expect(
      within(card()).queryByRole('button', { name: /确认这件事/ }),
    ).toBeNull();
    // 之后的读取失败：仍按上次的快照显示
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(route.reads()).toHaveLength(3));
    route.reply(2, { status: 'unavailable' }, 503);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(card().dataset.state).toBe('confirmed');
    expect(
      within(card()).queryByRole('button', { name: /确认这件事/ }),
    ).toBeNull();
    expect(await screen.findByText(copy.toast.undoSuperseded)).toBeTruthy();
  });
});
