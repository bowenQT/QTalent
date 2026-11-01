import { createHash, createHmac } from 'node:crypto';
import type { z } from 'zod';
import { KodoError, keySchema, s3ReadConfigSchema, parse } from './protocol';

type S3ReadConfig = z.input<typeof s3ReadConfigSchema>;
function uriEncode(value: string): string {
  try {
    return encodeURIComponent(value).replace(
      /[!'()*]/g,
      (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase(),
    );
  } catch {
    throw new KodoError('invalid_input');
  }
}
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const hmac = (key: string | Uint8Array, value: string) =>
  createHmac('sha256', key).update(value).digest();

/** Pure, internal GET signing only. Never log the returned server-side URL.
 * Both proxy reads and Tingwu capabilities use this implementation.
 * Qiniu's configured virtual origin can use an S3 alias distinct from its native bucket name.
 */
export function presignS3Get(
  rawConfig: S3ReadConfig,
  input: {
    objectKey: string;
    now: number;
    expiresAt: number;
  },
): { url: string; expiresAt: number } {
  const config = parse(s3ReadConfigSchema, rawConfig);
  const endpoint = new URL(config.endpoint);
  const key = parse(keySchema, input.objectKey);
  const documented = endpoint.hostname.match(
    /^(?:([a-z0-9-]+)\.)?s3\.(cn-east-[12]|cn-north-1|cn-south-1|us-north-1|ap-southeast-[123])\.qiniucs\.com$/,
  );
  const inferredRegion = documented?.[2];
  const region = config.s3Region ?? inferredRegion;
  if (
    !region ||
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(region) ||
    (inferredRegion !== undefined && region !== inferredRegion)
  )
    throw new KodoError('invalid_input');
  if (
    !Number.isSafeInteger(input.now) ||
    input.now < 0 ||
    !Number.isSafeInteger(input.expiresAt)
  )
    throw new KodoError('invalid_input');
  let timestamp: string;
  try {
    timestamp = new Date(input.now).toISOString().replace(/[:-]|\.\d{3}/g, '');
  } catch {
    throw new KodoError('invalid_input');
  }
  if (!/^\d{8}T\d{6}Z$/.test(timestamp)) throw new KodoError('invalid_input');
  const signedAt = Math.floor(input.now / 1000) * 1000;
  const expiresAt = Math.floor(input.expiresAt / 1000) * 1000;
  if (expiresAt <= input.now) throw new KodoError('expired');
  const seconds = (expiresAt - signedAt) / 1000;
  if (seconds > 604800) throw new KodoError('invalid_input');
  const date = timestamp.slice(0, 8);
  const scope = `${date}/${region}/s3/aws4_request`;
  const query = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${config.accessKey}/${scope}`],
    ['X-Amz-Date', timestamp],
    ['X-Amz-Expires', String(seconds)],
    ['X-Amz-SignedHeaders', 'host'],
  ]
    .map(([name, value]) => `${uriEncode(name)}=${uriEncode(value)}`)
    .sort()
    .join('&');
  const bucketPrefix =
    documented && !documented[1] ? `/${uriEncode(config.bucket)}` : '';
  // S3 keys retain repeated slashes; URI normalization would select another object.
  const uri = `${bucketPrefix}/${key.split('/').map(uriEncode).join('/')}`;
  const canonical = `GET\n${uri}\n${query}\nhost:${endpoint.host}\n\nhost\nUNSIGNED-PAYLOAD`;
  const toSign = `AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${digest(canonical)}`;
  const signingKey = hmac(
    hmac(hmac(hmac('AWS4' + config.secretKey, date), region), 's3'),
    'aws4_request',
  );
  const signature = hmac(signingKey, toSign).toString('hex');
  return {
    url: `${endpoint.origin}${uri}?${query}&X-Amz-Signature=${signature}`,
    expiresAt,
  };
}
