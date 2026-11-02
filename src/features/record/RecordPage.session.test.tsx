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
  receipt,
  TEXT,
} from './record.fixtures';
import { RecordPage, type RecordPageProps } from './RecordPage';
import type { RecordActions } from './types';

/**
 * 会话隔离（会话代纪门闸）。退出都经真实入口：账号菜单「退出登录」，换账号再经登录页。
 * 交错顺序：请求先落定 → 退出完成 → 页面续体再执行。每种结局都断言：状态不变（不回到输入态，
 * 也不前进），没有提示，会话暂存不被写也不被删。计时器用 fake timers 推进。
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
function expectStillSubmitting() {
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).readOnly).toBe(
    true,
  );
  expect(screen.getByText(copy.input.submitting)).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('status', { name: /保存/ })).toBeNull();
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
    expectStillSubmitting();
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
    expectStillSubmitting();
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
    expect(screen.getByText(copy.actions.saving)).toBeTruthy();
    expect(screen.queryByText(/刚刚保存到/)).toBeNull();
    expect(snapshot()).toBe(before);
  });
});

it('旧账号的保存回执在新账号登录之后才到达：不删新账号的暂存，页面不变', async () => {
  const save = deferred<unknown>();
  setup({ save: vi.fn(() => save.promise) as never });
  await typeAndSubmit();
  await userEvent.click(
    await screen.findByRole('button', { name: copy.actions.save }),
  );
  await startSignOut();
  await act(async () => signOutResponse.resolve({ ok: true }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  const login = render(<LoginForm />);
  await userEvent.type(screen.getByLabelText('邮箱'), 'hr@qtalent.test');
  await userEvent.type(screen.getByLabelText('密码'), 'test-only-password');
  await userEvent.click(screen.getByRole('button', { name: '登录' }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/projects'));
  login.unmount();
  window.sessionStorage.setItem(
    inputStashKey('acc-2'),
    JSON.stringify({ accountId: 'acc-2', text: '新账号的原话' }),
  );
  window.sessionStorage.setItem(
    batchStashKey('acc-2'),
    JSON.stringify({ accountId: 'acc-2', text: '新账号的批次' }),
  );
  const before = snapshot();
  save.resolve({ status: 'success', replayed: false, result: liveReceipt() });
  await drain();
  expect(snapshot()).toBe(before);
  expect(screen.queryByText(/刚刚保存到/)).toBeNull();
  expect(screen.getByText(copy.actions.saving)).toBeTruthy();
});

it('保存回执的保存人不是本页账号：丢弃，不进入已保存', async () => {
  setup({
    save: vi.fn(() => ok({ ...liveReceipt(), savedBy: 'acc-2' })) as never,
  });
  await typeAndSubmit();
  await userEvent.click(
    await screen.findByRole('button', { name: copy.actions.save }),
  );
  await drain();
  expect(screen.queryByText(/刚刚保存到/)).toBeNull();
  expect(screen.getByText(copy.actions.saving)).toBeTruthy();
});

describe('计时器（fake timers）', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  const user = () =>
    userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });

  it('防抖在退出之后才到点：不写回旧账号的原话，输入态不变', async () => {
    setup({});
    await user().type(screen.getByRole('textbox'), '写到一半');
    await user().click(
      screen.getByRole('button', { name: '账号：演示导师，导师' }),
    );
    await user().click(screen.getByRole('menuitem', { name: '退出登录' }));
    await act(async () => signOutResponse.resolve({ ok: true }));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(snapshot()).toBe('{}');
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
      '写到一半',
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('工作台交接的自动整理在退出之后才到点：不推导、不提交', async () => {
    window.sessionStorage.setItem(
      HANDOFF_KEY,
      JSON.stringify({ accountId: 'acc-1', text: TEXT, savedAt: Date.now() }),
    );
    const actions = setup({}, { entry: { handoff: true } });
    await user().click(
      screen.getByRole('button', { name: '账号：演示导师，导师' }),
    );
    await user().click(screen.getByRole('menuitem', { name: '退出登录' }));
    await act(async () => signOutResponse.resolve({ ok: true }));
    await act(async () => vi.advanceTimersByTime(2000));
    expect(actions.resolveNode).not.toHaveBeenCalled();
    expect(actions.submit).not.toHaveBeenCalled();
    expect(screen.getByText(copy.input.submit)).toBeTruthy();
  });

  it('退出之后的离开不再拦', async () => {
    setup({});
    await user().type(screen.getByRole('textbox'), '写到一半');
    const before = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);
    await user().click(
      screen.getByRole('button', { name: '账号：演示导师，导师' }),
    );
    await user().click(screen.getByRole('menuitem', { name: '退出登录' }));
    await act(async () => signOutResponse.resolve({ ok: true }));
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});
