import { createDecipheriv, createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import { WecomError, wecomLimits, type WecomPart } from './protocol';
export type WecomMedia = Extract<WecomPart, { kind: 'image' | 'file' }>;
export type MediaRequestPlan = Readonly<{
  url: string;
  hostname: string;
  address: string;
  family: 4 | 6;
}>;
export type MediaResponse = {
  status: number;
  contentLength?: string;
  body: Readable;
};
export type WecomMediaIO = {
  resolve: (hostname: string) => Promise<{ address: string; family: number }[]>;
  /** Trusted I/O boundary; production implementation pins DNS and validates TLS/peer. */
  fetch: (
    plan: MediaRequestPlan,
    signal: AbortSignal,
  ) => Promise<MediaResponse>;
};
export function isPublicMediaAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 &&
        (b === 168 ||
          (b === 0 && (c === 0 || c === 2)) ||
          (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (family === 6) {
    let value: string;
    try {
      value = new URL(`http://[${address}]/`).hostname.slice(1, -1);
    } catch {
      return false;
    }
    return (
      /^[23][0-9a-f]{3}:/.test(value) &&
      !/^2002:/.test(value) &&
      !/^2001:(?:0*:|db8:|0*2:|0*1[0-9a-f]:|0*2[0-9a-f]:)/.test(value)
    );
  }
  return false;
}
function providerOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.origin !== value ||
    url.username ||
    url.password ||
    url.port ||
    isIP(url.hostname) ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(
      url.hostname,
    )
  )
    throw new WecomError('unsafe_url');
  return value;
}
export function validateMediaURL(
  raw: string,
  allowedOrigins: readonly string[],
): URL {
  try {
    if (
      typeof raw !== 'string' ||
      raw.length > 4096 ||
      /[\\\s\x00-\x1f\x7f]/.test(raw) ||
      !allowedOrigins.length
    )
      throw new Error();
    const allowed = allowedOrigins.map(providerOrigin);
    const url = new URL(raw);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      !allowed.includes(url.origin)
    )
      throw new Error();
    return url;
  } catch {
    throw new WecomError('unsafe_url');
  }
}
function mediaKey(value: unknown): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=?$/.test(value))
    throw new WecomError('invalid_media');
  const key = Buffer.from(value, 'base64');
  if (
    key.length !== 32 ||
    key.toString('base64').replace(/=$/, '') !== value.replace(/=$/, '')
  )
    throw new WecomError('invalid_media');
  return key;
}
export function decryptWecomFile(
  encrypted: Uint8Array,
  aesKey: string,
  maxBytes: number = wecomLimits.maxMediaBytes,
): Uint8Array {
  try {
    if (
      !Number.isInteger(maxBytes) ||
      maxBytes < 1 ||
      maxBytes > wecomLimits.maxMediaBytes
    )
      throw new WecomError('invalid_config');
    if (
      !(encrypted instanceof Uint8Array) ||
      !encrypted.byteLength ||
      encrypted.byteLength % 32 !== 0 ||
      typeof aesKey !== 'string'
    )
      throw new WecomError('invalid_media');
    if (encrypted.byteLength > maxBytes + 32)
      throw new WecomError('media_limit');
    const key = mediaKey(aesKey);
    const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
    decipher.setAutoPadding(false);
    const padded = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    const padding = padded[padded.length - 1];
    if (
      padding < 1 ||
      padding > 32 ||
      padding > padded.length ||
      !padded.subarray(padded.length - padding).every((v) => v === padding)
    )
      throw new WecomError('invalid_media');
    const bytes = padded.subarray(0, padded.length - padding);
    if (!bytes.length) throw new WecomError('invalid_media');
    if (bytes.length > maxBytes) throw new WecomError('media_limit');
    return bytes;
  } catch (error) {
    throw error instanceof WecomError ? error : new WecomError('invalid_media');
  }
}
/** No proxy, redirect or caller DNS lookup is inherited. The socket uses the validated address. */
function requestWecomMedia(
  plan: MediaRequestPlan,
  signal: AbortSignal,
): Promise<MediaResponse> {
  return new Promise((resolve, reject) => {
    const req = request(
      plan.url,
      {
        method: 'GET',
        agent: false,
        signal,
        servername: plan.hostname,
        family: plan.family,
        rejectUnauthorized: true,
        lookup: (_hostname, _options, callback) =>
          callback(null, plan.address, plan.family),
        headers: { accept: 'application/octet-stream' },
      },
      (response) => {
        const peer = response.socket.remoteAddress;
        if (
          peer !== plan.address &&
          !(plan.family === 4 && peer === `::ffff:${plan.address}`)
        ) {
          response.destroy();
          reject(new WecomError('unsafe_url'));
          return;
        }
        resolve({
          status: response.statusCode ?? 0,
          contentLength:
            typeof response.headers['content-length'] === 'string'
              ? response.headers['content-length']
              : undefined,
          body: response,
        });
      },
    );
    req.once('error', () => reject(new WecomError('download_failed')));
    req.end();
  });
}
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new WecomError('closed'));
    // Always observe the operation, including an already-aborted signal, so late I/O failures cannot become unhandled rejections.
    operation
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}
const budgetSchema = z.strictObject({
  maxBytes: z
    .number()
    .int()
    .positive()
    .max(wecomLimits.maxMediaBytes)
    .default(wecomLimits.maxMediaBytes),
  timeoutMs: z.number().int().positive().max(30_000).default(10_000),
});
async function downloadWecomMedia(
  media: WecomMedia,
  options: {
    allowedOrigins: readonly string[];
    maxBytes?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
  io: Partial<WecomMediaIO> = {},
): Promise<{ bytes: Uint8Array; sha256: string; byteLength: number }> {
  const checked = budgetSchema.safeParse({
    maxBytes: options.maxBytes,
    timeoutMs: options.timeoutMs,
  });
  if (
    !checked.success ||
    (options.signal !== undefined && !(options.signal instanceof AbortSignal))
  )
    throw new WecomError('invalid_config');
  if (!media || !['image', 'file'].includes(media.kind))
    throw new WecomError('invalid_media');
  const url = validateMediaURL(media.url, options.allowedOrigins);
  // Reject malformed keys before any DNS or download, also validated by the independently callable decryptor.
  const aesKey = media.aesKey;
  mediaKey(aesKey);
  const budget = checked.data,
    controller = new AbortController();
  let expired = false;
  const relay = () => controller.abort();
  options.signal?.addEventListener('abort', relay, { once: true });
  if (options.signal?.aborted) relay();
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, budget.timeoutMs);
  let response: MediaResponse | undefined;
  try {
    if (controller.signal.aborted) throw new WecomError('closed');
    const addresses = await abortable(
      (io.resolve ?? ((host) => lookup(host, { all: true, verbatim: true })))(
        url.hostname,
      ),
      controller.signal,
    );
    if (
      !addresses.length ||
      !addresses.every(
        (a) => isIP(a.address) === a.family && isPublicMediaAddress(a.address),
      )
    )
      throw new WecomError('unsafe_url');
    const chosen = addresses[0];
    const plan = Object.freeze({
      url: url.href,
      hostname: url.hostname,
      address: chosen.address,
      family: chosen.family as 4 | 6,
    });
    response = await abortable(
      (io.fetch ?? requestWecomMedia)(plan, controller.signal),
      controller.signal,
    );
    if (response.status !== 200) throw new WecomError('download_failed'); // Redirects are never followed.
    let declared: number | undefined;
    if (response.contentLength !== undefined) {
      if (!/^\d+$/.test(response.contentLength))
        throw new WecomError('download_failed');
      declared = Number(response.contentLength);
      if (!Number.isSafeInteger(declared) || declared > budget.maxBytes + 32)
        throw new WecomError('media_limit');
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of response.body) {
      if (controller.signal.aborted) throw new WecomError('closed');
      if (!(chunk instanceof Uint8Array))
        throw new WecomError('download_failed');
      total += chunk.byteLength;
      if (total > budget.maxBytes + 32) throw new WecomError('media_limit');
      chunks.push(chunk);
    }
    if (controller.signal.aborted) throw new WecomError('closed');
    if (declared !== undefined && declared !== total)
      throw new WecomError('download_failed');
    const bytes = decryptWecomFile(
      Buffer.concat(chunks, total),
      aesKey,
      budget.maxBytes,
    );
    return {
      bytes,
      byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  } catch (error) {
    throw expired
      ? new WecomError('timeout')
      : controller.signal.aborted
        ? new WecomError('closed')
        : error instanceof WecomError
          ? error
          : new WecomError('download_failed');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', relay);
    response?.body.destroy();
  }
}

/** Capture approved server configuration once; incoming messages cannot set origins or transport policy. */
export function createWecomMediaDownloader(
  config: {
    allowedOrigins: readonly string[];
    maxBytes?: number;
    timeoutMs?: number;
  },
  io: Partial<WecomMediaIO> = {},
) {
  const checked = budgetSchema.safeParse({
    maxBytes: config.maxBytes,
    timeoutMs: config.timeoutMs,
  });
  if (
    !checked.success ||
    !Array.isArray(config.allowedOrigins) ||
    !config.allowedOrigins.length ||
    config.allowedOrigins.length > 8
  )
    throw new WecomError('invalid_config');
  let origins: readonly string[];
  try {
    origins = Object.freeze(config.allowedOrigins.map(providerOrigin));
  } catch {
    throw new WecomError('invalid_config');
  }
  const policy = Object.freeze({ ...checked.data, allowedOrigins: origins });
  return (media: WecomMedia, signal?: AbortSignal) =>
    downloadWecomMedia(media, { ...policy, signal }, io);
}
