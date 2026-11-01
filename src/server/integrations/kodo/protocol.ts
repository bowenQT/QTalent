import { createHash, createHmac } from 'node:crypto';
import { z } from 'zod';

export type KodoErrorCode =
  | 'invalid_input'
  | 'expired'
  | 'not_found'
  | 'conflict'
  | 'invalid_resume'
  | 'unauthorized'
  | 'rate_limited'
  | 'unavailable'
  | 'timeout'
  | 'cancelled'
  | 'invalid_range'
  | 'integrity';
export class KodoError extends Error {
  constructor(
    readonly code: KodoErrorCode,
    readonly status?: number,
  ) {
    super(code === 'not_found' ? 'Object not found' : `Kodo ${code}`);
    this.name = 'KodoError';
  }
}
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new KodoError('invalid_input');
  return result.data;
}
export const originSchema = z
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/'
    );
  })
  .transform((value) => new URL(value).origin);
export const kodoConfigSchema = z.object({
  endpoint: originSchema,
  accessKey: z.string().min(1),
  secretKey: z.string().min(1),
  bucket: z.string().regex(/^[a-zA-Z0-9_-]+$/),
});
export const liveConfigSchema = kodoConfigSchema.extend({
  uploadEndpoint: originSchema,
  managementEndpoint: originSchema,
});
export const keySchema = z
  .string()
  .min(1)
  .max(750)
  .refine(
    (key) =>
      !/[\x00-\x1f\x7f\\"]/.test(key) &&
      !key.split('/').some((part) => part === '.' || part === '..') &&
      Buffer.byteLength(key) <= 750,
  );
export const mimeSchema = z
  .string()
  .regex(/^[a-zA-Z0-9#$&^_.+-]+\/[a-zA-Z0-9#$&^_.+-]+$/);
export const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
// Qiniu uses URL-safe Base64 with padding, not Node's unpadded base64url.
export const base64 = (value: string | Uint8Array) =>
  Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
export const sign = (secret: string, value: string) =>
  base64(createHmac('sha1', secret).update(value).digest());
export function objectEtag(bytes: Uint8Array): string {
  const blockSize = 4 * 1024 * 1024;
  const hashes: Buffer[] = [];
  for (let offset = 0; offset < bytes.length; offset += blockSize)
    hashes.push(
      createHash('sha1')
        .update(bytes.subarray(offset, offset + blockSize))
        .digest(),
    );
  const hash =
    hashes.length > 1
      ? createHash('sha1').update(Buffer.concat(hashes)).digest()
      : createHash('sha1').update(bytes).digest();
  return base64(
    Buffer.concat([Buffer.from([hashes.length > 1 ? 0x96 : 0x16]), hash]),
  );
}
export function statusError(status: number): KodoError {
  const code: KodoErrorCode =
    status === 401 || status === 403
      ? 'unauthorized'
      : status === 404 || status === 612
        ? 'not_found'
        : status === 409 || status === 614
          ? 'conflict'
          : status === 429
            ? 'rate_limited'
            : status === 416
              ? 'invalid_range'
              : status >= 500
                ? 'unavailable'
                : 'invalid_input';
  return new KodoError(code, status);
}
export type ObjectReceipt = { key: string; byteLength: number; sha256: string };
export interface KodoClient {
  write(input: { key: string; bytes: Uint8Array }): Promise<ObjectReceipt>;
  read(key: string): Promise<Uint8Array>;
}
export type UploadInput = {
  objectKey: string;
  byteLimit: number;
  contentType: string;
  expiresAt: number;
};
export type UploadGrant = {
  token: string;
  uploadEndpoint: string;
  expiresAt: number;
  objectKey: string;
  multipartVersion: 2;
};
export type ObjectStat = {
  key: string;
  byteLength: number;
  mediaType: string;
  etag: string;
};
export type ByteRange = { start: number; end?: number };
