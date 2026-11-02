import {
  onSessionDraftsCleared,
  sessionDraftEpoch,
} from '@/lib/session-drafts';
import {
  clearBatchStash,
  clearRecordInputStash,
  restoreBatchInput,
  restoreInput,
  stashBatchInput,
  stashInput,
  takeHandoff,
} from './record-handoff';
import type { LoadAnchors, RecordActions } from './types';

type Input = { text: string; personId: string | null };

/**
 * 页面实例和会话绑定的唯一出入口（会话代纪门闸）。
 * 页面挂载时记下账号和会话代纪；`lib/session-drafts` 在退出、换账号登录时把代纪加一。
 * 代纪一变，这个页面实例永久失效。门闸在**改动发生的那一刻**核验，而不是在请求落定时：
 * - 改动的出口都经 `wrap` / `run`：页面的 dispatch、本地状态、提示、暂存读写删；
 *   请求落定后、页面续体执行前退出的，续体里的改动照样被拦下；
 * - 服务端动作：失效后不再发起；失效前发起的请求，落定时若已失效就不再交给页面；
 * - 计时器经 `timeout` 登记，失效（或页面卸载）时统一清除，到点回调同样经 `run`。
 * 页面只经这里调用动作与暂存、改状态，不在各条路径上各自检查。
 */
export function createSessionScope(
  accountId: string,
  epoch: number,
  actions: RecordActions,
  loadAnchors: LoadAnchors,
) {
  const live = () => epoch === sessionDraftEpoch();
  /** 只在会话仍有效时执行；所有改动的唯一出口。 */
  const run = <R>(fn: () => R): R | undefined => (live() ? fn() : undefined);
  const wrap =
    <A extends unknown[]>(fn: (...args: A) => unknown) =>
    (...args: A): void => {
      if (live()) fn(...args);
    };
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const clearTimers = () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
  /** 登记过的计时器：到点经 `run`，失效或卸载时统一清除。返回取消函数。 */
  function timeout(fn: () => void, ms: number) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run(fn);
    }, ms);
    timers.add(timer);
    return () => {
      clearTimeout(timer);
      timers.delete(timer);
    };
  }
  /** 页面挂载时调用：会话一结束就清掉计时器；返回的函数在卸载时调用。 */
  function attach() {
    const off = onSessionDraftsCleared(clearTimers);
    if (!live()) clearTimers();
    return () => {
      off();
      clearTimers();
    };
  }
  function gate<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
    return (...args: A) =>
      new Promise<R>((resolve, reject) => {
        if (!live()) return;
        let pending: Promise<R>;
        try {
          pending = fn(...args);
        } catch (error) {
          reject(error);
          return;
        }
        pending.then(
          (value) => {
            if (live()) resolve(value);
          },
          (error: unknown) => {
            if (live()) reject(error);
          },
        );
      });
  }
  const guard =
    <A extends unknown[], R>(fn: (...args: A) => R, fallback: R) =>
    (...args: A): R =>
      live() ? fn(...args) : fallback;
  return {
    accountId,
    live,
    run,
    wrap,
    timeout,
    attach,
    /** 提示经门闸：失效后不弹，返回的关闭函数是空操作。 */
    toast:
      <A extends unknown[]>(show: (...args: A) => () => void) =>
      (...args: A): (() => void) =>
        live() ? show(...args) : () => undefined,
    actions: {
      resolveNode: actions.resolveNode ? gate(actions.resolveNode) : null,
      submit: gate(actions.submit),
      readBatch: gate(actions.readBatch),
      save: gate(actions.save),
      undo: gate(actions.undo),
      loadSource: gate(actions.loadSource),
    } satisfies RecordActions,
    loadAnchors: gate(loadAnchors),
    drafts: {
      takeHandoff: guard(() => takeHandoff(accountId), null),
      restoreInput: guard(() => restoreInput(accountId), null),
      restoreBatchInput: guard(
        (batchId: string) => restoreBatchInput(accountId, batchId),
        null,
      ),
      stashInput: guard(
        (input: Input) => stashInput(accountId, input),
        undefined,
      ),
      stashBatchInput: guard(
        (batchId: string, input: Input) =>
          stashBatchInput(accountId, batchId, input),
        undefined,
      ),
      clearInput: guard(() => clearRecordInputStash(accountId), undefined),
      clearBatch: guard(() => clearBatchStash(accountId), undefined),
    },
  };
}

export type SessionScope = ReturnType<typeof createSessionScope>;
