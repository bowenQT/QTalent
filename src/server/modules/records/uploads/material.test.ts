import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { fixture } from '../../../../../tests/fixtures/upload-fake';
import { isSupportedMaterial, materialFormatFor } from './material-formats';
import { createUploadService } from './service';

function material(
  f: ReturnType<typeof fixture>,
  file: Partial<{
    purpose: string;
    filename: string;
    declaredMediaType: string;
    declaredBytes: number;
  }> = {},
) {
  return {
    ...f.request,
    purpose: 'image',
    filename: 'demo.png',
    declaredMediaType: 'image/png',
    target: { kind: 'unassigned', evaluationNodeId: 'demo-node' },
    ...file,
  };
}
async function deliver(
  f: ReturnType<typeof fixture>,
  bytes: Uint8Array<ArrayBuffer>,
  file: Parameters<typeof material>[1],
) {
  const service = createUploadService(f.options);
  const declared = material(f, { ...file, declaredBytes: bytes.length });
  const granted = await service.requestMaterial('account', declared);
  if (granted.status !== 'success') throw new Error(granted.status);
  await f.put(granted.upload.objectKey, bytes, declared.declaredMediaType);
  return service.complete('account', {
    uploadId: granted.upload.uploadId,
    receiptRef: 'notice',
    operationId: 'complete',
    expectedRevision: granted.upload.revision,
  });
}
const png = () =>
  sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } })
    .png()
    .toBuffer()
    .then((buffer) => new Uint8Array(buffer));
const jpeg = () =>
  sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } })
    .jpeg()
    .toBuffer()
    .then((buffer) => new Uint8Array(buffer));
function mp4(brand: string) {
  const box = Buffer.alloc(24);
  box.writeUInt32BE(24, 0);
  box.write('ftyp', 4, 'ascii');
  box.write(brand, 8, 'ascii');
  box.write('isom', 16, 'ascii');
  box.write('mp41', 20, 'ascii');
  return new Uint8Array(Buffer.concat([box, Buffer.from('演示视频帧')]));
}

describe('material formats', () => {
  it('matches the declared extension and media type of one format', () => {
    expect(
      isSupportedMaterial({
        purpose: 'video',
        filename: 'Demo.MP4',
        declaredMediaType: 'Video/MP4',
      }),
    ).toBe(true);
    expect(
      isSupportedMaterial({
        purpose: 'image',
        filename: 'demo.png',
        declaredMediaType: 'image/jpeg',
      }),
    ).toBe(false);
    expect(
      materialFormatFor({ purpose: 'audio', filename: 'demo.png' }),
    ).toBeUndefined();
  });
});

describe('material grant', () => {
  it('grants an unassigned staging upload with the server-resolved collection', async () => {
    const f = fixture();
    const result = await createUploadService(f.options).requestMaterial(
      'account',
      material(f, { declaredBytes: 64 }),
    );
    expect(result).toMatchObject({
      status: 'success',
      upload: {
        recordCollectionId: f.request.recordCollectionId,
        maxBytes: 64,
        method: 'resumable_v2',
      },
    });
    expect(f.snapshot().intents).toHaveLength(1);
  });

  it('answers format and size before any grant', async () => {
    const f = fixture();
    const service = createUploadService({ ...f.options, adapterMaxBytes: 100 });
    await expect(
      service.requestMaterial(
        'account',
        material(f, { filename: 'demo.gif', declaredMediaType: 'image/gif' }),
      ),
    ).resolves.toMatchObject({ status: 'unsupported', reason: 'format' });
    await expect(
      service.requestMaterial(
        'account',
        material(f, { declaredBytes: 3 * 1024 ** 3 }),
      ),
    ).resolves.toMatchObject({ status: 'unsupported', reason: 'size' });
    await expect(
      service.requestMaterial('account', material(f, { declaredBytes: 101 })),
    ).resolves.toMatchObject({ status: 'unsupported', reason: 'size' });
    expect(f.snapshot().intents).toHaveLength(0);
  });

  it('accepts only unassigned targets and a valid declaration from a signed-in account', async () => {
    const f = fixture();
    const service = createUploadService(f.options);
    await expect(
      service.requestMaterial('account', {
        ...material(f),
        target: { kind: 'people', personIds: ['demo-person-1'] },
      }),
    ).rejects.toMatchObject({
      status: 'validation_error',
      reason: 'material_target_unsupported',
    });
    await expect(
      service.requestMaterial('account', {
        ...material(f),
        filename: 'a/b.png',
      }),
    ).rejects.toMatchObject({ status: 'validation_error' });
    await expect(
      service.requestMaterial(null, material(f)),
    ).rejects.toMatchObject({ status: 'unauthenticated' });
    f.deny();
    await expect(
      service.requestMaterial('account', material(f)),
    ).rejects.toMatchObject({ status: 'forbidden' });
  });
});

describe('material completion', () => {
  it('verifies PNG, JPEG and MP4 containers and archives the original', async () => {
    for (const [bytes, file] of [
      [await png(), {}],
      [await jpeg(), { filename: 'demo.jpg', declaredMediaType: 'image/jpeg' }],
      [
        mp4('isom'),
        {
          purpose: 'video',
          filename: 'demo.mp4',
          declaredMediaType: 'video/mp4',
        },
      ],
    ] as const) {
      const f = fixture();
      const completed = await deliver(f, bytes, file);
      expect(completed).toMatchObject({
        status: 'staged',
        recordCollectionId: f.request.recordCollectionId,
        source: null,
      });
      expect(completed).not.toHaveProperty('jobId');
      expect(f.snapshot()).toMatchObject({ jobs: [] });
      expect(f.snapshot().objects).toHaveLength(1);
    }
  });

  it('rejects content that does not match the declared container', async () => {
    const truncated = (await png()).slice(0, -12);
    const jpegWithoutEnd = (await jpeg()).slice(0, -2);
    for (const [bytes, file] of [
      [truncated, {}],
      [
        jpegWithoutEnd,
        { filename: 'demo.jpg', declaredMediaType: 'image/jpeg' },
      ],
      [
        mp4('M4A '),
        {
          purpose: 'video',
          filename: 'demo.mp4',
          declaredMediaType: 'video/mp4',
        },
      ],
    ] as const) {
      const f = fixture();
      await expect(deliver(f, bytes, file)).rejects.toMatchObject({
        status: 'validation_error',
        reason: 'invalid_content',
      });
      expect(f.snapshot().objects).toHaveLength(0);
    }
  });
});
