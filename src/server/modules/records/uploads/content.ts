import { createHash } from 'node:crypto';
import { MEDIA_FORMATS, type UploadRequest } from '../../../../contracts/media';
import { KodoError } from '../../../integrations/kodo';
import { UploadError, type UploadStorage, type VerifiedObject } from './types';

const WINDOW = 128 * 1024;
export function formatFor(request: UploadRequest) {
  return MEDIA_FORMATS.find(
    (f) =>
      request.purpose === f.purpose &&
      request.filename.toLowerCase().endsWith(`.${f.extension}`),
  );
}
function frame(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] === 0xff &&
    (bytes[offset + 1] & 0xe0) === 0xe0 &&
    (bytes[offset + 1] & 6) !== 0 &&
    (bytes[offset + 2] & 0xf0) !== 0xf0 &&
    (bytes[offset + 2] & 0xf0) !== 0
  );
}
function docx(tail: Buffer): boolean {
  // Check the ZIP central directory, not arbitrary strings in compressed data.
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 5, 6]));
  if (eocd < 0 || eocd + 22 > tail.length) return false;
  if (
    tail.readUInt16LE(eocd + 4) !== 0 ||
    tail.readUInt16LE(eocd + 6) !== 0 ||
    eocd + 22 + tail.readUInt16LE(eocd + 20) !== tail.length
  )
    return false;
  const count = tail.readUInt16LE(eocd + 10);
  const size = tail.readUInt32LE(eocd + 12);
  let offset = eocd - size;
  if (!count || offset < 0) return false;
  const names = new Set<string>();
  for (let n = 0; n < count; n++) {
    if (
      offset < 0 ||
      offset + 46 > eocd ||
      tail.readUInt32LE(offset) !== 0x02014b50
    )
      return false;
    const nameLength = tail.readUInt16LE(offset + 28);
    const next =
      offset +
      46 +
      nameLength +
      tail.readUInt16LE(offset + 30) +
      tail.readUInt16LE(offset + 32);
    if (
      next > eocd ||
      (tail.readUInt16LE(offset + 8) & 1) !== 0 ||
      ![0, 8].includes(tail.readUInt16LE(offset + 10))
    )
      return false;
    names.add(tail.toString('utf8', offset + 46, offset + 46 + nameLength));
    offset = next;
  }
  return (
    offset === eocd &&
    ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'].every((name) =>
      names.has(name),
    )
  );
}
function matches(
  extension: string,
  head: Buffer,
  tail: Buffer,
  length: number,
) {
  switch (extension) {
    case 'txt':
      return true; // Entire stream was decoded strictly below.
    case 'pdf':
      return (
        /^%PDF-1\.[0-9]|^%PDF-2\.0/.test(head.toString('ascii', 0, 8)) &&
        /%%EOF\s*$/.test(tail.toString('latin1'))
      );
    case 'docx':
      return (
        head.length >= 4 && head.readUInt32LE(0) === 0x04034b50 && docx(tail)
      );
    case 'wav':
      return (
        head.length >= 20 &&
        head.toString('ascii', 0, 4) === 'RIFF' &&
        head.toString('ascii', 8, 12) === 'WAVE' &&
        head.readUInt32LE(4) + 8 === length &&
        head.includes(Buffer.from('fmt ')) &&
        head.includes(Buffer.from('data'))
      );
    case 'm4a':
      return (
        head.length >= 16 &&
        head.toString('ascii', 4, 8) === 'ftyp' &&
        head.readUInt32BE(0) >= 16 &&
        head.readUInt32BE(0) <= head.length &&
        head.toString('ascii', 8, head.readUInt32BE(0)).includes('M4A ')
      );
    case 'aac':
      return (
        head.length >= 7 &&
        head[0] === 0xff &&
        (head[1] & 0xf6) === 0xf0 &&
        ((head[2] >> 2) & 15) < 13
      );
    case 'mp3': {
      if (head.length < 4) return false;
      if (head.toString('ascii', 0, 3) !== 'ID3') return frame(head, 0);
      if (head.length < 10) return false;
      if (
        head[3] > 4 ||
        head[3] < 2 ||
        head.subarray(6, 10).some((n) => n > 127)
      )
        return false;
      const offset =
        10 +
        ((head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9]) +
        (head[5] & 0x10 ? 10 : 0);
      return offset + 4 <= head.length && frame(head, offset);
    }
    default:
      return false;
  }
}
/** Bounded container identification, not transcription, text extraction or OCR. */
export async function verifyUploadObject(
  storage: UploadStorage,
  key: string,
  request: UploadRequest,
): Promise<VerifiedObject> {
  try {
    const format = formatFor(request);
    const stat = await storage.statObject({ objectKey: key });
    if (
      !format ||
      stat.key !== key ||
      stat.byteLength !== request.declaredBytes ||
      stat.mediaType.toLowerCase() !==
        request.declaredMediaType.toLowerCase() ||
      !(format.mediaTypes as readonly string[]).includes(
        stat.mediaType.toLowerCase(),
      )
    )
      throw new UploadError('validation_error', 'object_mismatch');
    const opened = await storage.openObject({ objectKey: key });
    const reader = opened.body.getReader();
    const digest = createHash('sha256');
    const decoder =
      format.extension === 'txt'
        ? new TextDecoder('utf-8', { fatal: true })
        : null;
    let head = Buffer.alloc(0);
    let tail = Buffer.alloc(0);
    let length = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        const bytes = next.value;
        length += bytes.length;
        if (length > request.declaredBytes)
          throw new UploadError('validation_error', 'object_mismatch');
        digest.update(bytes);
        if (head.length < WINDOW)
          head = Buffer.concat([head, bytes.subarray(0, WINDOW - head.length)]);
        tail = Buffer.concat([
          tail,
          bytes.subarray(Math.max(0, bytes.length - WINDOW)),
        ]).subarray(-WINDOW);
        if (
          decoder &&
          /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(
            decoder.decode(bytes, { stream: true }),
          )
        )
          throw new UploadError('validation_error', 'invalid_content');
      }
      decoder?.decode();
    } catch (error) {
      await reader.cancel().catch(() => {});
      if (error instanceof TypeError && decoder)
        throw new UploadError('validation_error', 'invalid_content');
      throw error;
    } finally {
      reader.releaseLock();
      opened.close();
    }
    if (length !== request.declaredBytes)
      throw new UploadError('validation_error', 'object_mismatch');
    if (!matches(format.extension, head, tail, length))
      throw new UploadError('validation_error', 'invalid_content');
    const after = await storage.statObject({ objectKey: key });
    if (
      after.key !== key ||
      after.etag !== stat.etag ||
      after.byteLength !== stat.byteLength ||
      after.mediaType !== stat.mediaType
    )
      throw new UploadError('validation_error', 'object_mismatch');
    return {
      objectKey: key,
      byteLength: length,
      mediaType: stat.mediaType,
      sha256: digest.digest('hex'),
      etag: stat.etag,
    };
  } catch (error) {
    if (error instanceof UploadError) throw error;
    if (error instanceof KodoError && error.code === 'not_found')
      throw new UploadError('validation_error', 'object_missing');
    throw new UploadError('unavailable', 'object_verification_unavailable');
  }
}
