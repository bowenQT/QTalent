import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import sharp from 'sharp';
import { z } from 'zod';
import {
  materialImageRegionSchema,
  materialSourceReferenceSchema,
  type MaterialImageRegion,
  type MaterialSourceReference,
} from '../../../contracts/sources';
export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';
export interface ImageLimits {
  maxInputBytes: number;
  maxWidth: number;
  maxHeight: number;
  maxPixels: number;
  maxDecodedBytes: number;
  maxOutputBytes: number;
  processingSeconds: number;
  maxElapsedMs: number;
}
export interface ImageCropInput {
  bytes: Uint8Array;
  mediaType: ImageMime;
  originalId: string;
  source: MaterialSourceReference;
  sha256: string;
}
export interface CroppedImage {
  png: Buffer;
  source: MaterialSourceReference;
  originalId: string;
  originalSha256: string;
  originalWidth: number;
  originalHeight: number;
  orientation: number;
  pixelRegion: { left: number; top: number; width: number; height: number };
  actualRegion: MaterialImageRegion;
  sha256: string;
}
export class ImageCropError extends Error {
  constructor(
    readonly code:
      | 'invalid_content'
      | 'unsupported'
      | 'resource_limit'
      | 'conflict'
      | 'cancelled',
    message: string,
  ) {
    super(message);
  }
}
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const budgetSchema = z.strictObject({
  maxInputBytes: positive.max(2 * 1024 ** 3),
  maxWidth: positive,
  maxHeight: positive,
  maxPixels: positive.max(64 * 1024 * 1024),
  maxDecodedBytes: positive.max(256 * 1024 * 1024),
  maxOutputBytes: positive.max(4 * 1024 * 1024),
  processingSeconds: positive.max(60),
  maxElapsedMs: positive.max(60000),
});
export function parseImageLimits(value: unknown): ImageLimits {
  return budgetSchema.parse(value);
}
function fail(code: ImageCropError['code'], message: string): never {
  throw new ImageCropError(code, message);
}
const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
/** Inverse EXIF transform: display-normalized selection -> encoded original pixels. */
export function displayToStoredRegion(
  input: MaterialImageRegion,
  orientation: number,
): MaterialImageRegion {
  const r = materialImageRegionSchema.parse(input);
  z.number().int().min(1).max(8).parse(orientation);
  const { left: l, top: t, right: h, bottom: b } = r;
  const regions: MaterialImageRegion[] = [
    r,
    { left: 1 - h, top: t, right: 1 - l, bottom: b },
    { left: 1 - h, top: 1 - b, right: 1 - l, bottom: 1 - t },
    { left: l, top: 1 - b, right: h, bottom: 1 - t },
    { left: t, top: l, right: b, bottom: h },
    { left: t, top: 1 - h, right: b, bottom: 1 - l },
    { left: 1 - b, top: 1 - h, right: 1 - t, bottom: 1 - l },
    { left: 1 - b, top: l, right: 1 - t, bottom: h },
  ];
  return materialImageRegionSchema.parse(regions[orientation - 1]);
}
function pngSingleFrame(b: Buffer) {
  let p = 8,
    header = false,
    ended = false;
  while (p < b.length) {
    if (p + 12 > b.length) fail('invalid_content', 'PNG容器不完整');
    const size = b.readUInt32BE(p),
      end = p + 12 + size,
      name = b.toString('ascii', p + 4, p + 8);
    if (end > b.length) fail('invalid_content', 'PNG区块长度无效');
    if (['acTL', 'fcTL', 'fdAT'].includes(name))
      fail('unsupported', '动画或多帧图片须另行核对');
    if (!header) {
      if (name !== 'IHDR' || size !== 13) fail('invalid_content', 'PNG头无效');
      header = true;
    } else if (name === 'IHDR') fail('invalid_content', 'PNG头重复');
    if (name === 'IEND') {
      if (size !== 0 || end !== b.length)
        fail('invalid_content', 'PNG结束位置无效');
      ended = true;
    }
    p = end;
  }
  if (!header || !ended) fail('invalid_content', 'PNG容器不完整');
}
function webpSingleFrame(b: Buffer) {
  if (b.length < 20 || b.readUInt32LE(4) + 8 !== b.length)
    fail('invalid_content', 'WebP容器长度无效');
  let p = 12,
    images = 0;
  while (p < b.length) {
    if (p + 8 > b.length) fail('invalid_content', 'WebP区块不完整');
    const name = b.toString('ascii', p, p + 4),
      size = b.readUInt32LE(p + 4),
      end = p + 8 + size + (size % 2);
    if (end > b.length || (size % 2 && b[end - 1] !== 0))
      fail('invalid_content', 'WebP区块长度无效');
    if (
      name === 'ANIM' ||
      name === 'ANMF' ||
      (name === 'VP8X' && size >= 1 && (b[p + 8]! & 2) !== 0)
    )
      fail('unsupported', '动画或多帧图片须另行核对');
    if (name === 'VP8 ' || name === 'VP8L') images++;
    if (images > 1) fail('unsupported', '多图WebP须另行核对');
    p = end;
  }
  if (images !== 1) fail('invalid_content', 'WebP图像数据无效');
}
/** Walk outer JPEG markers, skipping length-delimited EXIF thumbnails and entropy stuffing. */
function jpegSingleFrame(b: Buffer) {
  let p = 2,
    frames = 0;
  while (p < b.length) {
    if (b[p++] !== 255) fail('invalid_content', 'JPEG标记无效');
    while (b[p] === 255) p++;
    const marker = b[p++];
    if (marker === 217) {
      if (p !== b.length)
        fail('unsupported', 'JPEG附加图像或尾随内容须另行核对');
      return;
    }
    if (marker === 216) fail('unsupported', '多图JPEG须另行核对');
    if (marker === undefined || marker === 0 || p + 2 > b.length)
      fail('invalid_content', 'JPEG标记不完整');
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    const size = b.readUInt16BE(p),
      start = p + 2,
      end = p + size;
    if (size < 2 || end > b.length) fail('invalid_content', 'JPEG区段长度无效');
    if (marker === 226 && b.toString('ascii', start, start + 4) === 'MPF\0')
      fail('unsupported', 'MPO多图须另行核对');
    if (
      marker >= 192 &&
      marker <= 207 &&
      ![196, 200, 204].includes(marker) &&
      ++frames > 1
    )
      fail('unsupported', '多帧JPEG须另行核对');
    p = end;
    if (marker === 218) {
      while (p < b.length) {
        if (b[p] !== 255) {
          p++;
          continue;
        }
        const start = p++;
        while (b[p] === 255) p++;
        const next = b[p];
        if (next === 0 || (next !== undefined && next >= 208 && next <= 215)) {
          p++;
          continue;
        }
        p = start;
        break;
      }
    }
  }
  fail('invalid_content', 'JPEG结束标记缺失');
}
function checkedFormat(b: Buffer, declared: ImageMime) {
  let actual: ImageMime;
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    actual = 'image/png';
    pngSingleFrame(b);
  } else if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) {
    actual = 'image/jpeg';
    jpegSingleFrame(b);
  } else if (
    b.length >= 12 &&
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WEBP'
  ) {
    actual = 'image/webp';
    webpSingleFrame(b);
  } else return fail('unsupported', '仅接收PNG、JPEG、WebP真实图片');
  if (actual !== declared) fail('invalid_content', '声明类型与图片字节不一致');
  return actual;
}
async function native<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ImageCropError) throw error;
    const message = error instanceof Error ? error.message : '';
    throw new ImageCropError(
      /pixel limit|exceeds.*limit|timeout|timed out|memory/i.test(message)
        ? 'resource_limit'
        : 'invalid_content',
      '图片解码或编码失败',
    );
  }
}
export async function cropMaterialImage(
  input: ImageCropInput,
  rawLimits: ImageLimits,
  signal?: AbortSignal,
): Promise<CroppedImage> {
  const limits = parseImageLimits(rawLimits),
    started = performance.now();
  const checkpoint = () => {
    if (signal?.aborted) fail('cancelled', '图片处理已取消');
    if (performance.now() - started > limits.maxElapsedMs)
      fail('resource_limit', '图片处理时限已超出');
  };
  checkpoint();
  const source = materialSourceReferenceSchema.parse(input.source);
  if (source.location.kind !== 'image')
    return fail('invalid_content', '图片出处类型不符');
  z.string().min(1).regex(/\S/).parse(input.originalId);
  z.string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(input.sha256);
  z.enum(['image/png', 'image/jpeg', 'image/webp']).parse(input.mediaType);
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0)
    fail('invalid_content', '图片字节为空');
  if (input.bytes.byteLength > limits.maxInputBytes)
    fail('resource_limit', '图片输入超过预算');
  // Own the bytes across awaits; a caller must not mutate a previously authorized buffer.
  const bytes = Buffer.from(input.bytes);
  if (sha256(bytes) !== input.sha256) fail('conflict', '原件摘要已变化');
  const format = checkedFormat(bytes, input.mediaType);
  const options = {
    failOn: 'warning' as const,
    limitInputPixels: limits.maxPixels,
    limitInputChannels: 4,
    unlimited: false,
  };
  const metadata = await native(() => sharp(bytes, options).metadata());
  checkpoint();
  if (metadata.format !== format.slice(6))
    fail('invalid_content', '解码类型与字节类型不一致');
  if ((metadata.pages ?? 1) !== 1 || metadata.delay !== undefined)
    fail('unsupported', '多帧图片须另行核对');
  const width = metadata.width,
    height = metadata.height,
    orientation = metadata.orientation ?? 1;
  if (
    !Number.isSafeInteger(width) ||
    !width ||
    !Number.isSafeInteger(height) ||
    !height ||
    orientation < 1 ||
    orientation > 8
  )
    fail('invalid_content', '图片尺寸或方向无效');
  if (
    width > limits.maxWidth ||
    height > limits.maxHeight ||
    width * height > limits.maxPixels ||
    width * height * 4 * (metadata.depth === 'ushort' ? 2 : 1) >
      limits.maxDecodedBytes
  )
    fail('resource_limit', '图片解码尺寸超过预算');
  const r = source.location.region,
    left = Math.ceil(r.left * width),
    top = Math.ceil(r.top * height),
    right = Math.floor(r.right * width),
    bottom = Math.floor(r.bottom * height);
  if (right <= left || bottom <= top)
    fail('invalid_content', '批准区域没有完整像素');
  const pixelRegion = { left, top, width: right - left, height: bottom - top };
  // No autoOrient/resize before extract: the contract's coordinates are stored-original pixels.
  const result = await native(() =>
    sharp(bytes, options)
      .extract(pixelRegion)
      .toColourspace('srgb')
      .flatten({ background: '#ffffff' })
      .png({ compressionLevel: 9 })
      .timeout({ seconds: limits.processingSeconds })
      .toBuffer({ resolveWithObject: true }),
  );
  checkpoint();
  if (result.data.length > limits.maxOutputBytes)
    fail('resource_limit', '裁后PNG超过外发预算');
  if (
    result.info.width !== pixelRegion.width ||
    result.info.height !== pixelRegion.height
  )
    fail('invalid_content', '裁后像素尺寸不一致');
  return {
    png: result.data,
    source: structuredClone(source),
    originalId: input.originalId,
    originalSha256: input.sha256,
    originalWidth: width,
    originalHeight: height,
    orientation,
    pixelRegion,
    actualRegion: {
      left: left / width,
      top: top / height,
      right: right / width,
      bottom: bottom / height,
    },
    sha256: sha256(result.data),
  };
}
