/**
 * Per-account drafts kept in sessionStorage (record text, staffing drafts) all use the
 * `niu-talent:` prefix. They are cleared when an account signs out or another one signs
 * in, so a shared browser keeps no text of the previous account. The epoch lets a page
 * drop a write that an older request answers after the clearing.
 */
export const SESSION_DRAFT_PREFIX = 'niu-talent:';

type Store = Pick<Storage, 'length' | 'key' | 'removeItem'>;

let epoch = 0;

export function sessionDraftEpoch() {
  return epoch;
}

export function clearSessionDrafts(store: Store | null = defaultStore()) {
  epoch += 1;
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key?.startsWith(SESSION_DRAFT_PREFIX)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
  } catch {
    // Storage blocked: nothing could have been written there either.
  }
}

function defaultStore(): Store | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
