/**
 * 会话暂存里的两份原话，都不进 URL，都限当前账号和 10 分钟：
 * 1. 工作台交接（841 定的接口）：`sessionStorage['niu-talent:draft:record'] = { accountId, text, savedAt }`，
 *    URL 只带 `draft=work`；本页读取后立即删除。
 * 2. 输入暂存（D19）：用户在本页输入的原话与所选人员，防抖写入，站内导航或刷新回来时恢复；
 *    开始整理或保存后删除。
 * 3. 批次原话：提交后按批次记下原话和所选人员，整理中刷新（`?batch=`）时恢复；只认同一批次。
 *    保存或回到输入后删除。原话不从服务端草稿里取，897 草稿不带原话。
 * 2、3 按账号分键（`…:<accountId>`），值里也带账号；工作台交接的键由 841 定，读后即删，值里带账号。
 * 退出登录或换账号登录时，`lib/session-drafts` 清掉全部 `niu-talent:` 暂存；页面只经
 * `session-scope` 读写这些暂存，会话一变就不再读写。
 */
export const HANDOFF_KEY = 'niu-talent:draft:record';
export const INPUT_STASH_KEY = 'niu-talent:record-input';
export const BATCH_STASH_KEY = 'niu-talent:record-batch';
export const STASH_TTL_MS = 10 * 60 * 1000;

/** 本页的两份暂存按账号分键：一个账号的写入或删除碰不到另一个账号的暂存。 */
export const inputStashKey = (accountId: string) =>
  `${INPUT_STASH_KEY}:${accountId}`;
export const batchStashKey = (accountId: string) =>
  `${BATCH_STASH_KEY}:${accountId}`;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStore(): Store | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    // 隐私模式等：当作没有暂存，不报错
    return null;
  }
}

function toMillis(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function read(
  store: Store,
  key: string,
  accountId: string,
  now: number,
): { text: string; personId: string | null; batchId: string | null } | null {
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    const savedAt = toMillis(record.savedAt);
    if (
      record.accountId !== accountId ||
      savedAt === null ||
      now - savedAt > STASH_TTL_MS ||
      now < savedAt ||
      typeof record.text !== 'string' ||
      record.text.trim() === ''
    )
      return null;
    return {
      text: record.text,
      personId: typeof record.personId === 'string' ? record.personId : null,
      batchId: typeof record.batchId === 'string' ? record.batchId : null,
    };
  } catch {
    return null;
  }
}

function remove(store: Store, key: string) {
  try {
    store.removeItem(key);
  } catch {
    // 删除失败时过期规则仍会让它失效
  }
}

/** 读取工作台交接的原话并立即删除；账号不符、超时、损坏都丢弃。 */
export function takeHandoff(
  accountId: string,
  now: number = Date.now(),
  store: Store | null = defaultStore(),
): string | null {
  if (!store) return null;
  const found = read(store, HANDOFF_KEY, accountId, now);
  remove(store, HANDOFF_KEY);
  return found?.text ?? null;
}

/** 防抖写入的输入暂存（本账号的键）。空内容等于删除。 */
export function stashInput(
  accountId: string,
  input: { text: string; personId: string | null },
  now: number = Date.now(),
  store: Store | null = defaultStore(),
) {
  if (!store) return;
  const key = inputStashKey(accountId);
  if (input.text.trim() === '') {
    remove(store, key);
    return;
  }
  try {
    store.setItem(
      key,
      JSON.stringify({
        accountId,
        text: input.text,
        personId: input.personId,
        savedAt: now,
      }),
    );
  } catch {
    // 写入失败（容量或隐私模式）时输入仍在页面里，只是少了一层保护
  }
}

/** 回到本页时恢复输入暂存；读取后保留，直到开始整理或保存。 */
export function restoreInput(
  accountId: string,
  now: number = Date.now(),
  store: Store | null = defaultStore(),
): { text: string; personId: string | null } | null {
  if (!store) return null;
  const key = inputStashKey(accountId);
  const found = read(store, key, accountId, now);
  if (!found) {
    remove(store, key);
    return null;
  }
  return { text: found.text, personId: found.personId };
}

/** 提交成功后记下这个批次的原话（本账号的键）。 */
export function stashBatchInput(
  accountId: string,
  batchId: string,
  input: { text: string; personId: string | null },
  now: number = Date.now(),
  store: Store | null = defaultStore(),
) {
  if (!store) return;
  try {
    store.setItem(
      batchStashKey(accountId),
      JSON.stringify({ accountId, batchId, ...input, savedAt: now }),
    );
  } catch {
    // 写入失败时刷新后原话一栏写「原话只在提交的那一页」，整理结果不受影响
  }
}

/** 整理中刷新回来时恢复同一批次的原话；别的批次、超时都不认。 */
export function restoreBatchInput(
  accountId: string,
  batchId: string,
  now: number = Date.now(),
  store: Store | null = defaultStore(),
): { text: string; personId: string | null } | null {
  if (!store) return null;
  const key = batchStashKey(accountId);
  const found = read(store, key, accountId, now);
  // 超时或损坏的暂存不再有用，读到就删；同账号的别的批次留给它自己。
  if (!found) remove(store, key);
  if (!found || found.batchId !== batchId) return null;
  return { text: found.text, personId: found.personId };
}

/** 只删这个账号的两份暂存。 */
export function clearRecordInputStash(
  accountId: string,
  store: Store | null = defaultStore(),
) {
  if (!store) return;
  remove(store, inputStashKey(accountId));
  remove(store, batchStashKey(accountId));
}

export function clearBatchStash(
  accountId: string,
  store: Store | null = defaultStore(),
) {
  if (store) remove(store, batchStashKey(accountId));
}
