import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import {
  cropMaterialImage,
  displayToStoredRegion,
  type ImageLimits,
  type ImageMime,
} from './crop';
const limits: ImageLimits = {
  maxInputBytes: 4 * 1024 * 1024,
  maxWidth: 4096,
  maxHeight: 4096,
  maxPixels: 1000000,
  maxDecodedBytes: 8000000,
  maxOutputBytes: 4 * 1024 * 1024,
  processingSeconds: 2,
  maxElapsedMs: 6000,
};
const digest = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const region = { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 };
function raw() {
  const b = Buffer.alloc(8 * 8 * 3);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const i = (y * 8 + x) * 3;
      b[i] = x * 28;
      b[i + 1] = y * 28;
      b[i + 2] = 120;
    }
  return b;
}
async function image(mime: ImageMime = 'image/png', orientation?: number) {
  let s = sharp(raw(), { raw: { width: 8, height: 8, channels: 3 } });
  if (orientation) s = s.withMetadata({ orientation });
  return mime === 'image/jpeg'
    ? s.jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer()
    : mime === 'image/webp'
      ? s.webp({ lossless: true }).toBuffer()
      : s.png().toBuffer();
}
function input(
  bytes: Uint8Array,
  mediaType: ImageMime = 'image/png',
  r = region,
) {
  return {
    bytes,
    mediaType,
    originalId: 'original-a',
    sha256: digest(bytes),
    source: {
      fragmentId: 'fragment-a',
      originalVersionId: 'version-a',
      location: { kind: 'image' as const, region: r },
    },
  };
}
async function decoded(b: Uint8Array) {
  return sharp(b).removeAlpha().raw().toBuffer();
}
function slice(
  b: Buffer,
  box: { left: number; top: number; width: number; height: number },
) {
  return Buffer.concat(
    Array.from({ length: box.height }, (_, n) =>
      b.subarray(
        ((n + box.top) * 8 + box.left) * 3,
        ((n + box.top) * 8 + box.left + box.width) * 3,
      ),
    ),
  );
}
it.each(['image/png', 'image/jpeg', 'image/webp'] as const)(
  '%s真实裁剪，像素只来自授权框，原件出处与实际像素框分开保留',
  async (mime) => {
    const bytes = await image(mime),
      value = input(bytes, mime);
    const cropped = await cropMaterialImage(value, limits);
    expect(cropped.pixelRegion).toEqual({
      left: 2,
      top: 2,
      width: 4,
      height: 4,
    });
    expect(await decoded(cropped.png)).toEqual(
      slice(await decoded(bytes), cropped.pixelRegion),
    );
    expect(cropped.source).toEqual(value.source);
    expect(cropped.originalId).toBe(value.originalId);
    expect(cropped.originalSha256).toBe(value.sha256);
    expect(cropped.sha256).toBe(digest(cropped.png));
    const m = await sharp(cropped.png).metadata();
    expect(m).toMatchObject({ format: 'png', width: 4, height: 4 });
    expect(m.exif).toBeUndefined();
    expect(m.icc).toBeUndefined();
  },
);
const display = { left: 0.125, top: 0.25, right: 0.5, bottom: 0.875 };
const mapped = [
  { left: 0.125, top: 0.25, right: 0.5, bottom: 0.875 },
  { left: 0.5, top: 0.25, right: 0.875, bottom: 0.875 },
  { left: 0.5, top: 0.125, right: 0.875, bottom: 0.75 },
  { left: 0.125, top: 0.125, right: 0.5, bottom: 0.75 },
  { left: 0.25, top: 0.125, right: 0.875, bottom: 0.5 },
  { left: 0.25, top: 0.5, right: 0.875, bottom: 0.875 },
  { left: 0.125, top: 0.5, right: 0.75, bottom: 0.875 },
  { left: 0.125, top: 0.125, right: 0.75, bottom: 0.5 },
];
const boxes = [
  { left: 1, top: 2, width: 3, height: 5 },
  { left: 4, top: 2, width: 3, height: 5 },
  { left: 4, top: 1, width: 3, height: 5 },
  { left: 1, top: 1, width: 3, height: 5 },
  { left: 2, top: 1, width: 5, height: 3 },
  { left: 2, top: 4, width: 5, height: 3 },
  { left: 1, top: 4, width: 5, height: 3 },
  { left: 1, top: 1, width: 5, height: 3 },
];
it.each([1, 2, 3, 4, 5, 6, 7, 8])(
  'EXIF方向%d：显示坐标反映射后在存储像素空间裁剪，框外不进入结果',
  async (orientation) => {
    const stored = displayToStoredRegion(display, orientation);
    expect(stored).toEqual(mapped[orientation - 1]);
    const bytes = await image('image/jpeg', orientation),
      result = await cropMaterialImage(
        input(bytes, 'image/jpeg', stored),
        limits,
      );
    expect(result.orientation).toBe(orientation);
    expect(result.pixelRegion).toEqual(boxes[orientation - 1]);
    expect(await decoded(result.png)).toEqual(
      slice(await decoded(bytes), boxes[orientation - 1]!),
    );
    expect((await sharp(result.png).metadata()).orientation).toBeUndefined();
  },
);
it('向内取整，不扩大分数像素批准框；不足一个完整像素则拒绝', async () => {
  const bytes = await image();
  const result = await cropMaterialImage(
    input(bytes, 'image/png', {
      left: 0.13,
      top: 0.14,
      right: 0.76,
      bottom: 0.77,
    }),
    limits,
  );
  expect(result.pixelRegion).toEqual({ left: 2, top: 2, width: 4, height: 4 });
  expect(result.actualRegion).toEqual(region);
  await expect(
    cropMaterialImage(
      input(bytes, 'image/png', {
        left: 0.13,
        top: 0.1,
        right: 0.14,
        bottom: 0.2,
      }),
      limits,
    ),
  ).rejects.toMatchObject({ code: 'invalid_content' });
  expect(() => displayToStoredRegion(display, 9)).toThrow();
});
it('裁后重编码移除原EXIF/XMP，透明像素固定白底，不能夹带隐藏RGB', async () => {
  const bytes = await sharp(Buffer.from([190, 3, 17, 0, 10, 50, 200, 255]), {
    raw: { width: 2, height: 1, channels: 4 },
  })
    .png()
    .withExif({ IFD0: { Artist: 'DEMO_PRIVATE_METADATA' } })
    .withXmp(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">DEMO_PRIVATE_METADATA</x:xmpmeta>',
    )
    .toBuffer();
  const result = await cropMaterialImage(
    input(bytes, 'image/png', { left: 0, top: 0, right: 1, bottom: 1 }),
    limits,
  );
  expect(await decoded(result.png)).toEqual(
    Buffer.from([255, 255, 255, 10, 50, 200]),
  );
  expect(result.png.includes(Buffer.from('DEMO_PRIVATE_METADATA'))).toBe(false);
  const meta = await sharp(result.png).metadata();
  expect(meta.exif).toBeUndefined();
  expect(meta.xmp).toBeUndefined();
  expect(meta.hasAlpha).toBe(false);
});
it.each(['input', 'width', 'height', 'pixels', 'decoded', 'output'] as const)(
  '%s预算失败，不回退原图',
  async (kind) => {
    const bytes = await image();
    const cap = { ...limits };
    if (kind === 'input') cap.maxInputBytes = bytes.length - 1;
    if (kind === 'width') cap.maxWidth = 7;
    if (kind === 'height') cap.maxHeight = 7;
    if (kind === 'pixels') cap.maxPixels = 63;
    if (kind === 'decoded') cap.maxDecodedBytes = 16;
    if (kind === 'output') cap.maxOutputBytes = 8;
    await expect(cropMaterialImage(input(bytes), cap)).rejects.toMatchObject({
      code: 'resource_limit',
    });
  },
);
it('摘要、MIME和真实编码必须匹配；坏内容与取消均不返回裁图', async () => {
  const bytes = await image();
  await expect(
    cropMaterialImage({ ...input(bytes), sha256: '0'.repeat(64) }, limits),
  ).rejects.toMatchObject({ code: 'conflict' });
  await expect(
    cropMaterialImage(input(bytes, 'image/jpeg'), limits),
  ).rejects.toMatchObject({ code: 'invalid_content' });
  await expect(
    cropMaterialImage(input(bytes.subarray(0, 32)), limits),
  ).rejects.toMatchObject({ code: 'invalid_content' });
  await expect(
    cropMaterialImage(input(Buffer.from('not-an-image')), limits),
  ).rejects.toMatchObject({ code: 'unsupported' });
  const a = new AbortController();
  a.abort();
  await expect(
    cropMaterialImage(input(bytes), limits, a.signal),
  ).rejects.toMatchObject({ code: 'cancelled' });
  await expect(
    cropMaterialImage(input(bytes), { ...limits, maxPixels: 0 }),
  ).rejects.toThrow();
});
function chunk(name: string, data: Buffer) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  out.write(name, 4, 'ascii');
  data.copy(out, 8);
  let c = 0xffffffff;
  for (const b of out.subarray(4, -4)) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  out.writeUInt32BE((c ^ 0xffffffff) >>> 0, out.length - 4);
  return out;
}
function apng() {
  const h = Buffer.alloc(13);
  h.writeUInt32BE(2);
  h.writeUInt32BE(2, 4);
  h[8] = 8;
  h[9] = 2;
  const control = Buffer.alloc(8);
  control.writeUInt32BE(2);
  const frame = (sequence: number) => {
    const b = Buffer.alloc(26);
    b.writeUInt32BE(sequence);
    b.writeUInt32BE(2, 4);
    b.writeUInt32BE(2, 8);
    b.writeUInt16BE(1, 20);
    b.writeUInt16BE(10, 22);
    return b;
  };
  const pixels = deflateSync(
    Buffer.from([0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255]),
  );
  const fd = Buffer.alloc(4 + pixels.length);
  fd.writeUInt32BE(2);
  pixels.copy(fd, 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', h),
    chunk('acTL', control),
    chunk('fcTL', frame(0)),
    chunk('IDAT', pixels),
    chunk('fcTL', frame(1)),
    chunk('fdAT', fd),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function riffChunk(name: string, payload: Buffer) {
  const b = Buffer.alloc(8 + payload.length + (payload.length % 2));
  b.write(name, 0, 'ascii');
  b.writeUInt32LE(payload.length, 4);
  payload.copy(b, 8);
  return b;
}
async function animatedWebp() {
  const encoded = await image('image/webp');
  const bodyChunks = encoded.subarray(12);
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 2;
  vp8x.writeUIntLE(7, 4, 3);
  vp8x.writeUIntLE(7, 7, 3);
  const frame = Buffer.alloc(16);
  frame.writeUIntLE(7, 6, 3);
  frame.writeUIntLE(7, 9, 3);
  frame.writeUIntLE(100, 12, 3);
  const body = Buffer.concat([
    riffChunk('VP8X', vp8x),
    riffChunk('ANIM', Buffer.alloc(6)),
    riffChunk('ANMF', Buffer.concat([frame, bodyChunks])),
    riffChunk('ANMF', Buffer.concat([frame, bodyChunks])),
  ]);
  const header = Buffer.alloc(12);
  header.write('RIFF');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8);
  return Buffer.concat([header, body]);
}
it('真实多帧WebP/APNG明确拒绝，不静默读取第一帧；JPEG拼接也拒绝', async () => {
  const a = await animatedWebp();
  expect((await sharp(a).metadata()).pages).toBe(2);
  for (const [bytes, mime] of [
    [a, 'image/webp'],
    [apng(), 'image/png'],
  ] as const)
    await expect(
      cropMaterialImage(input(bytes, mime), limits),
    ).rejects.toMatchObject({ code: 'unsupported' });
  const jpg = await image('image/jpeg');
  await expect(
    cropMaterialImage(input(Buffer.concat([jpg, jpg]), 'image/jpeg'), limits),
  ).rejects.toMatchObject({ code: 'unsupported' });
});

it('PNG/WebP/JPEG容器损坏和额外图像在解码前拒绝', async () => {
  const png = await image(),
    webp = await image('image/webp'),
    jpeg = await image('image/jpeg');
  const badFirst = Buffer.from(png);
  badFirst.write('IDAT', 12, 'ascii');
  const hugeChunk = Buffer.from(png);
  hugeChunk.writeUInt32BE(0x7fffffff, 33);
  const riff = (body: Buffer) => {
    const h = Buffer.alloc(12);
    h.write('RIFF');
    h.writeUInt32LE(body.length + 4, 4);
    h.write('WEBP', 8);
    return Buffer.concat([h, body]);
  };
  const pad = riffChunk('JUNK', Buffer.from([1]));
  pad[pad.length - 1] = 1;
  const badLength = Buffer.from(webp);
  badLength.writeUInt32LE(1, 4);
  const brokenWebp = Buffer.from(webp);
  brokenWebp.writeUInt32LE(0x7fffffff, 16);
  const cases: [Buffer, ImageMime, 'invalid_content' | 'unsupported'][] = [
    [png.subarray(0, 35), 'image/png', 'invalid_content'],
    [badFirst, 'image/png', 'invalid_content'],
    [hugeChunk, 'image/png', 'invalid_content'],
    [
      Buffer.concat([png.subarray(0, 33), png.subarray(8)]),
      'image/png',
      'invalid_content',
    ],
    [png.subarray(0, -12), 'image/png', 'invalid_content'],
    [Buffer.concat([png, Buffer.from([1])]), 'image/png', 'invalid_content'],
    [badLength, 'image/webp', 'invalid_content'],
    [brokenWebp, 'image/webp', 'invalid_content'],
    [riff(pad), 'image/webp', 'invalid_content'],
    [riff(riffChunk('EXIF', Buffer.alloc(4))), 'image/webp', 'invalid_content'],
    [
      riff(
        Buffer.concat([riffChunk('JUNK', Buffer.alloc(0)), Buffer.from([1])]),
      ),
      'image/webp',
      'invalid_content',
    ],
    [
      riff(Buffer.concat([webp.subarray(12), webp.subarray(12)])),
      'image/webp',
      'unsupported',
    ],
    [Buffer.from([255, 216, 255, 216, 255, 217]), 'image/jpeg', 'unsupported'],
    [
      Buffer.from([255, 216, 255, 224, 0, 1, 255, 217]),
      'image/jpeg',
      'invalid_content',
    ],
    [
      Buffer.from([255, 216, 255, 224, 0, 2, 1, 255, 217]),
      'image/jpeg',
      'invalid_content',
    ],
    [jpeg.subarray(0, -2), 'image/jpeg', 'invalid_content'],
    [
      Buffer.concat([
        jpeg.subarray(0, 2),
        Buffer.from([255, 226, 0, 6, 77, 80, 70, 0]),
        jpeg.subarray(2),
      ]),
      'image/jpeg',
      'unsupported',
    ],
  ];
  for (const [bytes, mime, code] of cases)
    await expect(
      cropMaterialImage(input(bytes, mime), limits),
    ).rejects.toMatchObject({ code });
});
it('渐进式JPEG与非方形EXIF旋转照片使用编码原图尺寸，保持框外像素隔离', async () => {
  const progressive = await sharp(raw(), {
    raw: { width: 8, height: 8, channels: 3 },
  })
    .jpeg({ progressive: true, quality: 90 })
    .toBuffer();
  expect(
    (await cropMaterialImage(input(progressive, 'image/jpeg'), limits))
      .pixelRegion,
  ).toEqual({ left: 2, top: 2, width: 4, height: 4 });
  const pixels = Buffer.alloc(8 * 12 * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = i % 251;
  const bytes = await sharp(pixels, {
    raw: { width: 8, height: 12, channels: 3 },
  })
    .withMetadata({ orientation: 6 })
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toBuffer();
  const result = await cropMaterialImage(
    input(bytes, 'image/jpeg', displayToStoredRegion(display, 6)),
    limits,
  );
  expect(result).toMatchObject({
    originalWidth: 8,
    originalHeight: 12,
    orientation: 6,
    pixelRegion: { left: 2, top: 6, width: 5, height: 4 },
  });
  expect(await decoded(result.png)).toEqual(
    slice(await decoded(bytes), result.pixelRegion),
  );
});
it('PNG像素压缩数据损坏时，即使头部可读也不能返回裁后成功', async () => {
  const bytes = await image(),
    bad = Buffer.from(bytes);
  let p = 8;
  while (bad.toString('ascii', p + 4, p + 8) !== 'IDAT')
    p += 12 + bad.readUInt32BE(p);
  bad[p + 8] = bad[p + 8]! ^ 255;
  await expect(cropMaterialImage(input(bad), limits)).rejects.toMatchObject({
    code: 'invalid_content',
  });
  await expect(
    cropMaterialImage(input(Buffer.alloc(0)), limits),
  ).rejects.toMatchObject({ code: 'invalid_content' });
  const other = input(bytes);
  other.source.location = {
    kind: 'document',
    paragraph: 'demo',
  } as unknown as typeof other.source.location;
  await expect(cropMaterialImage(other, limits)).rejects.toMatchObject({
    code: 'invalid_content',
  });
});
