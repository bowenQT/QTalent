// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/Toast';
import type { ShellData } from '@/contracts/shell';
import { LoginForm } from '@/features/auth/LoginForm';
import { AccountMenu } from '@/features/shell/AccountMenu';
import { copy } from './copy';
import { batchStashKey, HANDOFF_KEY, inputStashKey } from './record-handoff';
import {
  batch,
  dimensions,
  doneBatch,
  NODE,
  people,
  draft,
  receipt,
  TEXT,
} from './record.fixtures';
import { RecordPage, type RecordPageProps } from './RecordPage';
import type { RecordActions } from './types';

/**
 * 会话隔离（会话代纪门闸）。退出都经真实入口：账号菜单「退出登录」，换账号再经登录页。
 * 交错顺序：请求先落定 → 退出完成 → 页面（或子组件）续体再执行。会话一结束整棵子树卸掉，
 * 所以每种结局都断言：页面不再显示任何状态（不回到输入态，也不前进），没有提示，
 * 会话暂存不被写；「不删」用非空的同键暂存来证明。计时器用 fake timers，手动推进。
 */
const { replace, refresh } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
  usePathname: () => '/record',
}));

const account: ShellData['account'] = {
  id: 'acc-1',
  name: '演示导师',
  email: 'mentor@qtalent.test',
  roles: ['mentor'],
  hue: 20,
  roleLabel: '导师',
  scopeLabel: '演示范围',
};
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
type Deferred = ReturnType<typeof deferred<unknown>>;
const ok = <T,>(result: T) =>
  Promise.resolve({ status: 'success' as const, replayed: false, result });
const liveReceipt = () => ({
  ...receipt,
  savedAt: new Date().toISOString(),
  undoUntil: new Date(Date.now() + 5000).toISOString(),
});
const snapshot = () => JSON.stringify({ ...window.sessionStorage });
/** 让排队的微任务和定时器都跑完：续体一定已经执行过。 */
const drain = async () => {
  for (let i = 0; i < 5; i += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
};

let signOutResponse: Deferred;
function setup(
  actions: Partial<RecordActions>,
  over: Partial<RecordPageProps> = {},
) {
  const all = {
    resolveNode: vi.fn(async () => ({
      status: 'unique' as const,
      evaluationNodeId: NODE,
    })),
    submit: vi.fn(() => ok(batch())),
    readBatch: vi.fn(() => ok(doneBatch)),
    save: vi.fn(() => ok(liveReceipt())),
    undo: vi.fn(),
    loadSource: vi.fn(),
    ...actions,
  } as unknown as RecordActions;
  render(
    <ToastProvider>
      <AccountMenu account={account} />
      <RecordPage
        accountId="acc-1"
        accountName="演示导师"
        roleLabel="导师"
        people={people}
        projects={[]}
        dimensions={dimensions}
        loadAnchors={vi.fn(async () => ({}))}
        actions={all}
        {...over}
      />
    </ToastProvider>,
  );
  return all;
}

/** 点「退出登录」，退出请求挂起，由测试决定什么时候完成。 */
async function startSignOut() {
  await userEvent.click(
    screen.getByRole('button', { name: '账号：演示导师，导师' }),
  );
  await userEvent.click(screen.getByRole('menuitem', { name: '退出登录' }));
}
async function typeAndSubmit() {
  await userEvent.type(screen.getByRole('textbox'), TEXT);
  await userEvent.click(
    screen.getByRole('button', { name: copy.input.submit }),
  );
}
/** 会话结束后：页面子树已卸掉，没有提示条，也没有任何提示（toast）。 */
function expectEnded() {
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByText(copy.input.submitting)).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(document.querySelector('.nt-toasts')?.children.length ?? 0).toBe(0);
}
/**
 * 请求落定和退出完成排在同一轮：请求的落定先排队，页面续体在退出之后才轮到。
 * 退出本身清空全部暂存，所以之后暂存应当一直是空的：续体没有写回任何东西。
 * 「不删别人的暂存」由下面「旧账号的保存回执在新账号登录之后才到达」测。
 */
