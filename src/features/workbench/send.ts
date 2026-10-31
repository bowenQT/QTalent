/**
 * Where the workbench input sends a sentence, and how the sentence gets there.
 *
 * Handoff to the record page (BOW-847) and find-people page (BOW-853): the text never
 * goes into the URL, because it is a remark about a person and would stay in access
 * logs and browser history. It is written to
 *   sessionStorage['niu-talent:draft:record' | 'niu-talent:draft:staffing']
 *     = JSON { accountId: string, text: string, savedAt: number (epoch ms) }
 * and the URL only carries `draft=work`. The receiving page reads the entry, deletes it
 * at once, and drops it when `accountId` is not the signed-in account or it is older
 * than ten minutes (DRAFT_TTL_MS).
 */
export type SendTarget = 'record' | 'staffing';

export const DRAFT_TTL_MS = 10 * 60 * 1000;
export const draftKey = (target: SendTarget) => `niu-talent:draft:${target}`;
export const MAX_INPUT_LENGTH = 600;

const askFind = /找|owner|负责人|谁来|人选/;
// The manager's box is mainly for finding people: without a find word it still finds,
// unless the sentence plainly records something that just happened.
const justHappened = /(今天|昨天|这周|刚才|刚刚)/;

export function sendTarget(
  text: string,
  entries: { record: boolean; findPeople: boolean },
  findFirst: boolean,
): SendTarget | null {
  const wantsFind = findFirst
    ? askFind.test(text) || !justHappened.test(text)
    : askFind.test(text);
  if (entries.findPeople && (wantsFind || !entries.record)) return 'staffing';
  return entries.record ? 'record' : null;
}

export function sendHref(target: SendTarget): string {
  return target === 'staffing'
    ? `/staffing?${new URLSearchParams({ new: '1', draft: 'work' })}`
    : `/record?${new URLSearchParams({ draft: 'work' })}`;
}

export function recordForPersonHref(personId: string): string {
  return `/record?${new URLSearchParams({ person: personId })}`;
}

export function personHref(personId: string): string {
  return `/person?${new URLSearchParams({ id: personId })}`;
}

/** Returns false when the browser refuses storage (private mode, quota): do not navigate. */
export function saveDraft(
  storage: Pick<Storage, 'setItem'> | null,
  target: SendTarget,
  draft: { accountId: string; text: string; savedAt: number },
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(draftKey(target), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function sessionStorageOrNull(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
