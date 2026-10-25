import type { SourceReference } from '../../../../contracts/sources';
import type {
  AttachmentParseOutcome,
  ParsedAttachment,
  ParseAttachmentInput,
} from './types';
export * from './types';
export async function parseAttachment(
  _input: ParseAttachmentInput,
): Promise<AttachmentParseOutcome> {
  throw new Error('not implemented');
}
export function resolveAttachmentQuote(
  _parsed: ParsedAttachment,
  _fragmentId: string,
  _quote: string,
  _start: number,
): SourceReference | null {
  throw new Error('not implemented');
}
