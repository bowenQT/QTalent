// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/Toast';
import type { ShellData } from '@/contracts/shell';
import { LoginForm } from '@/features/auth/LoginForm';
import { AccountMenu } from '@/features/shell/AccountMenu';
import { copy } from './copy';
import { batchStashKey, inputStashKey } from './record-handoff';
import {
  batch,
  dimensions,
  doneBatch,
  NODE,
  people,
  receipt,
  TEXT,
} from './record.fixtures';
import { RecordPage } from './RecordPage';
import type { RecordActions } from './types';

/**
 * 会话隔离（会话代纪门闸）：都经真实的退出入口（账号菜单「退出登录」，以及登录页）触发，
 * 不直接调用清理函数。每种情况都断言：页面状态不回到输入态，会话暂存既不被写，也不被删。
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
const ok = <T,>(result: T) =>
  Promise.resolve({ status: 'success' as const, replayed: false, result });
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const snapshot = () => JSON.stringify({ ...window.sessionStorage });
const settle = () => new Promise((resolve) => setTimeout(resolve, 600));

function setup(actions: Partial<RecordActions>) {
  const all = {
    resolveNode: vi.fn(async () => ({
      status: 'unique' as const,
      evaluationNodeId: NODE,
    })),
    submit: vi.fn(() => ok(batch())),
    readBatch: vi.fn(() => ok(doneBatch)),
    save: vi.fn(() =>
      ok({
        ...receipt,
        savedAt: new Date().toISOString(),
        undoUntil: new Date(Date.now() + 5000).toISOString(),
      }),
    ),
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
      />
    </ToastProvider>,
  );
  return all;
}

async function signOut() {
  await userEvent.click(
    screen.getByRole('button', { name: '账号：演示导师，导师' }),
  );
  await userEvent.click(screen.getByRole('menuitem', { name: '退出登录' }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
}
async function typeAndSubmit() {
  await userEvent.type(screen.getByRole('textbox'), TEXT);
  await userEvent.click(
    screen.getByRole('button', { name: copy.input.submit }),
  );
}
/** 仍停在提交中：输入框只读、按钮写「提交中…」，没有任何提示条。 */
function expectStillSubmitting() {
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).readOnly).toBe(
    true,
  );
  expect(screen.getByText(copy.input.submitting)).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('退出时整理请求还在途', () => {
  it('推导节点抛错：不回到输入态，不写也不删暂存', async () => {
    const node = deferred<never>();
    const actions = setup({ resolveNode: vi.fn(() => node.promise) });
    await typeAndSubmit();
    await signOut();
    window.sessionStorage.setItem(inputStashKey('acc-2'), '{"text":"乙"}');
    const before = snapshot();
    node.reject(new Error('offline'));
    await settle();
    expectStillSubmitting();
    expect(actions.submit).not.toHaveBeenCalled();
    expect(snapshot()).toBe(before);
  });

  it.each([
    [
      'forbidden',
      (d: ReturnType<typeof deferred<unknown>>) =>
        d.resolve({ status: 'forbidden', message: '没有权限' }),
    ],
    [
      '抛错',
      (d: ReturnType<typeof deferred<unknown>>) =>
        d.reject(new Error('offline')),
    ],
    [
      '成功',
      (d: ReturnType<typeof deferred<unknown>>) =>
        d.resolve({ status: 'success', replayed: false, result: batch() }),
    ],
  ])('提交以%s结束：不回到输入态，不写也不删暂存', async (_, finish) => {
    const submit = deferred<unknown>();
    const actions = setup({
      submit: vi.fn(() => submit.promise) as never,
    });
    await typeAndSubmit();
    await waitFor(() => expect(actions.submit).toHaveBeenCalled());
    await signOut();
    window.sessionStorage.setItem(inputStashKey('acc-2'), '{"text":"乙"}');
    const before = snapshot();
    finish(submit);
    await settle();
    expectStillSubmitting();
    expect(actions.readBatch).not.toHaveBeenCalled();
    expect(snapshot()).toBe(before);
  });
});

it('旧账号的保存回执在新账号登录之后才到达：不删新账号的暂存，页面不变', async () => {
  const save = deferred<unknown>();
  setup({ save: vi.fn(() => save.promise) as never });
  await typeAndSubmit();
  const saveButton = await screen.findByRole('button', {
    name: copy.actions.save,
  });
  await userEvent.click(saveButton);
  await signOut();
  // 同一标签页里换账号登录（登录页也会清一次）
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
  save.resolve({
    status: 'success',
    replayed: false,
    result: {
      ...receipt,
      savedAt: new Date().toISOString(),
      undoUntil: new Date(Date.now() + 5000).toISOString(),
    },
  });
  await settle();
  expect(snapshot()).toBe(before);
  expect(screen.queryByText(/刚刚保存到/)).toBeNull();
  expect(screen.getByText(copy.actions.saving)).toBeTruthy();
});

it('防抖在退出之后才触发：不把旧账号的原话写回', async () => {
  setup({});
  await userEvent.type(screen.getByRole('textbox'), '写到一半');
  await signOut();
  await settle();
  expect(window.sessionStorage.getItem(inputStashKey('acc-1'))).toBeNull();
  expect(snapshot()).toBe('{}');
});
