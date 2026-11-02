import { DOMParser, type Element } from '@xmldom/xmldom';
import { OfficeParseError } from './types';

export function xml(text: string): Element {
  const doc = new DOMParser({
    onError: () => {
      throw new OfficeParseError('invalid_document', 'malformed_xml');
    },
  }).parseFromString(text, 'application/xml');
  if (doc.doctype || !doc.documentElement)
    throw new OfficeParseError('unsupported_content', 'xml_document_type');
  return doc.documentElement;
}
export function part(parts: Record<string, Uint8Array>, name: string): Element {
  const value = parts[name];
  if (!value)
    throw new OfficeParseError('invalid_document', 'missing_package_part');
  return xml(new TextDecoder('utf-8', { fatal: true }).decode(value));
}
export function elements(
  parent: Element,
  name: string,
  namespace: string,
): Element[] {
  return Array.from(parent.childNodes).filter(
    (n): n is Element =>
      n.nodeType === 1 && n.localName === name && n.namespaceURI === namespace,
  );
}
