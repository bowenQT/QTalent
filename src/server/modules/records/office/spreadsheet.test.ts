import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseOfficeBytes } from './parse';
import { parseOfficeIsolated } from './parse-isolated';

const namespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const sheet = '演示个人记录';
const source = new URL(
  '../../../../../tests/fixtures/office/cache-types.xlsx',
  import.meta.url,
);
const cases = [
  ['甲_x000D_乙', '甲\r乙'],
  ['_x005F_x0041_', '_x0041_'],
  ['_x005f_x000D_', '_x000D_'],
  ['_x005F_x005F_', '_x005F_'],
  ['_x4E2D__x6587_', '中文'],
  ['_xD83D__xde00_', '😀'],
  ['&amp;_x000D_&lt;', '&\r<'],
  [
    '_x004G_|_x041_|_x00041_|_X0041_|_x0041',
    '_x004G_|_x041_|_x00041_|_X0041_|_x0041',
  ],
  ['line&#10;tab&#9;end', 'line\ntab\tend'],
  [' 演示 空格 ', ' 演示 空格 '],
  ['', ''],
] as const;

function workbook(strings: string[], shared: boolean): Uint8Array {
  // Keep the actual package/relationships; replace only synthetic text and cells.
  const parts = unzipSync(readFileSync(source));
  parts['xl/sharedStrings.xml'] = strToU8(
    `<sst xmlns="${namespace}" count="${strings.length + 1}" uniqueCount="${strings.length}">${strings.map((s) => `<si>${s}</si>`).join('')}</sst>`,
  );
  const cell = (address: string, index: number) =>
    shared
      ? `<c r="${address}" t="s"><v>${index}</v></c>`
      : `<c r="${address}" t="inlineStr"><is>${strings[index]}</is></c>`;
  parts['xl/worksheets/sheet5.xml'] = strToU8(
    `<worksheet xmlns="${namespace}"><sheetData><row r="1">${strings.map((_, i) => cell(`${String.fromCharCode(65 + i)}1`, i)).join('')}</row><row r="3">${cell('Z3', 1)}</row></sheetData></worksheet>`,
  );
  return zipSync(parts);
}

const text = (encoded: string) => `<t xml:space="preserve">${encoded}</t>`;
const richText = (encoded: string) =>
  `<r>${text('演示：')}</r><r>${text(encoded)}</r>`;

describe('BOW-901 SpreadsheetML ST_Xstring from real XLSX bytes', () => {
  it.each([
    ['shared', true, false],
    ['inline', false, false],
    ['shared rich text', true, true],
    ['inline rich text', false, true],
  ] as const)(
    'decodes %s once without changing literal escapes or cell identity',
    async (_name, shared, rich) => {
      const bytes = workbook(
        cases.map(([encoded]) => (rich ? richText(encoded) : text(encoded))),
        shared,
      );
      const before = Uint8Array.from(bytes);
      const result = await parseOfficeBytes({ format: 'xlsx', bytes });
      const cells = result.fragments.filter(
        (f) => f.kind === 'cell' && f.location.sheet === sheet,
      );
      const prefix = rich ? '演示：' : '';
      const expected = cases.map(([, decoded], i) => ({
        location: {
          kind: 'spreadsheet',
          sheet,
          cell: `${String.fromCharCode(65 + i)}1`,
        },
        text: prefix + decoded,
        content: {
          kind: 'constant',
          value: {
            type: 'text',
            value: prefix + decoded,
            raw: shared ? String(i) : '',
          },
        },
      }));
      expected.push({
        ...expected[1],
        location: { kind: 'spreadsheet', sheet, cell: 'Z3' },
      });
      expect(cells).toMatchObject(expected);
      expect(cells).toHaveLength(expected.length);
      expect(result.inputSha256).toBe(
        createHash('sha256').update(before).digest('hex'),
      );
      expect(result.attribution).toBe('unresolved');
      expect(Uint8Array.from(bytes)).toEqual(before);
    },
  );

  it('does not create new escapes by joining individually decoded rich-text runs', async () => {
    const bytes = workbook(
      [
        '<r><t>_x005F_</t></r><r><t>x0041_</t></r>',
        '<r><t>_x00</t></r><r><t>0D_</t></r>',
      ],
      true,
    );
    const result = await parseOfficeBytes({ format: 'xlsx', bytes });
    expect(
      result.fragments.filter(
        (f) => f.kind === 'cell' && f.location.sheet === sheet,
      ),
    ).toMatchObject([
      { location: { cell: 'A1' }, text: '_x0041_' },
      { location: { cell: 'B1' }, text: '_x000D_' },
      { location: { cell: 'Z3' }, text: '_x000D_' },
    ]);
  });

  it('preserves decoded values and original locators through the fixed real Office worker', async () => {
    const bytes = workbook(
      cases.map(([encoded]) => richText(encoded)),
      true,
    );
    const before = Uint8Array.from(bytes);
    const direct = await parseOfficeBytes({ format: 'xlsx', bytes });
    const isolated = await parseOfficeIsolated({ format: 'xlsx', bytes });
    expect(isolated).toEqual(direct);
    expect(
      isolated.fragments.find(
        (f) =>
          f.kind === 'cell' &&
          f.location.sheet === sheet &&
          f.location.cell === 'A1',
      )?.text,
    ).toBe('演示：甲\r乙');
    expect(Uint8Array.from(bytes)).toEqual(before);
  });
});
