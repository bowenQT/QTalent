import { describe, expect, it } from 'vitest';
import { formatLocation, sourceTypeName } from './source-format';

describe('formatLocation', () => {
  it('writes document pages and paragraphs, and only the paragraph without a page', () => {
    expect(formatLocation({ kind: 'document', page: 2, paragraph: '3' })).toBe(
      '第 2 页 · 第 3 段',
    );
    expect(formatLocation({ kind: 'document', paragraph: '5' })).toBe(
      '第 5 段',
    );
  });
  it('writes spreadsheet cells with the sheet name', () => {
    expect(
      formatLocation({ kind: 'spreadsheet', sheet: '观察表', cell: 'C7' }),
    ).toBe('「观察表」C7');
  });
  it('writes recording ranges as mm:ss–mm:ss, rounding outward and passing 60 minutes', () => {
    expect(
      formatLocation({ kind: 'recording', startMs: 192_400, endMs: 208_100 }),
    ).toBe('03:12–03:29');
    expect(formatLocation({ kind: 'recording', startMs: 0, endMs: 500 })).toBe(
      '00:00–00:01',
    );
    expect(
      formatLocation({
        kind: 'recording',
        startMs: 3_600_000,
        endMs: 3_661_000,
      }),
    ).toBe('60:00–61:01');
  });
  it('shows the original location of a snapshot field, never its field path', () => {
    expect(
      formatLocation({
        kind: 'snapshot_field',
        fieldPath: 'events.12.note',
        originalLocation: '第 4 行',
      }),
    ).toBe('第 4 行');
    expect(
      formatLocation({ kind: 'snapshot_field', fieldPath: 'events.12.note' }),
    ).toBe('快照字段');
  });
});

describe('sourceTypeName', () => {
  it('names every location kind', () => {
    expect(sourceTypeName('document')).toBe('文档');
    expect(sourceTypeName('spreadsheet')).toBe('表格');
    expect(sourceTypeName('recording')).toBe('录音');
    expect(sourceTypeName('snapshot_field')).toBe('原型基线');
  });
});
