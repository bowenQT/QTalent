import type { SourceReference } from '../../../../contracts/sources';
import type { ParsedAttachment } from './types';
export * from './types';
export { parseAttachment, attachmentVersionSchema } from './parse';
export function resolveAttachmentQuote(
  parsed: ParsedAttachment,
  fragmentId: string,
  quote: string,
  start: number,
): SourceReference | null {
  if (!Number.isSafeInteger(start) || start < 0 || !/\S/.test(quote))
    return null;
  const fragment = parsed.fragments.find(
    (fragment) => fragment.fragmentId === fragmentId,
  );
  if (
    !fragment ||
    fragment.originalVersionId !== parsed.originalVersionId ||
    fragment.excerpt.slice(start, start + quote.length) !== quote
  )
    return null;
  return {
    fragmentId,
    originalVersionId: fragment.originalVersionId,
    location: { ...fragment.location },
  };
}
