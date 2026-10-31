import type { Element } from '@xmldom/xmldom';
import { xml, part, elements } from './xml';
import type { packageMetadata } from './package';
import type { OfficeContentNode } from 'officeparser';
import {
  OfficeParseError,
  type OfficeFragment,
  type OfficeScalar,
} from './types';
const namespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
function children(parent: Element, name: string): Element[] {
  return elements(parent, name, namespace);
}
function one(parent: Element, name: string): Element | undefined {
  const found = children(parent, name);
  if (found.length > 1)
    throw new OfficeParseError('invalid_document', 'duplicate_cell_field');
  return found[0];
}
function textRuns(parent: Element): string {
  // Phonetic rPh runs are pronunciation aids, not a second copy of source text.
  return Array.from(parent.childNodes)
    .filter(
      (n): n is Element => n.nodeType === 1 && n.namespaceURI === namespace,
    )
    .map((n) =>
      n.localName === 't'
        ? (n.textContent ?? '')
        : n.localName === 'r'
          ? children(n, 't')
              .map((t) => t.textContent ?? '')
              .join('')
          : '',
    )
    .join('');
}
function sharedStrings(parts: Record<string, Uint8Array>): string[] {
  if (!parts['xl/sharedStrings.xml']) return [];
  const root = part(parts, 'xl/sharedStrings.xml');
  if (root.localName !== 'sst' || root.namespaceURI !== namespace)
    throw new OfficeParseError('invalid_document', 'shared_strings_root');
  return children(root, 'si').map(textRuns);
}
function workbook(
  metadata: ReturnType<typeof packageMetadata>,
): Map<string, boolean> {
  const root = part(metadata.parts, 'xl/workbook.xml');
  const rels = part(metadata.parts, 'xl/_rels/workbook.xml.rels');
  const relNamespace =
    'http://schemas.openxmlformats.org/package/2006/relationships';
  const officeNamespace =
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  if (
    root.localName !== 'workbook' ||
    root.namespaceURI !== namespace ||
    rels.localName !== 'Relationships' ||
    rels.namespaceURI !== relNamespace
  )
    throw new OfficeParseError('invalid_document', 'workbook_identity');
  const relationships = new Map<string, Element>();
  for (const rel of Array.from(
    rels.getElementsByTagNameNS(relNamespace, 'Relationship'),
  )) {
    const id = rel.getAttribute('Id');
    if (!id || relationships.has(id))
      throw new OfficeParseError('invalid_document', 'relationship_identity');
    relationships.set(id, rel);
  }
  const container = one(root, 'sheets');
  if (!container)
    throw new OfficeParseError('invalid_document', 'missing_sheets');
  const names = new Map<string, boolean>();
  const paths = new Set<string>();
  for (const sheet of children(container, 'sheet')) {
    const name = sheet.getAttribute('name');
    const rel = relationships.get(
      sheet.getAttributeNS(officeNamespace, 'id') ?? '',
    );
    const target = rel?.getAttribute('Target') ?? '';
    // OfficeParser 8.4.1 supports the standard sheetN.xml convention. Reject its
    // filename fallback, external relationships and unsupported custom part names.
    const path = target.startsWith('/xl/') ? target.slice(1) : `xl/${target}`;
    if (
      !name?.trim() ||
      names.has(name) ||
      !rel ||
      rel.getAttribute('Type') !== `${officeNamespace}/worksheet` ||
      rel.getAttribute('TargetMode') === 'External' ||
      !/^xl\/worksheets\/sheet[0-9]+\.xml$/.test(path) ||
      paths.has(path) ||
      !metadata.worksheetPaths.has(path)
    )
      throw new OfficeParseError('invalid_document', 'worksheet_declaration');
    const state = sheet.getAttribute('state') || 'visible';
    if (!['visible', 'hidden', 'veryHidden'].includes(state))
      throw new OfficeParseError('unsupported_content', 'worksheet_state');
    names.set(name, state !== 'visible');
    paths.add(path);
  }
  if (!names.size || paths.size !== metadata.worksheetPaths.size)
    throw new OfficeParseError('unsupported_content', 'unreferenced_worksheet');
  return names;
}
function scalar(
  type: string,
  raw: string,
  inline: Element | undefined,
  strings: string[],
): OfficeScalar {
  if (type === 'inlineStr') {
    if (!inline)
      throw new OfficeParseError('invalid_document', 'missing_inline_string');
    return { type: 'text', value: textRuns(inline), raw };
  }
  if (type === 's') {
    if (!/^\d+$/.test(raw) || Number(raw) >= strings.length)
      throw new OfficeParseError('invalid_document', 'shared_string_index');
    return { type: 'text', value: strings[Number(raw)], raw };
  }
  if (type === 'str') return { type: 'text', value: raw, raw };
  if (type === 'b') {
    if (raw !== '0' && raw !== '1')
      throw new OfficeParseError('invalid_document', 'invalid_boolean');
    return { type: 'boolean', value: raw === '1', raw };
  }
  if (type === 'n') {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(raw))
      throw new OfficeParseError('invalid_document', 'invalid_numeric_cache');
    return { type: 'number', value: raw, raw }; // No conversion/rounding or formula evaluation.
  }
  if (type === 'd') return { type: 'date', value: raw, raw };
  if (type === 'e') return { type: 'error', value: raw, raw };
  throw new OfficeParseError('unsupported_content', 'unsupported_cell_type');
}
function address(cell: Element): { ref: string; column: number } {
  const ref = cell.getAttribute('r') ?? '';
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(ref);
  if (!match)
    throw new OfficeParseError(
      'invalid_document',
      'missing_or_invalid_cell_address',
    );
  let column = 0;
  for (const ch of match[1]) column = column * 26 + ch.charCodeAt(0) - 64;
  if (column > 16384 || Number(match[2]) > 1048576)
    throw new OfficeParseError('invalid_document', 'cell_outside_sheet');
  return { ref, column };
}
export function readSpreadsheet(
  metadata: ReturnType<typeof packageMetadata>,
  sheets: OfficeContentNode[],
  maxCells: number,
): OfficeFragment[] {
  const declared = workbook(metadata);
  const strings = sharedStrings(metadata.parts);
  if (sheets.length !== declared.size)
    throw new OfficeParseError('invalid_document', 'worksheet_count');
  let cellCount = 0;
  const fragments: OfficeFragment[] = [];
  const sheetNames = new Set<string>();
  for (const sheet of sheets) {
    const name = sheet.type === 'sheet' ? sheet.metadata?.sheetName : undefined;
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      !declared.has(name) ||
      sheetNames.has(name) ||
      typeof sheet.rawContent !== 'string'
    )
      throw new OfficeParseError('invalid_document', 'worksheet_identity');
    sheetNames.add(name);
    const root = xml(sheet.rawContent);
    if (root.localName !== 'worksheet' || root.namespaceURI !== namespace)
      throw new OfficeParseError('invalid_document', 'worksheet_root');
    const data = one(root, 'sheetData');
    if (!data)
      throw new OfficeParseError('invalid_document', 'missing_sheet_data');
    const hiddenColumns = children(one(root, 'cols') ?? root, 'col')
      .filter((col) => ['1', 'true'].includes(col.getAttribute('hidden') ?? ''))
      .map((col) => {
        const min = Number(col.getAttribute('min'));
        const max = Number(col.getAttribute('max'));
        if (
          !Number.isInteger(min) ||
          !Number.isInteger(max) ||
          min < 1 ||
          max < min ||
          max > 16384
        )
          throw new OfficeParseError('invalid_document', 'column_range');
        return { min, max };
      });
    const seen = new Set<string>();
    for (const row of children(data, 'row'))
      for (const cell of children(row, 'c')) {
        if (++cellCount > maxCells)
          throw new OfficeParseError('limit_exceeded', 'table_cells');
        const { ref, column } = address(cell);
        const location = {
          kind: 'spreadsheet' as const,
          sheet: name,
          cell: ref,
        };
        if (seen.has(ref))
          throw new OfficeParseError(
            'invalid_document',
            'duplicate_cell_address',
            location,
          );
        seen.add(ref);
        const formula = one(cell, 'f');
        const cached = one(cell, 'v');
        const inline = one(cell, 'is');
        const type = cell.getAttribute('t') || 'n';
        if (!['inlineStr', 's', 'str', 'b', 'n', 'd', 'e'].includes(type))
          throw new OfficeParseError(
            'unsupported_content',
            'unsupported_cell_type',
            location,
          );
        const raw = cached?.textContent ?? '';
        const hidden =
          declared.get(name) === true ||
          hiddenColumns.some(
            (range) => column >= range.min && column <= range.max,
          ) ||
          ['1', 'true'].includes(row.getAttribute('hidden') ?? '');
        // An explicit formula remains present even when the ordinary AST omits it.
        if (formula) {
          const formulaType = formula.getAttribute('t') || 'normal';
          if (!['normal', 'shared', 'array', 'dataTable'].includes(formulaType))
            throw new OfficeParseError(
              'unsupported_content',
              'unsupported_formula_type',
              location,
            );
          const result =
            cached && (raw !== '' || type === 'str')
              ? {
                  state: 'present' as const,
                  value: scalar(type, raw, inline, strings),
                }
              : { state: 'missing' as const };
          fragments.push({
            kind: 'cell',
            location,
            hidden,
            text:
              result.state === 'present' ? String(result.value.value) : null,
            content: {
              kind: 'formula',
              expression: formula.textContent ?? '',
              formulaType,
              sharedIndex: formula.getAttribute('si'),
              range: formula.getAttribute('ref'),
              cached: result,
            },
          });
        } else if (cached || inline) {
          const value = scalar(type, raw, inline, strings);
          fragments.push({
            kind: 'cell',
            location,
            hidden,
            text: String(value.value),
            content: { kind: 'constant', value },
          });
        }
        // Style-only and merge followers are never filled from another cell.
      }
  }
  return fragments;
}
