import { z } from 'zod';
import type { UploadGrant } from '@/contracts/media';

/** Kodo v2 multipart parts are at least 1 MiB except the last; 4 MiB matches the server uploader. */
export const PART_BYTES = 4 * 1024 * 1024;

export type KodoUploadResult =
  { status: 'stored'; hash: string } | { status: 'failed' };

const initSchema = z.object({ uploadId: z.string().min(1) });
const partSchema = z.object({ etag: z.string().min(1) });
const doneSchema = z.object({ key: z.string(), hash: z.string().min(1) });
const policySchema = z.object({ scope: z.string() });

/** Qiniu's URL-safe Base64 keeps the padding. */
function urlSafeBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * The bucket is named only inside the scoped upload token (`AK:sign:policy`,
 * policy scope `bucket:key`). A scope for any other key than the granted one
 * is not used.
 */
export function bucketOf(grant: UploadGrant) {
  const policy = grant.uploadToken.split(':')[2];
  if (!policy) return null;
  try {
    const decoded = new TextDecoder().decode(
      Uint8Array.from(
        atob(policy.replace(/-/g, '+').replace(/_/g, '/')),
        (char) => char.charCodeAt(0),
      ),
    );
    const { scope } = policySchema.parse(JSON.parse(decoded));
    const split = scope.indexOf(':');
    if (split <= 0 || scope.slice(split + 1) !== grant.objectKey) return null;
    return scope.slice(0, split);
  } catch {
    return null;
  }
}

async function json<S extends z.ZodType>(response: Response, schema: S) {
  if (!response.ok) return null;
  const parsed = schema.safeParse(await response.json().catch(() => null));
  return parsed.success ? (parsed.data as z.infer<S>) : null;
}

/**
 * Sends one file straight from the browser to Kodo with the v2 multipart API
 * (init, parts, complete). Progress is the share of parts stored. Any refused
 * request, unexpected answer or abort ends as `failed`; an aborted signal also
 * rejects the pending fetch.
 */
export async function uploadToKodo(
  grant: UploadGrant,
  file: Blob,
  mediaType: string,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<KodoUploadResult> {
  const bucket = bucketOf(grant);
  if (grant.method !== 'resumable_v2' || !bucket || file.size === 0)
    return { status: 'failed' };
  const headers = { Authorization: `UpToken ${grant.uploadToken}` };
  const base = `${grant.uploadEndpoint.replace(/\/$/, '')}/buckets/${bucket}/objects/${urlSafeBase64(grant.objectKey)}/uploads`;
  try {
    const init = await json(
      await fetcher(base, { method: 'POST', headers, signal }),
      initSchema,
    );
    if (!init) return { status: 'failed' };
    const target = `${base}/${encodeURIComponent(init.uploadId)}`;
    const total = Math.ceil(file.size / PART_BYTES);
    const parts: { partNumber: number; etag: string }[] = [];
    for (let partNumber = 1; partNumber <= total; partNumber++) {
      const offset = (partNumber - 1) * PART_BYTES;
      const part = await json(
        await fetcher(`${target}/${partNumber}`, {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/octet-stream' },
          body: file.slice(offset, offset + PART_BYTES),
          signal,
        }),
        partSchema,
      );
      if (!part) return { status: 'failed' };
      parts.push({ partNumber, etag: part.etag });
      onProgress((partNumber / total) * 100);
    }
    const done = await json(
      await fetcher(target, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ parts, mimeType: mediaType }),
        signal,
      }),
      doneSchema,
    );
    if (!done || done.key !== grant.objectKey) return { status: 'failed' };
    return { status: 'stored', hash: done.hash };
  } catch {
    return { status: 'failed' };
  }
}
