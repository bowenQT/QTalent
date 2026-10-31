import { describe, expect, it, vi } from 'vitest';
import { fixture } from '../../../../../tests/fixtures/upload-fake';
import { verifyUploadObject } from './content';
import { MEDIA_FORMATS } from '../../../../contracts/media';

function zip() {
  const names = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'];
  const central = names.map((name) => {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50);
    header.writeUInt16LE(Buffer.byteLength(name), 28);
    return Buffer.concat([header, Buffer.from(name)]);
  });
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(3, 8);
  end.writeUInt16LE(3, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, directory, end]);
}
function audio(extension: string) {
  if (extension === 'mp3')
    return Buffer.from([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0]);
  if (extension === 'aac')
    return Buffer.from([0xff, 0xf1, 0x50, 0x80, 0, 0, 0]);
  if (extension === 'm4a') {
    const bytes = Buffer.alloc(24);
    bytes.writeUInt32BE(24);
    bytes.write('ftypM4A ', 4);
    return bytes;
  }
  const bytes = Buffer.alloc(44);
  bytes.write('RIFF');
  bytes.writeUInt32LE(36, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.write('data', 36);
  return bytes;
}
describe('bounded server content verification', () => {
  it.each(MEDIA_FORMATS.map((f) => f.extension))(
    'classifies %s independently of the notification',
    async (extension) => {
      const f = fixture();
      const format = MEDIA_FORMATS.find(
        (format) => format.extension === extension,
      )!;
      const bytes =
        extension === 'txt'
          ? Buffer.from('演示')
          : extension === 'pdf'
            ? Buffer.from('%PDF-1.7\nsynthetic\n%%EOF\n')
            : extension === 'docx'
              ? zip()
              : audio(extension);
      await f.put('synthetic/content', bytes, format.mediaTypes[0]);
      const verified = await verifyUploadObject(
        f.options.storage,
        'synthetic/content',
        {
          ...f.request,
          purpose: format.purpose,
          filename: `demo.${extension}`,
          declaredBytes: bytes.length,
          declaredMediaType: format.mediaTypes[0],
        },
      );
      expect(verified.byteLength).toBe(bytes.length);
      expect(verified.sha256).toMatch(/^[a-f0-9]{64}$/);
    },
  );
  it('accepts a one-byte TXT, validates all UTF8 chunks and rejects invalid/binary content', async () => {
    const f = fixture();
    await f.put('synthetic/tiny', Buffer.from('x'));
    await expect(
      verifyUploadObject(f.options.storage, 'synthetic/tiny', {
        ...f.request,
        declaredBytes: 1,
      }),
    ).resolves.toHaveProperty('byteLength', 1);
    await f.put('synthetic/invalid', new Uint8Array([0xff, 0xff, 0xff, 0xff]));
    await expect(
      verifyUploadObject(f.options.storage, 'synthetic/invalid', {
        ...f.request,
        declaredBytes: 4,
      }),
    ).rejects.toMatchObject({ reason: 'invalid_content' });
  });
  it('rejects a file masquerading as PDF or DOCX', async () => {
    for (const extension of ['pdf', 'docx'] as const) {
      const f = fixture();
      const format = MEDIA_FORMATS.find(
        (format) => format.extension === extension,
      )!;
      await f.put(
        'synthetic/spoof',
        Buffer.from('ordinary text'),
        format.mediaTypes[0],
      );
      await expect(
        verifyUploadObject(f.options.storage, 'synthetic/spoof', {
          ...f.request,
          filename: `demo.${extension}`,
          declaredBytes: 13,
          declaredMediaType: format.mediaTypes[0],
        }),
      ).rejects.toMatchObject({ reason: 'invalid_content' });
    }
  });
  it('checks actual stream length, changed provider etag, and redacts upstream failures', async () => {
    const f = fixture();
    await f.put('synthetic/object');
    const stat = await f.options.storage.statObject({
      objectKey: 'synthetic/object',
    });
    vi.spyOn(f.options.storage, 'statObject')
      .mockResolvedValueOnce(stat)
      .mockResolvedValueOnce({ ...stat, etag: 'replaced' });
    await expect(
      verifyUploadObject(f.options.storage, 'synthetic/object', f.request),
    ).rejects.toMatchObject({ reason: 'object_mismatch' });
    vi.spyOn(f.options.storage, 'openObject').mockRejectedValue(
      new Error('https://private.invalid?token=secret'),
    );
    await expect(
      verifyUploadObject(f.options.storage, 'synthetic/object', f.request),
    ).rejects.toMatchObject({ message: 'object_verification_unavailable' });
  });
});
