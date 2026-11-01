// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DRAFT_TTL_MS,
  dropSentence,
  hasDraft,
  keepSentence,
  readSentence,
  SENTENCE_KEY_PREFIX,
  STAFFING_DRAFT_KEY,
  sessionStorageOrNull,
  takeDraft,
} from './draft';

const now = 1_800_000_000_000;
function storage(value: unknown) {
  const items = new Map<string, string>();
  if (value !== undefined)
    items.set(
      STAFFING_DRAFT_KEY,
      typeof value === 'string' ? value : JSON.stringify(value),
    );
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    removeItem: (key: string) => void items.delete(key),
  };
}
const entry = (overrides: Record<string, unknown> = {}) => ({
  accountId: 'me',
  text: '  找一个能带新人的牵头人 ',
  savedAt: now - 1000,
  ...overrides,
});

afterEach(() => vi.unstubAllGlobals());

describe('takeDraft', () => {
  it('returns the handed-over sentence once and deletes it', () => {
    const store = storage(entry());
    expect(takeDraft(store, 'me', now)).toBe('找一个能带新人的牵头人');
    expect(store.items.size).toBe(0);
    expect(takeDraft(store, 'me', now)).toBeNull();
  });

  it('drops another account’s entry, but still deletes it', () => {
    const store = storage(entry({ accountId: 'someone-else' }));
    expect(takeDraft(store, 'me', now)).toBeNull();
    expect(store.items.size).toBe(0);
  });

  it('drops stale, future, blank and malformed entries', () => {
    for (const value of [
      entry({ savedAt: now - DRAFT_TTL_MS - 1 }),
      entry({ savedAt: now + 1000 }),
      entry({ savedAt: String(now) }),
      entry({ text: '   ' }),
      entry({ text: 42 }),
      { accountId: 'me', text: 'x' },
      null,
      'not json',
    ])
      expect(takeDraft(storage(value), 'me', now)).toBeNull();
  });

  it('copes with no storage and with storage that throws', () => {
    expect(takeDraft(null, 'me', now)).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {},
    };
    expect(takeDraft(broken, 'me', now)).toBeNull();
  });
});

describe('hasDraft', () => {
  it('tells whether a sentence is waiting without taking it', () => {
    const store = storage(entry());
    expect(hasDraft(store)).toBe(true);
    expect(store.items.size).toBe(1);
    expect(hasDraft(storage(undefined))).toBe(false);
    expect(hasDraft(null)).toBe(false);
    expect(
      hasDraft({
        getItem: () => {
          throw new Error('blocked');
        },
        removeItem: () => {},
      }),
    ).toBe(false);
  });
});

describe('sessionStorageOrNull', () => {
  it('returns session storage, or null where reading it throws', () => {
    expect(sessionStorageOrNull()).toBe(window.sessionStorage);
    vi.stubGlobal('window', {
      get sessionStorage() {
        throw new Error('denied');
      },
    });
    expect(sessionStorageOrNull()).toBeNull();
  });
});

describe('sentence kept for the tab', () => {
  const key = SENTENCE_KEY_PREFIX + 'pr-1';
  const memory = () => {
    const items = new Map<string, string>();
    return {
      items,
      getItem: (name: string) => items.get(name) ?? null,
      setItem: (name: string, value: string) => void items.set(name, value),
      removeItem: (name: string) => void items.delete(name),
    };
  };
  const blocked = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('full');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
  };

  it('keeps, reads and drops the sentence of one project and account', () => {
    const store = memory();
    keepSentence(store, 'pr-1', 'me', '要一个负责人');
    expect(readSentence(store, 'pr-1', 'me')).toBe('要一个负责人');
    expect(readSentence(store, 'pr-1', 'someone-else')).toBeNull();
    expect(readSentence(store, 'pr-2', 'me')).toBeNull();
    keepSentence(store, 'pr-1', 'me', '  ');
    expect(store.items.has(key)).toBe(false);
    keepSentence(store, 'pr-1', 'me', '要一个负责人');
    dropSentence(store, 'pr-1');
    expect(store.items.size).toBe(0);
  });

  it('ignores what it cannot read and storage that refuses', () => {
    const store = memory();
    for (const raw of [
      '{',
      'null',
      '"text"',
      '{"accountId":"me"}',
      '{"accountId":"me","text":1}',
      '{"accountId":"me","text":""}',
    ]) {
      store.items.set(key, raw);
      expect(readSentence(store, 'pr-1', 'me')).toBeNull();
    }
    expect(readSentence(null, 'pr-1', 'me')).toBeNull();
    expect(readSentence(blocked, 'pr-1', 'me')).toBeNull();
    expect(() =>
      keepSentence(blocked, 'pr-1', 'me', '要一个负责人'),
    ).not.toThrow();
    expect(() => dropSentence(blocked, 'pr-1')).not.toThrow();
    expect(() =>
      keepSentence(null, 'pr-1', 'me', '要一个负责人'),
    ).not.toThrow();
  });
});
