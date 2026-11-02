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
  return parseDraft(raw, accountId, now);
}

/** The handed-over sentence, read without taking it (the project's page takes it). */
export function peekDraft(
  storage: Pick<Storage, 'getItem'> | null,
  accountId: string,
  now: number,
): string | null {
  try {
    return parseDraft(
      storage?.getItem(STAFFING_DRAFT_KEY) ?? null,
      accountId,
      now,
    );
  } catch {
    return null;
  }
}

function parseDraft(
  raw: string | null,
  accountId: string,
  now: number,
): string | null {
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

// The handoff is taken once and kept for this page load, so moving back to choose another
// project still finds it; a new sentence handed over later (or another account) replaces it.
let handoff: { accountId: string; text: string | null } | undefined;

/** Takes the handed-over sentence for the find-people page, keeping it for this page load. */
export function readHandoff(
  storage: DraftStorage | null,
  accountId: string,
  now: number,
): string | null {
  if (handoff?.accountId !== accountId || hasDraft(storage))
    handoff = { accountId, text: takeDraft(storage, accountId, now) };
  return handoff.text;
}

/** The sentence the find-people page would take, without taking it. */
export function peekHandoff(
  storage: DraftStorage | null,
  accountId: string,
  now: number,
): string | null {
  if (handoff?.accountId === accountId && !hasDraft(storage))
    return handoff.text;
  return peekDraft(storage, accountId, now);
}

/** Whether a handed-over sentence is waiting, without taking it. */
export function hasDraft(storage: DraftStorage | null): boolean {
  try {
    return storage?.getItem(STAFFING_DRAFT_KEY) != null;
  } catch {
    return false;
  }
}

/**
 * The sentence typed on a project's entry, kept for this tab only (sessionStorage), so a
 * reload or「回到输入框」finds it again; it never goes into the address or to the server.
 * One entry per project, owned by one account, cleared once the demand is confirmed.
 */
export const SENTENCE_KEY_PREFIX = 'niu-talent:staffing:sentence:';
type SentenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function readSentence(
  storage: SentenceStorage | null,
  projectId: string,
  accountId: string,
): string | null {
  try {
    const raw = storage?.getItem(SENTENCE_KEY_PREFIX + projectId);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== 'object' ||
      value === null ||
      !('accountId' in value) ||
      !('text' in value) ||
      value.accountId !== accountId ||
      typeof value.text !== 'string'
    )
      return null;
    return value.text || null;
  } catch {
    return null;
  }
}

/** Keeps the sentence for the project; an empty sentence removes the entry. */
export function keepSentence(
  storage: SentenceStorage | null,
  projectId: string,
  accountId: string,
  text: string,
) {
  try {
    if (!text.trim()) storage?.removeItem(SENTENCE_KEY_PREFIX + projectId);
    else
      storage?.setItem(
        SENTENCE_KEY_PREFIX + projectId,
        JSON.stringify({ accountId, text }),
      );
  } catch {
    // Storage full or blocked: the sentence stays only in the field.
  }
}

export function dropSentence(
  storage: SentenceStorage | null,
  projectId: string,
) {
  try {
    storage?.removeItem(SENTENCE_KEY_PREFIX + projectId);
  } catch {
    // Blocked storage holds nothing to drop.
  }
}

export function sessionStorageOrNull(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
