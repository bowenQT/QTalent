import mammoth from 'mammoth';
import { assertDocxContainer } from './docx-container';
import {
  DocumentFault,
  type DocumentMessage,
  type DocumentOutcome,
} from './document-protocol';
import type { AttachmentSegment } from './types';

class UnsupportedBody extends Error {}
function node(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new DocumentFault('invalid_content');
  return value as Record<string, unknown>;
}
function children(value: Record<string, unknown>): unknown[] {
  if (!Array.isArray(value.children))
    throw new DocumentFault('invalid_content');
  return value.children;
}
function inlineText(value: unknown): string {
  const item = node(value);
  switch (item.type) {
    case 'text':
      if (typeof item.value !== 'string')
        throw new DocumentFault('invalid_content');
      return item.value;
    case 'run':
    case 'hyperlink':
      return children(item).map(inlineText).join('');
    case 'tab':
      return '\t';
    case 'break':
      if (
        item.breakType === 'line' ||
        item.breakType === 'page' ||
        item.breakType === 'column'
      )
        return '\n';
      throw new UnsupportedBody();
    case 'bookmarkStart':
      return '';
    default:
      throw new UnsupportedBody();
  }
}
export async function decodeDocx(
  message: DocumentMessage,
): Promise<DocumentOutcome> {
  assertDocxContainer(message.bytes, message.budget.maxUncompressedBytes);
  const segments: AttachmentSegment[] = [];
  let total = 0;
  try {
    const result = await mammoth.convertToHtml(
      { buffer: Buffer.from(message.bytes) },
      {
        externalFileAccess: false,
        includeEmbeddedStyleMap: false,
        includeDefaultStyleMap: false,
        ignoreEmptyParagraphs: false,
        transformDocument: (value: unknown) => {
          const document = node(value);
          if (document.type !== 'document')
            throw new DocumentFault('invalid_content');
          children(document).forEach((value, index) => {
            const paragraph = node(value);
            if (paragraph.type !== 'paragraph') throw new UnsupportedBody();
            const raw = children(paragraph).map(inlineText).join(''),
              excerpt = raw.trim();
            if (!excerpt) return;
            total += excerpt.length;
            if (
              excerpt.length > message.limits.maxFragmentChars ||
              segments.length >= message.limits.maxFragments ||
              total > message.budget.maxOutputChars
            )
              throw new DocumentFault('resource_limit');
            const start = raw.length - raw.trimStart().length;
            segments.push({
              excerpt,
              location: {
                kind: 'document',
                paragraph: `docx:body:p${index + 1}:u16:${start}-${start + excerpt.length}`,
              },
            });
          });
          // Semantic text was collected above. Never return/render generated HTML.
          return { ...document, children: [] };
        },
      },
    );
    if (result.messages.length > 0)
      return { status: 'unsupported', reason: 'format' };
    return { status: 'decoded', segments };
  } catch (error) {
    if (error instanceof UnsupportedBody)
      return { status: 'unsupported', reason: 'format' };
    throw error;
  }
}
