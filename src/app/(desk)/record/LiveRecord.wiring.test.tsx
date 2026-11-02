// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/Toast';
import { materialBatchReadResultSchema } from '@/contracts/materials';
import {
  recordSaveInputSchema,
  recordSaveResultSchema,
  recordUndoInputSchema,
  recordUndoResultSchema,
  RECORD_UNDO_WINDOW_MS,
} from '@/contracts/record';
import { copy } from '@/features/record/copy';
import {
  batch,
  dimensions,
  draft,
  NODE,
  people,
  TEXT,
} from '@/features/record/record.fixtures';

/**
 * 生产 /record 的接线组合测试（H3）：挂真实的 LiveRecord → RecordPage，只替换服务端边界——
 * 写操作的 Server Action 模块，以及读取用的 GET 路由（fetch）。回执按合同校验后才交给页面。
 */
const server = vi.hoisted(() => ({
  submit: vi.fn(),
  save: vi.fn(),
  undo: vi.fn(),
  resolveNode: vi.fn(),
  readAction: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: server.replace }),
}));
vi.mock('@/server/actions/record-arrange', () => ({
  startRecordArrangeAction: server.submit,
}));
vi.mock('@/server/actions/record', () => ({
  saveRecordAction: vi.fn(),
  undoRecordAction: server.undo,
}));
vi.mock('@/server/actions/record-batch', () => ({
  // 读取不应再走 Server Action：被调用就说明读取又排进了写操作的队列
  readRecordAnchorsAction: server.readAction,
  readRecordBatchAction: server.readAction,
  readRecordSourceAction: server.readAction,
  resolveRecordNodeAction: server.resolveNode,
  saveRecordBatchAction: server.save,
}));
import { LiveRecord } from './LiveRecord';

/** 服务端的一份草稿账本：保存、撤销各推进一次版本，事件编号逐次递增。 */
function fakeServer() {
  let revision = draft.revision;
  let saves = 0;
  let confirmed: { saveId: string; revision: number } | null = null;
  const receipts = new Map<string, ReturnType<typeof saveResult>>();
  function saveResult(input: unknown) {
    const parsed = recordSaveInputSchema.parse(input);
    if (parsed.expected_revision !== revision || confirmed)
      return recordSaveResultSchema.parse({
        status: 'conflict',
        message: '这件事有了新版本',
        input,
      });
    saves += 1;
    revision += 1;
    const savedAt = Date.now();
    confirmed = { saveId: `save-${saves}`, revision };
    return recordSaveResultSchema.parse({
      status: 'success',
      replayed: false,
      result: {
        saveId: confirmed.saveId,
        events: [{ personId: 'p1', eventId: `ev-${saves}` }],
        revision,
        confirmationIds: [`c-${saves}`],
        reviewItemIds: [],
        savedBy: 'acc-1',
        savedAt: new Date(savedAt).toISOString(),
        undoUntil: new Date(savedAt + RECORD_UNDO_WINDOW_MS).toISOString(),
      },
    });
  }
  server.save.mockImplementation(async (input: unknown) => {
    const result = saveResult(input);
    if (result.status === 'success') receipts.set(result.result.saveId, result);
    return result;
  });
  server.undo.mockImplementation(async (input: unknown) => {
    const { saveId } = recordUndoInputSchema.parse(input);
    if (!receipts.has(saveId) || confirmed?.saveId !== saveId)
      return recordUndoResultSchema.parse({
        status: 'not_found',
        message: '找不到这次保存',
      });
    revision += 1;
    confirmed = null;
    return recordUndoResultSchema.parse({
      status: 'success',
      replayed: false,
      result: {
        saveId,
        withdrawnEvents: [{ personId: 'p1', eventId: `ev-${saves}` }],
        withdrawnConfirmationIds: [`c-${saves}`],
        withdrawnReviewItemIds: [],
        draftRestoration: {
          status: 'available',
          draftId: draft.draftId,
          draftRevision: revision,
        },
        inputRestoration: 'unavailable',
        originalInput: null,
      },
    });
  });
  return {
    batchRead: () =>
      materialBatchReadResultSchema.parse({
        status: 'success',
        replayed: false,
        result: batch({ drafts: [{ ...draft, revision }], revision: 3 }),
      }),
  };
}