async function settleThenSignOut(finish: () => void) {
  window.sessionStorage.setItem(inputStashKey('acc-1'), '{"text":"甲"}');
  act(() => {
    finish();
    signOutResponse.resolve({ ok: true });
  });
  await drain();
  expect(replace).toHaveBeenCalledWith('/login');
  return '{}';
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  signOutResponse = deferred<unknown>();
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      url === '/api/auth/sign-out'
        ? signOutResponse.promise
        : Promise.resolve({ ok: true }),
    ),
  );
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('请求落定 → 退出完成 → 页面续体执行', () => {
  it('推导节点抛错：不回到输入态，不写也不删暂存', async () => {
    const node = deferred<never>();
    const actions = setup({ resolveNode: vi.fn(() => node.promise) });
    await typeAndSubmit();
    await startSignOut();
    const before = await settleThenSignOut(() =>
      node.reject(new Error('offline')),
    );
    expectEnded();
    expect(actions.submit).not.toHaveBeenCalled();
    expect(snapshot()).toBe(before);
  });

  it.each([
    [
      'forbidden',
      (d: Deferred) => d.resolve({ status: 'forbidden', message: '没有权限' }),
    ],
    ['抛错', (d: Deferred) => d.reject(new Error('offline'))],
    [
      '成功',
      (d: Deferred) =>
        d.resolve({ status: 'success', replayed: false, result: batch() }),
    ],
  ])('提交以%s结束：状态不变，不写也不删暂存', async (_, finish) => {
    const submit = deferred<unknown>();
    const actions = setup({ submit: vi.fn(() => submit.promise) as never });
    await typeAndSubmit();
    await waitFor(() => expect(actions.submit).toHaveBeenCalled());
    await startSignOut();
    const before = await settleThenSignOut(() => finish(submit));
    expectEnded();
    expect(actions.readBatch).not.toHaveBeenCalled();
    expect(snapshot()).toBe(before);
  });

  it('保存成功：不进入已保存，没有撤销提示，不删暂存', async () => {
    const save = deferred<unknown>();
    setup({ save: vi.fn(() => save.promise) as never });
    await typeAndSubmit();
    await userEvent.click(
      await screen.findByRole('button', { name: copy.actions.save }),
    );
    await startSignOut();
    const before = await settleThenSignOut(() =>
      save.resolve({
        status: 'success',
        replayed: false,
        result: liveReceipt(),
      }),
    );
    expectEnded();
    expect(screen.queryByText(/刚刚保存到/)).toBeNull();
    expect(snapshot()).toBe(before);
  });
});

/** 本账号的两份暂存，都非空：证明「没删」。 */
function seedSameKeys(text: string) {
  window.sessionStorage.setItem(
    inputStashKey('acc-1'),
    JSON.stringify({ accountId: 'acc-1', text, savedAt: Date.now() }),
  );
  window.sessionStorage.setItem(
    batchStashKey('acc-1'),
    JSON.stringify({ accountId: 'acc-1', text, savedAt: Date.now() }),
  );
}
async function toSaving() {
  await typeAndSubmit();
  await userEvent.click(
    await screen.findByRole('button', { name: copy.actions.save }),
  );
}

