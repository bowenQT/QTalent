import { expect, it } from 'vitest';
import { clearSessionDrafts, sessionDraftEpoch } from './session-drafts';

function memory(initial: Record<string, string>) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() {
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => void data.delete(key),
  };
}

it('removes every niu-talent draft and leaves other keys', () => {
  const store = memory({
    'niu-talent:record-batch': 'a',
    'niu-talent:draft:staffing': 'b',
    other: 'c',
  });
  const before = sessionDraftEpoch();
  clearSessionDrafts(store);
  expect([...store.data.keys()]).toEqual(['other']);
  // Later answers of requests started before this can tell they are stale.
  expect(sessionDraftEpoch()).toBe(before + 1);
});

it('tolerates missing or blocked storage', () => {
  expect(() => clearSessionDrafts(null)).not.toThrow();
  const blocked = {
    length: 1,
    key: () => {
      throw new Error('blocked');
    },
    removeItem: () => undefined,
  };
  expect(() => clearSessionDrafts(blocked)).not.toThrow();
});
