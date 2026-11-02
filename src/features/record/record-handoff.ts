/**
 * 会话暂存里的两份原话，都不进 URL，都限当前账号和 10 分钟：
 * 1. 工作台交接（841 定的接口）：`sessionStorage['niu-talent:draft:record'] = { accountId, text, savedAt }`，
 *    URL 只带 `draft=work`；本页读取后立即删除。
 * 2. 输入暂存（D19）：用户在本页输入的原话与所选人员，防抖写入，站内导航或刷新回来时恢复；
 *    开始整理或保存后删除，退出登录时由外壳调用 clearRecordInputStash 一并清掉。
 */
export const HANDOFF_KEY = 'niu-talent:draft:record';
export const INPUT_STASH_KEY = 'niu-talent:record-input';
export const STASH_TTL_MS = 10 * 60 * 1000;

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
): { text: string; personId: string | null } | null {
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

/** 防抖写入的输入暂存。空内容等于删除。 */
export function stashInput(
  accountId: string,
  input: { text: string; personId: string | null },
  now: number = Date.now(),
  store: Store | null = defaultStore(),
) {
  if (!store) return;
  if (input.text.trim() === '') {
    remove(store, INPUT_STASH_KEY);
    return;
  }
  try {
    store.setItem(
      INPUT_STASH_KEY,
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
  const found = read(store, INPUT_STASH_KEY, accountId, now);
  if (!found) remove(store, INPUT_STASH_KEY);
  return found;
}

export function clearRecordInputStash(store: Store | null = defaultStore()) {
  if (store) remove(store, INPUT_STASH_KEY);
}
