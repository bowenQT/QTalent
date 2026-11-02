import { describe, expect, it } from 'vitest';
import {
  materialReviewResolvedItemSchema,
  type MaterialReviewItem,
} from '@/contracts/material-review';
import {
  doneText,
  hueOf,
  isPageItem,
  openKinds,
  placeText,
  question,
  resultText,
  type PageResolved,
  type Resolution,
} from './view';

const people = { 'p-a': '演示甲', 'p-b': '演示乙' };
const ref = { fragmentId: 'f', originalVersionId: 'v' };

describe('placeText', () => {
  it.each([
    [{ kind: 'document', paragraph: '8' }, '第 8 段'],
    [{ kind: 'document', page: 2, paragraph: '3' }, '第 2 页 · 第 3 段'],
    [{ kind: 'spreadsheet', sheet: '评审表', cell: 'B14' }, '「评审表」B14'],
    [{ kind: 'recording', startMs: 65_400, endMs: 70_000 }, '01:05'],
    [{ kind: 'video', startMs: 990_000, endMs: 1_065_000 }, '16:30'],
    [{ kind: 'pdf', page: 3, textRange: { start: 0, end: 4 } }, '第 3 页'],
    [{ kind: 'presentation', slide: 4 }, '第 4 页幻灯片'],
    [
      { kind: 'image', region: { left: 0, top: 0, right: 1, bottom: 1 } },
      '截图',
    ],
    [
      {
        kind: 'code',
        repository: 'demo',
        commit: 'a'.repeat(40),
        path: 'src/a.ts',
        startLine: 4,
        endLine: 9,
      },
      'src/a.ts 第 4–9 行',
    ],
  ] as const)('formats %j', (location, text) => {
    expect(placeText(location)).toBe(text);
  });
});

describe('question', () => {
  it('asks about a speaker in a recording or a video', () => {
    expect(
      question({
        kind: 'speaker',
        source: {
          ...ref,
          location: { kind: 'recording', startMs: 0, endMs: 1 },
        },
      }),
    ).toBe('录音里的这位说话人是谁？');
    expect(
      question({
        kind: 'speaker',
        source: { ...ref, location: { kind: 'video', startMs: 0, endMs: 1 } },
      }),
    ).toBe('录像里的这位说话人是谁？');
  });
  it('quotes the observed name, and asks plainly without one', () => {
    expect(
      question({ kind: 'unknown_person', source: null, observedName: '小周' }),
    ).toBe('「小周」指谁？');
    expect(
      question({ kind: 'unknown_person', source: null, observedName: null }),
    ).toBe('这一处说的是谁？');
    expect(
      question({
        kind: 'unknown_interviewer',
        source: null,
        observedName: 'Kevin',
      }),
    ).toBe('面评里的面试官「Kevin」是谁？');
    expect(
      question({
        kind: 'unknown_interviewer',
        source: null,
        observedName: null,
      }),
    ).toBe('面评里的这位面试官是谁？');
    expect(question({ kind: 'image_scope', source: null })).toBe(
      '这张图里要整理哪一部分？',
    );
  });
});

const resolvedBase = {
  itemId: 'i',
  batchId: 'b',
  evaluationNodeId: 'n',
  materialId: 'm',
  originalVersionId: 'v',
  revision: 2,
  state: 'resolved',
  resolvedAt: '2026-09-04T01:00:00.000Z',
  auditId: 'a',
  undo: { status: 'available' },
};
const resolved = (value: object) =>
  materialReviewResolvedItemSchema.parse({
    ...resolvedBase,
    ...value,
  }) as PageResolved;

