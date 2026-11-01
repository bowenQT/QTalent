import { describe, expect, it } from 'vitest';
import {
  materialSourceSchema,
  type MaterialSource,
  type Source,
} from '@/contracts/sources';
import {
  cellPosition,
  columnName,
  contentFor,
  fromMaterialSource,
  fromSource,
  overlaps,
  sheetGrid,
  splitAt,
  splitExcerpt,
} from './viewer-model';

const ids = { fragmentId: 'frag-test-1', originalVersionId: 'ver-test-1' };

describe('fromSource', () => {
  it('keeps the original title and an unknown recorder as null', () => {
    const source: Source = {
      ...ids,
      location: { kind: 'document', paragraph: '3' },
      excerpt: '合成原文',
      originalTitle: '合成周报',
      recordedByName: null,
      sourceType: 'document',
      sourceCategory: 'original',
      demo: false,
    };
    expect(fromSource(source)).toEqual({
      ...ids,
      location: source.location,
      excerpt: '合成原文',
      title: '合成周报',
      recordedByName: null,
      demo: false,
      provenance: { kind: 'original' },
    });
  });

  it('carries the baseline notice as its provenance', () => {
    const source: Source = {
      ...ids,
      location: { kind: 'snapshot_field', fieldPath: 'events.1.note' },
      excerpt: '合成评语',
      originalTitle: '合成基线',
      recordedByName: null,
      sourceType: 'prototype_snapshot',
      sourceCategory: 'prototype_baseline',
      displayNotice: '原型基线 2e51b50，评语按原意压缩',
      demo: true,
    };
    expect(fromSource(source).provenance).toEqual({
      kind: 'prototype_baseline',
      notice: '原型基线 2e51b50，评语按原意压缩',
    });
  });
});

describe('fromMaterialSource', () => {
  const parse = (value: unknown): MaterialSource =>
    materialSourceSchema.parse(value);

  it('has no title or recorder, since the collection contract carries neither', () => {
    const viewer = fromMaterialSource(
      parse({
        ...ids,
        location: { kind: 'presentation', slide: 2 },
        excerpt: '合成页文字',
        sourceCategory: 'original',
        demo: true,
      }),
    );
    expect(viewer).toMatchObject({
      title: null,
      recordedByName: null,
      demo: true,
      provenance: { kind: 'original' },
    });
  });

  it('marks historical interview PDFs and submitted code snapshots', () => {
    expect(
      fromMaterialSource(
        parse({
          ...ids,
          location: {
            kind: 'pdf',
            page: 1,
            textRange: { start: 0, end: 4 },
          },
          excerpt: '合成面评',
          sourceCategory: 'historical_evaluation',
          evaluationKind: 'interview',
          demo: false,
        }),
      ).provenance,
    ).toEqual({ kind: 'historical_evaluation' });
    expect(
      fromMaterialSource(
        parse({
          ...ids,
          location: {
            kind: 'code',
            repository: 'git.example.com/demo/repo',
            commit: 'b'.repeat(40),
            path: 'src/a.ts',
            startLine: 1,
            endLine: 2,
          },
          excerpt: 'const a = 1;\nconst b = 2;',
          sourceCategory: 'submitted_code_snapshot',
          displayNotice: '提交的代码快照',
          demo: false,
        }),
      ).provenance,
    ).toEqual({ kind: 'submitted_code_snapshot', notice: '提交的代码快照' });
  });
});

describe('contentFor', () => {
  const ready = {
    status: 'ready' as const,
    content: { kind: 'presentation' as const, slides: [] },
  };
  it('returns the content only when its kind matches the location', () => {
    expect(contentFor(ready, 'presentation')).toBe(ready.content);
    expect(contentFor(ready, 'pdf')).toBeNull();
    expect(contentFor({ status: 'not_connected' }, 'presentation')).toBeNull();
  });
});

describe('text splitting', () => {
  it('splits a valid half-open range and refuses one outside the text', () => {
    expect(splitAt('abcdef', 2, 4)).toEqual(['ab', 'cd', 'ef']);
    expect(splitAt('abcdef', 0, 6)).toEqual(['', 'abcdef', '']);
    expect(splitAt('abcdef', 4, 4)).toBeNull();
    expect(splitAt('abcdef', -1, 2)).toBeNull();
    expect(splitAt('abcdef', 2, 7)).toBeNull();
  });

  it('marks the excerpt inside a paragraph, but not a missing or whole one', () => {
    expect(splitExcerpt('前文，引用，后文', '引用')).toEqual([
      '前文，',
      '引用',
      '，后文',
    ]);
    expect(splitExcerpt('整段就是引用', '整段就是引用')).toBeNull();
    expect(splitExcerpt('前文，后文', '引用')).toBeNull();
  });
});

describe('spreadsheet cells', () => {
  it('reads A1 references, case-insensitively and past Z', () => {
    expect(cellPosition('C7')).toEqual({ row: 7, column: 3 });
    expect(cellPosition('aa10')).toEqual({ row: 10, column: 27 });
    expect(cellPosition(' B2 ')).toEqual({ row: 2, column: 2 });
  });

  it.each(['C7:D8', 'C0', '7C', '第 3 行'])(
    'refuses %s, which is not one cell',
    (cell) => {
      expect(cellPosition(cell)).toBeNull();
    },
  );

  it('names columns back into letters', () => {
    expect([1, 26, 27, 52, 703].map(columnName)).toEqual([
      'A',
      'Z',
      'AA',
      'AZ',
      'AAA',
    ]);
  });

  it('lays cells on the smallest full grid and skips unreadable references', () => {
    const grid = sheetGrid([
      { cell: 'B2', text: '左上' },
      { cell: 'D4', text: '右下' },
      { cell: '合并区域', text: '跳过' },
    ]);
    expect(grid.rows).toEqual([2, 3, 4]);
    expect(grid.columns).toEqual([2, 3, 4]);
    expect(grid.text.get('2:2')).toBe('左上');
    expect(grid.text.get('4:4')).toBe('右下');
    expect(grid.text.size).toBe(2);
    expect(sheetGrid([])).toMatchObject({ rows: [], columns: [] });
  });
});

describe('overlaps', () => {
  it('counts any shared time and excludes segments that only touch', () => {
    expect(overlaps({ startMs: 0, endMs: 10 }, 5, 20)).toBe(true);
    expect(overlaps({ startMs: 10, endMs: 20 }, 0, 30)).toBe(true);
    expect(overlaps({ startMs: 0, endMs: 10 }, 10, 20)).toBe(false);
    expect(overlaps({ startMs: 20, endMs: 30 }, 0, 20)).toBe(false);
  });
});
