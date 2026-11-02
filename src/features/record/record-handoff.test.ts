import { describe, expect, it } from 'vitest';
import {
  batchStashKey,
  HANDOFF_KEY,
  inputStashKey,
  STASH_TTL_MS,
  clearBatchStash,
  clearRecordInputStash,
  restoreBatchInput,
  restoreInput,
  stashBatchInput,
  stashInput,
  takeHandoff,
} from './record-handoff';

const IN1 = inputStashKey('acc-1');
const B1 = batchStashKey('acc-1');

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
    expect(store.data.has(IN1)).toBe(true);
    clearRecordInputStash('acc-1', store);
    expect(store.data.has(IN1)).toBe(false);
  });

  it('空内容等于删除；换账号、过期的暂存读不到并被清掉', () => {
    const store = memory();
    stashInput('acc-1', { text: '内容', personId: null }, NOW, store);
    stashInput('acc-1', { text: '  ', personId: null }, NOW, store);
    expect(store.data.has(IN1)).toBe(false);
    stashInput('acc-1', { text: '内容', personId: null }, NOW, store);
    // 别的账号读不到，也碰不到这个账号的键
    expect(restoreInput('acc-2', NOW, store)).toBeNull();
    expect(store.data.has(IN1)).toBe(true);
    expect(restoreInput('acc-1', NOW + STASH_TTL_MS + 1, store)).toBeNull();
    expect(store.data.has(IN1)).toBe(false);
    stashInput('acc-1', { text: '内容', personId: null }, NOW, store);
    expect(restoreInput('acc-1', NOW + STASH_TTL_MS + 1, store)).toBeNull();
  });

  it('存储不可用或写入失败时不影响输入', () => {
    expect(() =>
      stashInput('acc-1', { text: 'x', personId: null }, NOW, null),
    ).not.toThrow();
    expect(restoreInput('acc-1', NOW, null)).toBeNull();
    expect(() => clearRecordInputStash('acc-1', null)).not.toThrow();
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

describe('批次原话', () => {
  it('提交后按批次记下，刷新回来只认同一批次、同一账号、未超时', () => {
    const store = memory();
    stashBatchInput(
      'acc-1',
      'b-1',
      { text: '原话', personId: 'p1' },
      NOW,
      store,
    );
    expect(restoreBatchInput('acc-1', 'b-1', NOW + 1000, store)).toEqual({
      text: '原话',
      personId: 'p1',
    });
    expect(restoreBatchInput('acc-1', 'b-2', NOW, store)).toBeNull();
    // 同账号的别的批次不动它
    expect(store.data.has(B1)).toBe(true);
    // 别的账号读不到，也碰不到这个账号的键
    expect(restoreBatchInput('acc-2', 'b-1', NOW, store)).toBeNull();
    expect(store.data.has(B1)).toBe(true);
    stashBatchInput(
      'acc-1',
      'b-1',
      { text: '原话', personId: 'p1' },
      NOW,
      store,
    );
    expect(
      restoreBatchInput('acc-1', 'b-1', NOW + STASH_TTL_MS + 1, store),
    ).toBeNull();
    expect(store.data.has(B1)).toBe(false);
    // 输入暂存不认带批次的那一份
    expect(restoreInput('acc-1', NOW, store)).toBeNull();
  });

  it('保存后、退出登录时清掉；存储不可用时不报错', () => {
    const store = memory();
    stashBatchInput(
      'acc-1',
      'b-1',
      { text: '原话', personId: null },
      NOW,
      store,
    );
    clearBatchStash('acc-1', store);
    expect(store.data.has(B1)).toBe(false);
    stashBatchInput(
      'acc-1',
      'b-1',
      { text: '原话', personId: null },
      NOW,
      store,
    );
    clearRecordInputStash('acc-1', store);
    expect(store.data.has(B1)).toBe(false);
    expect(() =>
      stashBatchInput('acc-1', 'b', { text: 'x', personId: null }, NOW, null),
    ).not.toThrow();
    expect(restoreBatchInput('acc-1', 'b', NOW, null)).toBeNull();
    expect(() => clearBatchStash('acc-1', null)).not.toThrow();
    const full = {
      ...memory(),
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() =>
      stashBatchInput('acc-1', 'b', { text: 'x', personId: null }, NOW, full),
    ).not.toThrow();
  });
});

describe('按账号分键', () => {
  it('一个账号清掉自己的暂存，不删另一个账号的', () => {
    const store = memory();
    stashInput('acc-1', { text: '甲的原话', personId: null }, NOW, store);
    stashInput('acc-2', { text: '乙的原话', personId: null }, NOW, store);
    stashBatchInput('acc-2', 'b', { text: '乙', personId: null }, NOW, store);
    clearRecordInputStash('acc-1', store);
    expect(store.data.has(IN1)).toBe(false);
    expect(restoreInput('acc-2', NOW, store)?.text).toBe('乙的原话');
    expect(restoreBatchInput('acc-2', 'b', NOW, store)?.text).toBe('乙');
  });
});
