import { posix } from 'node:path';
import type { Element } from '@xmldom/xmldom';
import type { packageMetadata } from './package';
import { elements, part } from './xml';
import { OfficeParseError } from './types';
const p = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rel = 'http://schemas.openxmlformats.org/package/2006/relationships';

function relationships(
  metadata: ReturnType<typeof packageMetadata>,
  path: string,
): Map<string, Element> {
  const root = part(metadata.parts, path);
  if (root.localName !== 'Relationships' || root.namespaceURI !== rel)
    throw new OfficeParseError(
      'invalid_document',
      'presentation_relationships',
    );
  const map = new Map<string, Element>();
  for (const entry of elements(root, 'Relationship', rel)) {
    const id = entry.getAttribute('Id');
    if (!id || map.has(id))
      throw new OfficeParseError('invalid_document', 'relationship_identity');
    map.set(id, entry);
  }
  return map;
}
function target(
  entry: Element | undefined,
  folder: string,
  kind: 'slide' | 'notesSlide',
  metadata: ReturnType<typeof packageMetadata>,
): string {
  const to = entry?.getAttribute('Target');
  const path = to ? posix.resolve('/', folder, to).slice(1) : '';
  if (
    !to ||
    entry?.getAttribute('TargetMode') === 'External' ||
    entry?.getAttribute('Type') !== `${r}/${kind}` ||
    !metadata.names.has(path)
  )
    throw new OfficeParseError('invalid_document', 'presentation_target');
  return path;
}
/** Prevent OfficeParser's numeric-filename fallback or partial slide-list recovery. */
export function presentationPages(
  metadata: ReturnType<typeof packageMetadata>,
): number {
  const root = part(metadata.parts, 'ppt/presentation.xml');
  if (root.localName !== 'presentation' || root.namespaceURI !== p)
    throw new OfficeParseError('invalid_document', 'presentation_identity');
  const lists = elements(root, 'sldIdLst', p);
  if (lists.length !== 1)
    throw new OfficeParseError('invalid_document', 'slide_list');
  const entries = elements(lists[0], 'sldId', p);
  if (!entries.length)
    throw new OfficeParseError('unsupported_content', 'empty_presentation');
  const map = relationships(metadata, 'ppt/_rels/presentation.xml.rels');
  const seen = new Set<string>();
  const notes = new Set<string>();
  for (const entry of entries) {
    const path = target(
      map.get(entry.getAttributeNS(r, 'id') ?? ''),
      'ppt',
      'slide',
      metadata,
    );
    if (!/^ppt\/slides\/slide[0-9]+\.xml$/.test(path) || seen.has(path))
      throw new OfficeParseError('invalid_document', 'slide_identity');
    seen.add(path);
    const relPath = `${posix.dirname(path)}/_rels/${posix.basename(path)}.rels`;
    if (!metadata.parts[relPath]) continue;
    for (const relation of relationships(metadata, relPath).values()) {
      if (relation.getAttribute('Type') !== `${r}/notesSlide`) continue;
      const note = target(
        relation,
        posix.dirname(path),
        'notesSlide',
        metadata,
      );
      if (
        !/^ppt\/notesSlides\/notesSlide[0-9]+\.xml$/.test(note) ||
        notes.has(note)
      )
        throw new OfficeParseError('invalid_document', 'ambiguous_notes');
      notes.add(note);
    }
  }
  return entries.length;
}
