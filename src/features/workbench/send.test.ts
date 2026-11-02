// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  draftKey,
  personHref,
  recordForPersonHref,
  saveDraft,
  sendHref,
  sendTarget,
  sessionStorageOrNull,
} from './send';

const both = { record: true, findPeople: true };
const recordOnly = { record: true, findPeople: false };
const findOnly = { record: false, findPeople: true };
const none = { record: false, findPeople: false };

afterEach(() => vi.restoreAllMocks());

describe('sendTarget', () => {
  it('sends find words to find people, the rest to record (HR and mentor)', () => {
    for (const text of [
      '找一个后端',
      '谁来牵头',
      '这个项目的 owner',
      '负责人',
      '人选',
    ])
      expect(sendTarget(text, both, false)).toBe('staffing');
    expect(sendTarget('谷嘉树这周补了覆盖率', both, false)).toBe('record');
  });

  it('never finds people without find_people, never records without record', () => {
    expect(sendTarget('找一个后端', recordOnly, false)).toBe('record');
    expect(sendTarget('谷嘉树这周补了覆盖率', findOnly, false)).toBe(
      'staffing',
    );
    expect(sendTarget('找一个后端', none, false)).toBeNull();
    expect(sendTarget('随便说一句', none, true)).toBeNull();
  });

  it('manager box finds unless the sentence records something that just happened', () => {
    expect(sendTarget('要一个能牵头应用后端的人', both, true)).toBe('staffing');
    for (const when of ['今天', '昨天', '这周', '刚才', '刚刚'])
      expect(sendTarget(`孟逸尘${when}把任务池同步给了全组`, both, true)).toBe(
        'record',
      );
    expect(sendTarget('今天要找一个负责人', both, true)).toBe('staffing');
    expect(sendTarget('刚刚开完会', findOnly, true)).toBe('staffing');
  });
});

describe('links', () => {
  it('carries only draft=work, never the sentence', () => {
    expect(sendHref('record')).toBe('/record?draft=work');
    expect(sendHref('staffing')).toBe('/staffing?new=1&draft=work');
  });

  it('encodes person ids', () => {
    const id = 'p 1&x=y/中';
    expect(new URL(personHref(id), 'http://x').searchParams.get('id')).toBe(id);
    expect(
      new URL(recordForPersonHref(id), 'http://x').searchParams.get('person'),
    ).toBe(id);
    expect(recordForPersonHref('p-x06')).toBe('/record?person=p-x06');
  });
});

describe('saveDraft', () => {
  const draft = { accountId: 'a-1', text: '原话 & 100% / 换行\n', savedAt: 1 };

  it('stores the draft under the target key, round-tripping special text', () => {
    const storage = new Map<string, string>();
    expect(
      saveDraft(
        { setItem: (key, value) => void storage.set(key, value) },
        'record',
        draft,
      ),
    ).toBe(true);
    expect(JSON.parse(storage.get(draftKey('record'))!)).toEqual(draft);
    expect(draftKey('staffing')).toBe('niu-talent:draft:staffing');
  });

  it('reports failure when storage is missing or refuses the write', () => {
    expect(saveDraft(null, 'record', draft)).toBe(false);
    expect(
      saveDraft(
        {
          setItem: () => {
            throw new DOMException('quota', 'QuotaExceededError');
          },
        },
        'staffing',
        draft,
      ),
    ).toBe(false);
  });

  it('returns null when the browser blocks sessionStorage', () => {
    expect(sessionStorageOrNull()).toBe(window.sessionStorage);
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(sessionStorageOrNull()).toBeNull();
  });
});
