/**
 * Receiving end of the workbench handoff (BOW-841, src/features/workbench/send.ts): the
 * sentence typed on the workbench waits in sessionStorage under this key as
 * { accountId, text, savedAt }, and the URL only carries `draft=work`. It is read once and
 * deleted at once; another account's entry, or one older than ten minutes, is dropped.
 */
export const STAFFING_DRAFT_KEY = 'niu-talent:draft:staffing';
export const DRAFT_TTL_MS = 10 * 60 * 1000;

type DraftStorage = Pick<Storage, 'getItem' | 'removeItem'>;

export function takeDraft(
  storage: DraftStorage | null,
  accountId: string,
  now: number,
): string | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(STAFFING_DRAFT_KEY);
    storage.removeItem(STAFFING_DRAFT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== 'object' ||
      value === null ||
      !('accountId' in value) ||
      !('text' in value) ||
      !('savedAt' in value)
    )
      return null;
    const { accountId: owner, text, savedAt } = value;
    if (owner !== accountId || typeof text !== 'string') return null;
    if (typeof savedAt !== 'number' || now - savedAt > DRAFT_TTL_MS)
      return null;
    if (savedAt > now) return null;
    return text.trim() || null;
  } catch {
    return null;
  }
}

/** Whether a handed-over sentence is waiting, without taking it. */
export function hasDraft(storage: DraftStorage | null): boolean {
  try {
    return storage?.getItem(STAFFING_DRAFT_KEY) != null;
  } catch {
    return false;
  }
}

export function sessionStorageOrNull(): DraftStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