it('退出后同一账号重新登录，旧实例的保存回执才到：不删同键的新暂存，不弹提示', async () => {
  const save = deferred<unknown>();
  setup({ save: vi.fn(() => save.promise) as never });
  await toSaving();
  await startSignOut();
  await act(async () => signOutResponse.resolve({ ok: true }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  const login = render(<LoginForm />);
  await userEvent.type(screen.getByLabelText('邮箱'), 'mentor@qtalent.test');
  await userEvent.type(screen.getByLabelText('密码'), 'test-only-password');
  await userEvent.click(screen.getByRole('button', { name: '登录' }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/projects'));
  login.unmount();
  seedSameKeys('同一账号新会话的原话');
  window.sessionStorage.setItem(inputStashKey('acc-2'), '{"text":"乙"}');
  const before = snapshot();
  save.resolve({ status: 'success', replayed: false, result: liveReceipt() });
  await drain();
  expect(snapshot()).toBe(before);
  expectEnded();
});

it('同一账号离开本页后，迟到的保存回执：不清暂存，不弹提示（卸载即失效）', async () => {
  const save = deferred<unknown>();
  setup({ save: vi.fn(() => save.promise) as never });
  await toSaving();
  cleanup();
  render(
    <ToastProvider>
      <AccountMenu account={account} />
    </ToastProvider>,
  );
  seedSameKeys('别的页面写下的原话');
  const before = snapshot();
  save.resolve({ status: 'success', replayed: false, result: liveReceipt() });
  await drain();
  expect(snapshot()).toBe(before);
  expect(document.querySelector('.nt-toasts')?.children.length).toBe(0);
});

it('保存回执的保存人不是本页账号：丢弃，不进入已保存', async () => {
  setup({
    save: vi.fn(() => ok({ ...liveReceipt(), savedBy: 'acc-2' })) as never,
  });
  await toSaving();
  await drain();
  expect(screen.queryByText(/刚刚保存到/)).toBeNull();
  expect(screen.getByText(copy.actions.saving)).toBeTruthy();
});

describe('子组件：请求落定 → 退出完成 → 子组件续体执行', () => {
  const otherRef = {
    fragmentId: 'frag-1',
    originalVersionId: 'ver-1',
    location: { kind: 'document' as const, paragraph: '第 2 段' },
  };
  const citedDraft = {
    ...draft,
    sourceReferences: [...draft.sourceReferences, otherRef],
    scores: draft.scores.map((score, index) =>
      index === 0 && score.state === 'suggested'
        ? {
            ...score,
            citations: [
              ...score.citations,
              {
                kind: 'source' as const,
                quote: '来源里的话',
                reference: otherRef,
              },
            ],
          }
        : score,
    ),
  };

  it('来源卡：原文读回来时已退出，不显示原文', async () => {
    const source = deferred<unknown>();
    const loadSource = vi.fn(() => source.promise);
    setup({
      readBatch: vi.fn(() => ok(batch({ drafts: [citedDraft] }))) as never,
      loadSource: loadSource as never,
    });
    await typeAndSubmit();
    await userEvent.hover(
      await screen.findByRole('button', { name: /^引用 1/ }),
    );
    await waitFor(() => expect(loadSource).toHaveBeenCalled());
    await startSignOut();
    await settleThenSignOut(() =>
      source.resolve({
        status: 'success',
        source: {
          ...otherRef,
          excerpt: '来源里的一句话',
          originalTitle: '演示材料.docx',
          recordedByName: null,
          sourceType: 'document',
          sourceCategory: 'original',
          demo: true,
        },
      }),
    );
    expect(screen.queryByText('来源里的一句话')).toBeNull();
    expectEnded();
  });

  it('撤销提示：撤销结果回来时已退出，不进入「已撤销」，提示一并收起', async () => {
    const undo = deferred<unknown>();
    setup({ undo: vi.fn(() => undo.promise) as never });
    await toSaving();
    await userEvent.click(await screen.findByRole('button', { name: '撤销' }));
    await startSignOut();
    await settleThenSignOut(() =>
      undo.resolve({
        status: 'success',
        replayed: false,
        result: {
          saveId: 'save-1',
          withdrawnEvents: [{ personId: 'p1', eventId: 'ev-1' }],
          withdrawnConfirmationIds: [],
          withdrawnReviewItemIds: [],
          inputRestoration: 'unavailable',
          originalInput: null,
        },
      }),
    );
    expect(screen.queryByText(copy.saved.undone)).toBeNull();
    expectEnded();
  });

  it('批次轮询：回执回来时已退出，不写状态，也不再安排下一次读取', async () => {
    const read = deferred<unknown>();
    const readBatch = vi.fn(() => read.promise);
    setup({ readBatch: readBatch as never });
    await typeAndSubmit();
    await waitFor(() => expect(readBatch).toHaveBeenCalledTimes(1));
    await startSignOut();
    await settleThenSignOut(() =>
      read.resolve({ status: 'success', replayed: false, result: batch() }),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    });
    expect(readBatch).toHaveBeenCalledTimes(1);
    expectEnded();
  });
});

describe('计时器（fake timers，手动推进）', () => {
  // Testing Library 只认 jest 的假计时器：给它一个按 vitest 推进时间的入口
  beforeEach(() => {
    vi.stubGlobal('jest', {
      advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
    });
    vi.useFakeTimers();
  });
  const user = () =>
    userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
  async function signOutNow() {
    await user().click(
      screen.getByRole('button', { name: '账号：演示导师，导师' }),
    );
    await user().click(screen.getByRole('menuitem', { name: '退出登录' }));
    await act(async () => signOutResponse.resolve({ ok: true }));
  }

  it('防抖：没退出时到点写入；退出后到点不写回', async () => {
    setup({});
    await user().type(screen.getByRole('textbox'), '写到一半');
    // 对照：时间不推进就不写，推进到点才写，说明计时器确实由测试推进
    expect(window.sessionStorage.getItem(inputStashKey('acc-1'))).toBeNull();
    await act(async () => vi.advanceTimersByTime(400));
    expect(
      window.sessionStorage.getItem(inputStashKey('acc-1')),
    ).not.toBeNull();
    await user().type(screen.getByRole('textbox'), '，又写了一句');
    await signOutNow();
    expect(snapshot()).toBe('{}');
    // 跳到登录页之前页面若还在，用户还能接着打字：新安排的防抖到点也不能写回
    const box = screen.queryByRole('textbox');
    if (box) await user().type(box, '退出后又打的字');
    await act(async () => vi.advanceTimersByTime(1000));
    expect(snapshot()).toBe('{}');
    expectEnded();
  });

  it('工作台交接的自动整理：退出后到点不推导、不提交', async () => {
    window.sessionStorage.setItem(
      HANDOFF_KEY,
      JSON.stringify({ accountId: 'acc-1', text: TEXT, savedAt: Date.now() }),
    );
    const actions = setup({}, { entry: { handoff: true } });
    await act(async () => vi.advanceTimersByTime(0));
    expect(screen.getByRole('textbox')).toBeTruthy();
    await signOutNow();
    await act(async () => vi.advanceTimersByTime(2000));
    expect(actions.resolveNode).not.toHaveBeenCalled();
    expect(actions.submit).not.toHaveBeenCalled();
    expectEnded();
  });

  it('离开拦截：退出前拦，退出后不再拦', async () => {
    setup({});
    await user().type(screen.getByRole('textbox'), '写到一半');
    const before = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);
    await signOutNow();
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});
