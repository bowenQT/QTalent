import { unzipSync } from 'fflate';
import { OfficeParseError } from './types';

/** ZIP library preflight, before OfficeParser's input-dependent expansion budgets. */
export function packageMetadata(
  bytes: Uint8Array,
  limits: { maxZipEntries: number; maxUncompressedBytes: number },
): {
  parts: Record<string, Uint8Array>;
  worksheetPaths: Set<string>;
  names: Set<string>;
} {
  const names = new Set<string>();
  const worksheetPaths = new Set<string>();
  let total = 0;
  const parts = unzipSync(bytes, {
    filter: (entry) => {
      if (names.has(entry.name))
        throw new OfficeParseError(
          'invalid_document',
          'duplicate_package_part',
        );
      names.add(entry.name);
      total += entry.originalSize;
      if (
        names.size > limits.maxZipEntries ||
        total > limits.maxUncompressedBytes
      )
        throw new OfficeParseError('limit_exceeded', 'package_expansion');
      if (/^xl\/worksheets\/[^/]+\.xml$/.test(entry.name))
        worksheetPaths.add(entry.name);
      return (
        /^ppt\/slides\/_rels\/slide[0-9]+\.xml\.rels$/.test(entry.name) ||
        [
          'ppt/presentation.xml',
          'ppt/_rels/presentation.xml.rels',
          'xl/workbook.xml',
          'xl/_rels/workbook.xml.rels',
          'xl/sharedStrings.xml',
        ].includes(entry.name)
      );
    },
  });
  return { parts, worksheetPaths, names };
}
