import { KodoError, statusError } from './protocol';

const MAX_ERROR_BYTES = 8 * 1024;
const xmlWhitespace = (value: string) =>
  value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');

function validXmlText(value: string): boolean {
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]|\]\]>/.test(value))
    return false;
  if (
    value
      .replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);/g, '')
      .includes('&')
  )
    return false;
  for (const match of value.matchAll(/&#(x[\da-fA-F]+|\d+);/g)) {
    const point = match[1].startsWith('x')
      ? Number.parseInt(match[1].slice(1), 16)
      : Number(match[1]);
    if (
      point !== 9 &&
      point !== 10 &&
      point !== 13 &&
      !(point >= 0x20 && point <= 0xd7ff) &&
      !(point >= 0xe000 && point <= 0xfffd) &&
      !(point >= 0x10000 && point <= 0x10ffff)
    )
      return false;
  }
  return true;
}

/** Conservative S3 scalar Error envelope, not a general XML parser.
 * Ambiguous/unsupported markup, entities, duplicate fields and incomplete XML
 * cannot grant a more specific classification. No entity is expanded.
 */
function errorCode(text: string): string | undefined {
  if (text.startsWith('<?xml')) {
    const declaration =
      /^<\?xml[ \t\r\n]+version=(?:"1\.0"|'1\.0')(?:[ \t\r\n]+encoding=(?:"UTF-8"|'UTF-8'))?[ \t\r\n]*\?>/.exec(
        text,
      );
    if (!declaration) return;
    text = text.slice(declaration[0].length);
  }
  const root =
    /^<Error(?:[ \t\r\n]+xmlns=(?:"http:\/\/s3\.amazonaws\.com\/doc\/2006-03-01\/"|'http:\/\/s3\.amazonaws\.com\/doc\/2006-03-01\/'))?[ \t\r\n]*>([\s\S]*)<\/Error>$/.exec(
      xmlWhitespace(text),
    );
  if (!root) return;
  const fields =
    /<([A-Za-z][A-Za-z0-9]*)>([^<>]*)<\/\1>|<([A-Za-z][A-Za-z0-9]*)[ \t\r\n]*\/>/g;
  const seen = new Set<string>();
  let end = 0;
  let code: string | undefined;
  for (const match of root[1].matchAll(fields)) {
    if (xmlWhitespace(root[1].slice(end, match.index))) return;
    const name = match[1] ?? match[3];
    const value = match[2] ?? '';
    if (seen.has(name) || !validXmlText(value)) return;
    seen.add(name);
    end = match.index + match[0].length;
    if (name === 'Code') code = xmlWhitespace(value);
  }
  if (xmlWhitespace(root[1].slice(end))) return;
  return code;
}

/** Only the two reviewed HTTP400 S3 read codes are normalized.
 * Native upload/stat calls never use this function. All body material is
 * transient and discarded; only the existing safe code/status escape.
 */
export async function readS3Error(
  response: Response,
  signal: AbortSignal,
): Promise<KodoError> {
  const fallback = statusError(response.status);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let rejectStop!: (error: KodoError) => void;
  const stopped = new Promise<never>((_, reject) => {
    rejectStop = reject;
  });
  const abort = () => rejectStop(new KodoError('cancelled'));
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) throw new KodoError('cancelled');
    if (response.status !== 400 || !response.body) return fallback;
    const length = response.headers.get('content-length');
    if (length && /^\d+$/.test(length) && Number(length) > MAX_ERROR_BYTES)
      return fallback;
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const next = await Promise.race([reader.read(), stopped]);
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_ERROR_BYTES) return fallback;
      chunks.push(next.value);
    }
    const code = errorCode(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
    );
    if (code === 'ExpiredToken') return new KodoError('expired', 400);
    if (code === 'NotSupportAnonymous')
      return new KodoError('unauthorized', 400);
    return fallback;
  } catch {
    if (signal.aborted) throw new KodoError('cancelled');
    return fallback;
  } finally {
    signal.removeEventListener('abort', abort);
    // Cleanup cannot retain provider exceptions or stall on a broken cancel hook.
    if (reader) {
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    } else if (response.body && !response.body.locked) {
      void response.body.cancel().catch(() => undefined);
    }
  }
}