type Route = (url: URL) => Promise<Response> | Response | null;
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
function stubReads(routes: Route) {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://app.test');
    const response = await routes(url);
    if (!response) throw new Error(`unexpected read ${url.pathname}`);
    return response;
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function mount() {
  return render(
    <ToastProvider>
      <LiveRecord
        accountId="acc-1"
        accountName="演示导师"
        roleLabel="导师"
        people={people}
        projects={[]}
        dimensions={dimensions}
      />
    </ToastProvider>,
  );
}

const click = (name: string | RegExp) =>
  userEvent.click(screen.getByRole('button', { name }));

async function toReview() {
  await userEvent.type(screen.getByRole('textbox'), TEXT);
  await click(copy.input.submit);
  await screen.findByRole('textbox', { name: copy.sbi.title });
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/record');
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  for (const mock of Object.values(server)) mock.mockReset();
  server.resolveNode.mockResolvedValue({
    status: 'unique',
    evaluationNodeId: NODE,
  });
  server.submit.mockResolvedValue({
    status: 'success',
    replayed: false,
    result: batch(),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('/record 接线：保存 → 撤销 → 再保存', () => {
  it('读取走 GET 路由；撤销后用回执给的版本再保存，第二次保存拿到新的事件', async () => {
    const fake = fakeServer();
    const reads = stubReads((url) =>
      url.pathname === '/api/record/batches/batch-1'
        ? json(fake.batchRead())
        : url.pathname === '/api/record/anchors'
          ? json([])
          : null,
    );
    mount();
    await toReview();
    await click(copy.actions.save);
    await screen.findByRole('button', { name: '撤销' });
    expect(server.save.mock.calls[0]?.[0]).toMatchObject({
      expected_revision: draft.revision,
    });
    await click('撤销');
    expect(await screen.findByText(copy.saved.undone)).toBeTruthy();
    await click(copy.actions.save);
    await waitFor(() => expect(server.save).toHaveBeenCalledTimes(2));
    const [first, second] = server.save.mock.calls.map((call) =>
      recordSaveInputSchema.parse(call[0]),
    );
    // 846：保存 +1、撤销 +1，再保存用撤销回执的版本，并换新的 operation_id
    expect(second?.expected_revision).toBe(draft.revision + 2);
    expect(second?.operation_id).not.toBe(first?.operation_id);
    expect((await server.save.mock.results[1]?.value).result).toMatchObject({
      saveId: 'save-2',
      revision: draft.revision + 3,
      events: [{ personId: 'p1', eventId: 'ev-2' }],
    });
    await waitFor(() =>
      expect(document.querySelector('.n-event__sign')).not.toBeNull(),
    );
    expect(server.readAction).not.toHaveBeenCalled();
    expect(
      reads.mock.calls.some(([url]) =>
        String(url).startsWith('/api/record/batches/'),
      ),
    ).toBe(true);
  });

  it('读取一直悬着时，撤销仍在窗口内完成：读取不和撤销排同一个队列', async () => {
    const fake = fakeServer();
    // 锚点读取一直不返回（模拟慢读取先发出）
    const reads = stubReads((url) =>
      url.pathname === '/api/record/batches/batch-1'
        ? json(fake.batchRead())
        : url.pathname === '/api/record/anchors'
          ? new Promise<Response>(() => {})
          : null,
    );
    mount();
    await toReview();
    await click(copy.actions.save);
    await screen.findByRole('button', { name: '撤销' });
    expect(
      reads.mock.calls.some(([url]) =>
        String(url).startsWith('/api/record/anchors'),
      ),
    ).toBe(true);
    const clickedAt = Date.now();
    await click('撤销');
    expect(await screen.findByText(copy.saved.undone)).toBeTruthy();
    expect(server.undo).toHaveBeenCalledTimes(1);
    expect(Date.now() - clickedAt).toBeLessThan(RECORD_UNDO_WINDOW_MS);
    expect(server.readAction).not.toHaveBeenCalled();
  });
});
