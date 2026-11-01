import { describe, expect, it } from 'vitest';
import {
  HANDOFF_KEY,
  INPUT_STASH_KEY,
  STASH_TTL_MS,
  clearRecordInputStash,
  restoreInput,
  stashInput,
  takeHandoff,
} from './record-handoff';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}
const NOW = 1_800_000_000_000;
const handoff = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    accountId: 'acc-1',
    text: '工作台带来的原话',
    savedAt: NOW - 1000,
    ...over,
  });

describe('takeHandoff', () => {
  it('读到原话并立即删除', () => {
    const store = memory({ [HANDOFF_KEY]: handoff() });
    expect(takeHandoff('acc-1', NOW, store)).toBe('工作台带来的原话');
    expect(store.data.has(HANDOFF_KEY)).toBe(false);
  });

  it('savedAt 可以是时间戳或 ISO 时间', () => {
    const iso = new Date(NOW - 5000).toISOString();
    const store = memory({ [HANDOFF_KEY]: handoff({ savedAt: iso }) });
    expect(takeHandoff('acc-1', NOW, store)).toBe('工作台带来的原话');
  });

  it('账号不符、超过 10 分钟、时间在未来、内容为空、损坏都丢弃，也一并删除', () => {
    const cases = [
      handoff({ accountId: 'acc-2' }),
      handoff({ savedAt: NOW - STASH_TTL_MS - 1 }),
      handoff({ savedAt: NOW + 60_000 }),
      handoff({ text: '   ' }),
      handoff({ text: 42 }),
      handoff({ savedAt: 'not-a-date' }),
      handoff({ savedAt: null }),
      '{坏的',
      'null',
      '"字符串"',
    ];
    for (const raw of cases) {
      const store = memory({ [HANDOFF_KEY]: raw });
      expect(takeHandoff('acc-1', NOW, store)).toBeNull();
      expect(store.data.has(HANDOFF_KEY)).toBe(false);
    }
  });

  it('没有暂存或存储不可用时返回空，不报错', () => {
    expect(takeHandoff('acc-1', NOW, memory())).toBeNull();
    expect(takeHandoff('acc-1', NOW, null)).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => undefined,
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(takeHandoff('acc-1', NOW, broken)).toBeNull();
  });
});

describe('输入暂存', () => {
  it('写入后可恢复，恢复不删除，直到清除', () => {
    const store = memory();
    stashInput('acc-1', { text: '写到一半', personId: 'p1' }, NOW, store);
    expect(restoreInput('acc-1', NOW + 1000, store)).toEqual({
      text: '写到一半',
      personId: 'p1',
    });
    expect(store.data.has(INPUT_STASH_KEY)).toBe(true);
    clearRecordInputStash(store);
    expect(store.data.has(INPUT_STASH_KEY)).toBe(false);
  });

  it('空内容等于删除；换账号、过期的暂存读不到并被清掉', () => {
    const store = memory();
    stashInput('acc-1', { text: '内容', personId: null }, NOW, store);
    stashInput('acc-1', { text: '  ', personId: null }, NOW, store);
    expect(store.data.has(INPUT_STASH_KEY)).toBe(false);
    stashInput('acc-1', { text: '内容', personId: null }, NOW, store);
    expect(restoreInput('acc-2', NOW, store)).toBeNull();
    expect(store.data.has(INPUT_STASH_KEY)).toBe(false);
    stashInput('acc-1', { text: '内容', personId: null }, NOW, store);
    expect(restoreInput('acc-1', NOW + STASH_TTL_MS + 1, store)).toBeNull();
  });

  it('存储不可用或写入失败时不影响输入', () => {
    expect(() =>
      stashInput('acc-1', { text: 'x', personId: null }, NOW, null),
    ).not.toThrow();
    expect(restoreInput('acc-1', NOW, null)).toBeNull();
    expect(() => clearRecordInputStash(null)).not.toThrow();
    const full = {
      ...memory(),
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() =>
      stashInput('acc-1', { text: 'x', personId: null }, NOW, full),
    ).not.toThrow();
  });
});
