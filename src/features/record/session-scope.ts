import { sessionDraftEpoch } from '@/lib/session-drafts';
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
 * 代纪一变，这个页面实例永久失效：
 * - 服务端动作：失效后不再发起；失效前发起的请求，结果无论成功、业务失败还是抛错，
 *   都不再交给页面（返回的 promise 不落定），后续分支一概不执行，状态不变；
 * - 会话暂存：读、写、删都成为空操作，旧页面碰不到新账号的暂存。
 * 回执契约不带账号，回执归属于发起它的这个实例（账号 + 代纪），由门闸丢弃。
 * 页面只经这里调用动作与暂存，不在各条路径上各自检查。
 */
export function createSessionScope(
  accountId: string,
  epoch: number,
  actions: RecordActions,
  loadAnchors: LoadAnchors,
) {
  const live = () => epoch === sessionDraftEpoch();
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
    live,
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
