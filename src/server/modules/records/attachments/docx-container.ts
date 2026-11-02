import { crc32, inflateRawSync } from 'node:zlib';
import { DocumentFault } from './document-protocol';

/** Budget validation only: no XML/text extraction. Mammoth remains the decoder.
 * Match the exact same central/local member bytes that JSZip will subsequently use.
 */
export function assertDocxContainer(
  bytes: Uint8Array,
  maxUncompressedBytes: number,
) {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const invalid = () => {
    throw new DocumentFault('invalid_content');
  };
  const capped = () => {
    throw new DocumentFault('resource_limit');
  };
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (
      data.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + data.readUInt16LE(i + 20) === data.length
    ) {
      end = i;
      break;
    }
  }
  if (end < 0) return invalid();
  const count = data.readUInt16LE(end + 10),
    size = data.readUInt32LE(end + 12),
    offset = data.readUInt32LE(end + 16);
  if (
    data.readUInt16LE(end + 4) !== 0 ||
    data.readUInt16LE(end + 6) !== 0 ||
    data.readUInt16LE(end + 8) !== count
  )
    return invalid();
  if (
    count === 0xffff ||
    size === 0xffffffff ||
    offset === 0xffffffff ||
    count > 1024
  )
    return capped();
  if (offset + size !== end) return invalid();
  const names = new Set<string>();
  const ranges: Array<[number, number]> = [];
  let cursor = offset,
    total = 0;
  for (let n = 0; n < count; n++) {
    if (cursor + 46 > end || data.readUInt32LE(cursor) !== 0x02014b50)
      return invalid();
    const flags = data.readUInt16LE(cursor + 8),
      method = data.readUInt16LE(cursor + 10),
      crc = data.readUInt32LE(cursor + 16);
    const compressed = data.readUInt32LE(cursor + 20),
      uncompressed = data.readUInt32LE(cursor + 24);
    const nameLength = data.readUInt16LE(cursor + 28),
      extraLength = data.readUInt16LE(cursor + 30),
      commentLength = data.readUInt16LE(cursor + 32),
      local = data.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (
      next > end ||
      local + 30 > offset ||
      data.readUInt32LE(local) !== 0x04034b50
    )
      return invalid();
    if (
      (flags & 1) !== 0 ||
      ![0, 8].includes(method) ||
      compressed === 0xffffffff ||
      uncompressed === 0xffffffff ||
      local === 0xffffffff
    )
      return invalid();
    const nameBytes = data.subarray(cursor + 46, cursor + 46 + nameLength);
    let name: string;
    try {
      name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
    } catch {
      return invalid();
    }
    const segments = name.replace(/\/$/, '').split('/');
    if (
      !name ||
      name.startsWith('/') ||
      /[\\\0:]/.test(name) ||
      segments.some((s) => !s || s === '.' || s === '..')
    )
      return invalid();
    const normalized = name.normalize('NFC');
    if (names.has(normalized)) return invalid();
    names.add(normalized);
    for (
      let at = cursor + 46 + nameLength;
      at < cursor + 46 + nameLength + extraLength;
    ) {
      if (at + 4 > next - commentLength) return invalid();
      const kind = data.readUInt16LE(at),
        length = data.readUInt16LE(at + 2);
      at += 4 + length;
      // ZIP64 and Unicode-path overrides could change the member JSZip chooses.
      if (at > next - commentLength || kind === 0x0001 || kind === 0x7075)
        return invalid();
    }
    const localFlags = data.readUInt16LE(local + 6),
      localMethod = data.readUInt16LE(local + 8),
      localNameLength = data.readUInt16LE(local + 26),
      localExtraLength = data.readUInt16LE(local + 28);
    const start = local + 30 + localNameLength + localExtraLength,
      finish = start + compressed;
    if (
      localFlags !== flags ||
      localMethod !== method ||
      localNameLength !== nameLength ||
      finish > offset ||
      !data.subarray(local + 30, local + 30 + localNameLength).equals(nameBytes)
    )
      return invalid();
    if (
      (flags & 8) === 0 &&
      (data.readUInt32LE(local + 14) !== crc ||
        data.readUInt32LE(local + 18) !== compressed ||
        data.readUInt32LE(local + 22) !== uncompressed)
    )
      return invalid();
    if (uncompressed > maxUncompressedBytes - total) return capped();
    let output: Buffer;
    if (method === 0) output = data.subarray(start, finish);
    else {
      try {
        output = inflateRawSync(data.subarray(start, finish), {
          maxOutputLength: Math.max(1, maxUncompressedBytes - total),
        });
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ERR_BUFFER_TOO_LARGE'
        )
          return capped();
        return invalid();
      }
    }
    total += output.byteLength;
    if (total > maxUncompressedBytes) return capped();
    if (output.byteLength !== uncompressed || crc32(output) !== crc)
      return invalid();
    ranges.push([local, finish]);
    cursor = next;
  }
  if (
    cursor !== end ||
    !names.has('word/document.xml') ||
    !names.has('[Content_Types].xml') ||
    !names.has('_rels/.rels')
  )
    return invalid();
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++)
    if (ranges[i][0] < ranges[i - 1][1]) return invalid();
}