describe('resultText', () => {
  it('names who each kind went to, or how the original is kept', () => {
    const speaker = {
      kind: 'speaker',
      quote: null,
      source: { ...ref, location: { kind: 'recording', startMs: 0, endMs: 1 } },
    };
    expect(
      resultText(
        resolved({
          ...speaker,
          resolution: { action: 'bind', personId: 'p-a' },
        }),
        people,
      ),
    ).toBe('演示甲');
    expect(
      resultText(
        resolved({ ...speaker, resolution: { action: 'mark_irrelevant' } }),
        people,
      ),
    ).toBe('与这份材料无关');
    expect(
      resultText(
        resolved({
          kind: 'unknown_person',
          source: null,
          observedName: null,
          resolution: { action: 'bind_people', personIds: ['p-a', 'p-b'] },
        }),
        people,
      ),
    ).toBe('演示甲、演示乙');
    expect(
      resultText(
        resolved({
          kind: 'unknown_person',
          source: null,
          observedName: null,
          resolution: { action: 'keep_original_only' },
        }),
        people,
      ),
    ).toBe('名单外的人，只留在原件里');
    const region = { left: 0, top: 0, right: 1, bottom: 1 };
    expect(
      resultText(
        resolved({
          kind: 'image_scope',
          source: null,
          resolution: { action: 'confirm_scope', region, personIds: ['p-a'] },
        }),
        people,
      ),
    ).toBe('整理框出的范围');
    expect(
      resultText(
        resolved({
          kind: 'image_scope',
          source: null,
          resolution: { action: 'keep_attachment_only' },
        }),
        people,
      ),
    ).toBe('整张只作附件');
    expect(
      resultText(
        resolved({
          kind: 'unknown_interviewer',
          observedName: 'Kevin',
          importRowId: 'r',
          source: {
            ...ref,
            location: { kind: 'pdf', page: 1, textRange: { start: 0, end: 1 } },
          },
          resolution: { action: 'link_existing_interviewer', personId: 'p-x' },
        }),
        people,
      ),
    ).toBe('关联到已选的人');
  });
});

describe('doneText', () => {
  it.each([
    [{ action: 'defer' }, '已放到稍后处理，待办里仍会保留'],
    [{ action: 'keep_original_only' }, '已记下：名单外的人，只留在原件里'],
    [{ action: 'keep_attachment_only' }, '这张图只作附件保存'],
    [
      { action: 'link_existing_interviewer', personId: 'p-a' },
      '已关联到演示甲，面评那一行可以导入了',
    ],
    [{ action: 'bind', personId: 'p-b' }, '已归到演示乙'],
    [
      { action: 'bind_people', personIds: ['p-a', 'p-b'] },
      '已归到演示甲、演示乙',
    ],
    [
      {
        action: 'confirm_scope',
        region: { left: 0, top: 0, right: 1, bottom: 1 },
        personIds: ['p-a'],
      },
      '已整理框出的范围',
    ],
    [{ action: 'mark_irrelevant' }, '已记下：与这份材料无关'],
    [{ action: 'unbind' }, '已解除这位说话人的绑定'],
  ] as const)('says what %j did', (resolution, text) => {
    expect(doneText(resolution as Resolution, people)).toBe(text);
  });
});

describe('kinds', () => {
  const item = (kind: string, state = 'pending') =>
    ({ kind, state }) as unknown as MaterialReviewItem;
  it('keeps the page kinds and lists open kinds in the prototype order', () => {
    expect(isPageItem(item('unknown_project'))).toBe(false);
    expect(isPageItem(item('unknown_interview_candidate'))).toBe(false);
    expect(isPageItem(item('image_scope'))).toBe(true);
    const items = [
      item('unknown_interviewer'),
      item('speaker', 'deferred'),
      item('unknown_person'),
    ].filter(isPageItem);
    expect(openKinds(items)).toEqual(['unknown_person', 'unknown_interviewer']);
    // A deferred item brought back counts once the page says it is open.
    expect(openKinds(items, () => true)).toEqual([
      'speaker',
      'unknown_person',
      'unknown_interviewer',
    ]);
  });
  it('gives a stable hue in range', () => {
    expect(hueOf('p-x15')).toBe(hueOf('p-x15'));
    expect(hueOf('p-x15')).toBeGreaterThanOrEqual(0);
    expect(hueOf('p-x15')).toBeLessThan(360);
  });
});
