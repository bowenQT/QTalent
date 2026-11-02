import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { parseOfficeBytes, officeLimits } from './parse';
import { OfficeParseError, type OfficeFragment } from './types';
import { packageMetadata } from './package';
const base = new URL('../../../../../tests/fixtures/office/', import.meta.url);
const fixture = (name: string) => readFileSync(new URL(name, base));
function change(
  file: string,
  part: string,
  edit: (text: string) => string,
): Uint8Array {
  const entries = unzipSync(fixture(file));
  entries[part] = strToU8(edit(strFromU8(entries[part])));
  return zipSync(entries);
}
const cells = (parts: OfficeFragment[]) =>
  parts.filter((p) => p.kind === 'cell');
afterEach(() => vi.restoreAllMocks());
describe('BOW-901 Office bytes (pure synthetic, no model/Office runtime)', () => {
  it('reads actual presentation order and notes relationships, without deleted slides', async () => {
    const result = await parseOfficeBytes({
      format: 'pptx',
      bytes: fixture('ordered-slides.pptx'),
    });
    expect(result.fragments).toEqual([
      {
        kind: 'slide_text',
        text: '演示第一页：团队甲共同完成交付。',
        location: { kind: 'presentation', slide: 1 },
      },
      {
        kind: 'speaker_notes',
        text: '演示第一页备注：没有个人身份映射。',
        location: { kind: 'presentation', slide: 1 },
      },
      {
        kind: 'slide_text',
        text: '演示第二页：共同成果保留团队归属。',
        location: { kind: 'presentation', slide: 2 },
      },
      {
        kind: 'speaker_notes',
        text: '演示第二页备注：不复制为个人分。',
        location: { kind: 'presentation', slide: 2 },
      },
    ]);
    expect(result.inputSha256).toBe(
      '524aa2f4eefda4578ba4f8e1c2ca3e97ce58d2f9d79260e6281ac5228688307f',
    );
    expect(result.attribution).toBe('unresolved');
    expect(result.locationContractSha).toBe(
      '0b20a913621121848219e0966ba4bf4844d1bdb3',
    );
  });
  it('keeps stable workbook names, sparse cell addresses and cached results without recalculation', async () => {
    const result = await parseOfficeBytes({
      format: 'xlsx',
      bytes: fixture('cached-values.xlsx'),
    });
    const data = cells(result.fragments);
    const at = (cell: string) =>
      data.find(
        (p) => p.location.sheet === '演示个人记录' && p.location.cell === cell,
      );
    expect(at('AA6')?.text).toBe('演示：远列定位');
    expect(at('D2')?.content).toMatchObject({
      kind: 'formula',
      expression: '1+1',
      cached: { state: 'present', value: { type: 'number', value: '42' } },
    });
    expect(at('D3')).toMatchObject({
      text: null,
      content: { kind: 'formula', cached: { state: 'missing' } },
    });
    expect(at('F2')?.content).toMatchObject({
      kind: 'formula',
      cached: { state: 'present', value: { type: 'number', value: '0' } },
    });
    expect(at('F3')?.content).toMatchObject({
      kind: 'formula',
      cached: {
        state: 'present',
        value: { type: 'boolean', value: false, raw: '0' },
      },
    });
    expect(at('D4')?.content).toMatchObject({
      kind: 'formula',
      cached: { state: 'present', value: { type: 'error', value: '#DIV/0!' } },
    });
    expect(at('F4')?.content).toMatchObject({
      kind: 'constant',
      value: { type: 'number', value: '0' },
    });
    expect(at('H4')?.content).toMatchObject({
      kind: 'constant',
      value: { type: 'boolean', value: false },
    });
    const team = data.filter((p) => p.location.sheet === '演示团队结果');
    expect(team.every((p) => p.hidden)).toBe(true);
    expect(team.find((p) => p.location.cell === 'B2')?.text).toBe('4');
    expect(team.find((p) => p.location.cell === 'B3')).toBeUndefined();
    expect(JSON.stringify(result)).not.toMatch(
      /personId|dimensionScore|confirmedScore/,
    );
  });
  it('preserves shared/empty/rich strings, raw precision, shared formula metadata and literal equals text', async () => {
    const result = await parseOfficeBytes({
      format: 'xlsx',
      bytes: fixture('cache-types.xlsx'),
    });
    const data = cells(result.fragments);
    const at = (cell: string) =>
      data.find(
        (p) => p.location.sheet === '演示个人记录' && p.location.cell === cell,
      );
    expect(at('A8')?.content).toMatchObject({
      kind: 'constant',
      value: { type: 'text', value: '' },
    });
    expect(at('B8')?.text).toBe('演示富文本');
    expect(at('C8')?.content).toMatchObject({
      kind: 'formula',
      cached: { state: 'present', value: { type: 'text', value: '' } },
    });
    expect(at('D8')?.content).toMatchObject({
      kind: 'constant',
      value: { type: 'text', value: '=2+2' },
    });
    expect(at('E8')?.content).toMatchObject({
      kind: 'constant',
      value: { type: 'date', value: '2026-10-31T12:30:00Z' },
    });
    expect(at('F9')?.content).toMatchObject({
      kind: 'formula',
      expression: '',
      formulaType: 'shared',
      sharedIndex: '0',
      cached: { state: 'present', value: { value: '2' } },
    });
    expect(at('G8')?.text).toBe('9007199254740993');
    expect(at('H8')?.text).toBe('');
    expect(at('Z9')).toBeUndefined();
  });
  it('performs no fetch when parsing buffers, formulas or a harmless external hyperlink', async () => {
    const send = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Unexpected network'));
    const bytes = change(
      'ordered-slides.pptx',
      'ppt/slides/_rels/slide7.xml.rels',
      (x) =>
        x.replace(
          '</Relationships>',
          '<Relationship Id="demo-link" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid/do-not-fetch" TargetMode="External"/></Relationships>',
        ),
    );
    await parseOfficeBytes({ format: 'pptx', bytes });
    await parseOfficeBytes({
      format: 'xlsx',
      bytes: fixture('cached-values.xlsx'),
    });
    expect(send).not.toHaveBeenCalled();
  });
  it('is deterministic and leaves source bytes unchanged', async () => {
    const bytes = fixture('cached-values.xlsx');
    const before = Uint8Array.from(bytes);
    const first = await parseOfficeBytes({ format: 'xlsx', bytes });
    expect(await parseOfficeBytes({ format: 'xlsx', bytes })).toEqual(first);
    expect(Uint8Array.from(bytes)).toEqual(before);
  });
  it.each([
    ['truncated.pptx', 'pptx'],
    ['unsupported.zip', 'xlsx'],
    ['cached-values.xlsx', 'pptx'],
  ] as const)(
    'fails explicitly on invalid/wrong-format actual bytes: %s as %s',
    async (name, format) => {
      await expect(
        parseOfficeBytes({ format, bytes: fixture(name) }),
      ).rejects.toBeInstanceOf(OfficeParseError);
    },
  );
  it('rejects unsupported formats, non-binary, oversized and pre-cancelled inputs before parsing', async () => {
    await expect(
      parseOfficeBytes({
        format: 'docx' as never,
        bytes: fixture('ordered-slides.pptx'),
      }),
    ).rejects.toMatchObject({ kind: 'unsupported_format' });
    await expect(
      parseOfficeBytes({ format: 'xlsx', bytes: new Uint8Array() }),
    ).rejects.toMatchObject({ kind: 'invalid_document' });
    await expect(
      parseOfficeBytes({
        format: 'xlsx',
        bytes: new Uint8Array(officeLimits.maxInputBytes + 1),
      }),
    ).rejects.toMatchObject({ kind: 'limit_exceeded' });
    await expect(
      parseOfficeBytes({
        format: 'xlsx',
        bytes: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]),
      }),
    ).rejects.toMatchObject({ kind: 'unsupported_format' });
    await expect(
      parseOfficeBytes({
        format: 'xlsx',
        bytes: fixture('cached-values.xlsx'),
        signal: AbortSignal.abort(),
      }),
    ).rejects.toMatchObject({ kind: 'cancelled' });
  });
  it.each([
    [
      'invalid numeric',
      (s: string) => s.replace('<v>42</v>', '<v>not-a-number</v>'),
    ],
    [
      'invalid boolean',
      (s: string) => s.replace('<f>1=2</f><v>0</v>', '<f>1=2</f><v>9</v>'),
    ],
    ['missing address', (s: string) => s.replace('r="D2"', '')],
    ['out of range', (s: string) => s.replace('r="D2"', 'r="XFE2"')],
    ['duplicate address', (s: string) => s.replace('r="F2"', 'r="D2"')],
    [
      'unknown cell type',
      (s: string) => s.replace('r="D2" t="n"', 'r="D2" t="future"'),
    ],
    [
      'unknown uncached formula cell type',
      (s: string) => s.replace('r="D3" t="n"', 'r="D3" t="future"'),
    ],
    [
      'unknown formula kind',
      (s: string) => s.replace('<f>1+1</f>', '<f t="future">1+1</f>'),
    ],
    [
      'duplicate value',
      (s: string) => s.replace('<v>42</v>', '<v>42</v><v>43</v>'),
    ],
    [
      'missing inline string',
      (s: string) => s.replace('<is><t>演示姓名</t></is>', '<v/>'),
    ],
    ['invalid XML', (s: string) => s.replace('</worksheet>', '<broken>')],
  ])('rejects unsupported/ambiguous cell content: %s', async (_name, edit) => {
    const bytes = change(
      'cached-values.xlsx',
      'xl/worksheets/sheet5.xml',
      edit,
    );
    await expect(
      parseOfficeBytes({ format: 'xlsx', bytes }),
    ).rejects.toBeInstanceOf(OfficeParseError);
  });
  it('rejects missing shared-string references instead of inventing empty text', async () => {
    const bytes = change('cache-types.xlsx', 'xl/worksheets/sheet5.xml', (s) =>
      s.replace('r="A8" t="s"><v>0', 'r="A8" t="s"><v>999'),
    );
    await expect(
      parseOfficeBytes({ format: 'xlsx', bytes }),
    ).rejects.toMatchObject({ reason: 'shared_string_index' });
  });
  it('enforces a fixed table limit independently of library input-size allowances', async () => {
    const entries = unzipSync(fixture('cached-values.xlsx'));
    entries['xl/worksheets/sheet5.xml'] = strToU8(
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
        Array.from(
          { length: 20001 },
          (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>1</v></c></row>`,
        ).join('') +
        '</sheetData></worksheet>',
    );
    await expect(
      parseOfficeBytes({ format: 'xlsx', bytes: zipSync(entries) }),
    ).rejects.toMatchObject({ kind: 'limit_exceeded' });
  });
});

describe('Office package identities and bounded failure semantics', () => {
  it.each([
    [
      'missing list',
      'ppt/presentation.xml',
      (x: string) => x.replace(/<p:sldIdLst>.*<\/p:sldIdLst>/, ''),
    ],
    [
      'empty list',
      'ppt/presentation.xml',
      (x: string) => x.replace(/<p:sldIdLst>.*<\/p:sldIdLst>/, '<p:sldIdLst/>'),
    ],
    [
      'missing listed relationship',
      'ppt/presentation.xml',
      (x: string) => x.replace('r:id="rId7"', 'r:id="missing"'),
    ],
    [
      'duplicate listed slide',
      'ppt/presentation.xml',
      (x: string) => x.replace('r:id="rId2"', 'r:id="rId7"'),
    ],
    [
      'missing slide bytes',
      'ppt/_rels/presentation.xml.rels',
      (x: string) => x.replace('slide7.xml', 'slide70.xml'),
    ],
    [
      'external slide relationship',
      'ppt/_rels/presentation.xml.rels',
      (x: string) => x.replace('Id="rId7"', 'Id="rId7" TargetMode="External"'),
    ],
    [
      'duplicate relationship id',
      'ppt/_rels/presentation.xml.rels',
      (x: string) => x.replace('Id="rId2"', 'Id="rId7"'),
    ],
    [
      'missing note bytes',
      'ppt/slides/_rels/slide7.xml.rels',
      (x: string) => x.replace('notesSlide3.xml', 'notesSlide30.xml'),
    ],
    [
      'shared note page',
      'ppt/slides/_rels/slide2.xml.rels',
      (x: string) => x.replace('notesSlide8.xml', 'notesSlide3.xml'),
    ],
  ])('rejects ambiguous PPTX citations: %s', async (_name, path, edit) => {
    await expect(
      parseOfficeBytes({
        format: 'pptx',
        bytes: change('ordered-slides.pptx', path, edit),
      }),
    ).rejects.toBeInstanceOf(OfficeParseError);
  });
  it('keeps a notes-only slide at its original page, without empty placeholders', async () => {
    const bytes = change('ordered-slides.pptx', 'ppt/slides/slide7.xml', (x) =>
      x.replace('演示第一页：团队甲共同完成交付。', ''),
    );
    const result = await parseOfficeBytes({ format: 'pptx', bytes });
    expect(result.fragments[0]).toMatchObject({
      kind: 'speaker_notes',
      location: { slide: 1 },
    });
    expect(result.fragments).toHaveLength(3);
  });
  it('reports unreadable partial content instead of returning the remaining good slide', async () => {
    const bytes = change(
      'ordered-slides.pptx',
      'ppt/slides/slide7.xml',
      () => '<unreadable',
    );
    await expect(
      parseOfficeBytes({ format: 'pptx', bytes }),
    ).rejects.toBeInstanceOf(OfficeParseError);
  });
  it('reports a deck with no extractable text explicitly', async () => {
    const entries = unzipSync(fixture('ordered-slides.pptx'));
    for (const key of [
      'ppt/slides/slide7.xml',
      'ppt/slides/slide2.xml',
      'ppt/notesSlides/notesSlide3.xml',
      'ppt/notesSlides/notesSlide8.xml',
    ])
      entries[key] = strToU8(
        strFromU8(entries[key]).replace(/<a:t>[^<]*<\/a:t>/g, '<a:t/>'),
      );
    await expect(
      parseOfficeBytes({ format: 'pptx', bytes: zipSync(entries) }),
    ).rejects.toMatchObject({
      kind: 'unsupported_content',
      reason: 'no_extractable_content',
    });
  });
  it.each([
    [
      'empty name',
      'xl/workbook.xml',
      (x: string) => x.replace('name="演示个人记录"', 'name=""'),
    ],
    [
      'duplicate name',
      'xl/workbook.xml',
      (x: string) => x.replace('name="演示团队结果"', 'name="演示个人记录"'),
    ],
    [
      'unknown visibility',
      'xl/workbook.xml',
      (x: string) => x.replace('state="hidden"', 'state="future"'),
    ],
    [
      'missing sheets list',
      'xl/workbook.xml',
      (x: string) => x.replace(/<sheets>.*<\/sheets>/, ''),
    ],
    [
      'wrong workbook namespace',
      'xl/workbook.xml',
      (x: string) =>
        x.replace('spreadsheetml/2006/main', 'spreadsheetml/2099/future'),
    ],
    [
      'missing relationship',
      'xl/workbook.xml',
      (x: string) => x.replace('r:id="rId5"', 'r:id="missing"'),
    ],
    [
      'missing target',
      'xl/_rels/workbook.xml.rels',
      (x: string) => x.replace('sheet5.xml', 'sheet50.xml'),
    ],
    [
      'duplicate relationship',
      'xl/_rels/workbook.xml.rels',
      (x: string) => x.replace('Id="rId2"', 'Id="rId5"'),
    ],
    [
      'external worksheet',
      'xl/_rels/workbook.xml.rels',
      (x: string) => x.replace('Id="rId5"', 'Id="rId5" TargetMode="External"'),
    ],
    [
      'missing sheet data',
      'xl/worksheets/sheet5.xml',
      (x: string) => x.replace(/<sheetData>.*<\/sheetData>/, ''),
    ],
    [
      'worksheet document type',
      'xl/worksheets/sheet5.xml',
      (x: string) => '<!DOCTYPE worksheet>' + x,
    ],
    [
      'unsupported column range',
      'xl/worksheets/sheet5.xml',
      (x: string) =>
        x.replace(
          '<sheetData>',
          '<cols><col min="1" max="20000" hidden="1"/></cols><sheetData>',
        ),
    ],
  ])(
    'rejects unsupported/ambiguous workbook structure: %s',
    async (_name, path, edit) => {
      await expect(
        parseOfficeBytes({
          format: 'xlsx',
          bytes: change('cached-values.xlsx', path, edit),
        }),
      ).rejects.toBeInstanceOf(OfficeParseError);
    },
  );
  it('accepts absolute worksheet part targets and retains very-hidden visibility', async () => {
    const entries = unzipSync(fixture('cached-values.xlsx'));
    const rels = 'xl/_rels/workbook.xml.rels';
    entries[rels] = strToU8(
      strFromU8(entries[rels]).replace(
        'Target="worksheets/sheet5.xml"',
        'Target="/xl/worksheets/sheet5.xml"',
      ),
    );
    const book = 'xl/workbook.xml';
    entries[book] = strToU8(
      strFromU8(entries[book]).replace('state="hidden"', 'state="veryHidden"'),
    );
    const result = await parseOfficeBytes({
      format: 'xlsx',
      bytes: zipSync(entries),
    });
    expect(
      cells(result.fragments)
        .filter((c) => c.location.sheet === '演示团队结果')
        .every((c) => c.hidden),
    ).toBe(true);
  });
  it('does not guess a file-name citation for an orphan worksheet', async () => {
    const entries = unzipSync(fixture('cached-values.xlsx'));
    entries['xl/worksheets/sheet9.xml'] = entries['xl/worksheets/sheet5.xml'];
    await expect(
      parseOfficeBytes({ format: 'xlsx', bytes: zipSync(entries) }),
    ).rejects.toMatchObject({ reason: 'unreferenced_worksheet' });
  });
  it('rejects a malformed shared-string table rather than losing values', async () => {
    const bytes = change('cache-types.xlsx', 'xl/sharedStrings.xml', (x) =>
      x.replace('<sst ', '<wrong ').replace('</sst>', '</wrong>'),
    );
    await expect(
      parseOfficeBytes({ format: 'xlsx', bytes }),
    ).rejects.toBeInstanceOf(OfficeParseError);
  });
  it('keeps missing numeric caches distinct from empty text and tracks hidden source cells', async () => {
    const bytes = change(
      'cached-values.xlsx',
      'xl/worksheets/sheet5.xml',
      (x) =>
        x
          .replace(
            '<sheetData>',
            '<cols><col min="6" max="6" hidden="1"/></cols><sheetData>',
          )
          .replace('<row r="3">', '<row r="3" hidden="true">')
          .replace('<v>42</v>', '<v/>'),
    );
    const result = await parseOfficeBytes({ format: 'xlsx', bytes });
    const data = cells(result.fragments).filter(
      (c) => c.location.sheet === '演示个人记录',
    );
    expect(data.find((c) => c.location.cell === 'D2')).toMatchObject({
      text: null,
      content: { cached: { state: 'missing' } },
    });
    expect(data.find((c) => c.location.cell === 'F2')?.hidden).toBe(true);
    expect(data.find((c) => c.location.cell === 'D3')?.hidden).toBe(true);
    expect(data.find((c) => c.location.cell === 'D4')?.hidden).toBe(false);
  });
  it('does not duplicate phonetic pronunciation runs as source text', async () => {
    const bytes = change('cache-types.xlsx', 'xl/sharedStrings.xml', (x) =>
      x.replace(
        '<r><t>演示</t></r>',
        '<r><t>演示</t></r><rPh sb="0" eb="2"><t>yanshi</t></rPh>',
      ),
    );
    const result = await parseOfficeBytes({ format: 'xlsx', bytes });
    expect(
      cells(result.fragments).find((c) => c.location.cell === 'B8')?.text,
    ).toBe('演示富文本');
  });
  it('uses hard ZIP entry and expansion limits before parsing', () => {
    const bytes = fixture('cached-values.xlsx');
    expect(() =>
      packageMetadata(bytes, {
        maxZipEntries: 1,
        maxUncompressedBytes: 1024 * 1024,
      }),
    ).toThrow(expect.objectContaining({ kind: 'limit_exceeded' }));
    expect(() =>
      packageMetadata(bytes, { maxZipEntries: 1024, maxUncompressedBytes: 1 }),
    ).toThrow(expect.objectContaining({ kind: 'limit_exceeded' }));
  });
});
