import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { getEnv } from '../env';
import { KodoError } from '../integrations/kodo';
import type { UploadStorage } from '../modules/records/uploads/types';

const bucket = 'test-bucket';
const maxPartBytes = 8 * 1024 * 1024;

type Grant = { token: string; byteLimit: number; contentType: string };
type Stored = { bytes: Uint8Array; mediaType: string };

const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
/** Qiniu's URL-safe Base64 keeps the padding. */
const urlSafe = (value: string) =>
  Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
const answer = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });

/** In-memory Kodo speaking the v2 multipart upload protocol (init, parts,
 * complete) for tests. The same object store backs the server's stat and
 * open, so completion verifies exactly the bytes a browser uploaded.
 */
export function createTestKodo(uploadEndpoint: string) {
  const grants = new Map<string, Grant>();
  const pending = new Map<
    string,
    { key: string; parts: Map<number, Uint8Array> }
  >();
  const objects = new Map<string, Stored>();

  const storage: UploadStorage = {
    issueUploadGrant(input) {
      const policy = urlSafe(
        JSON.stringify({
          scope: `${bucket}:${input.objectKey}`,
          deadline: Math.floor(input.expiresAt / 1000),
        }),
      );
      const token = `test-access:${randomUUID()}:${policy}`;
      grants.set(input.objectKey, {
        token,
        byteLimit: input.byteLimit,
        contentType: input.contentType,
      });
      return {
        token,
        uploadEndpoint,
        expiresAt: input.expiresAt,
        objectKey: input.objectKey,
        multipartVersion: 2,
      };
    },
    async statObject({ objectKey }) {
      const stored = objects.get(objectKey);
      if (!stored) throw new KodoError('not_found');
      return {
        key: objectKey,
        byteLength: stored.bytes.length,
        mediaType: stored.mediaType,
        etag: sha256(stored.bytes),
      };
    },
    async openObject({ objectKey, range }) {
      const stored = objects.get(objectKey);
      if (!stored) throw new KodoError('not_found');
      const { bytes } = stored;
      if (range && range.start >= bytes.length)
        throw new KodoError('invalid_range');
      const start = range?.start ?? 0;
      const end = Math.min(range?.end ?? bytes.length - 1, bytes.length - 1);
      const selected = bytes.slice(start, end + 1);
      return {
        status: range ? (206 as const) : (200 as const),
        headers: {
          'content-length': String(selected.length),
          'content-type': stored.mediaType,
          ...(range
            ? { 'content-range': `bytes ${start}-${end}/${bytes.length}` }
            : {}),
        },
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(selected);
            controller.close();
          },
        }),
        close() {},
      };
    },
  };

  /** `/buckets/{bucket}/objects/{key}/uploads[/{uploadId}[/{part}]]`. */
  async function handle(request: Request, path: readonly string[]) {
    const [b, name, o, encodedKey, u, uploadId, part, ...extra] = path;
    if (
      b !== 'buckets' ||
      name !== bucket ||
      o !== 'objects' ||
      u !== 'uploads' ||
      !encodedKey ||
      extra.length
    )
      return answer({ error: 'not_found' }, 404);
    const key = Buffer.from(encodedKey, 'base64url').toString('utf8');
    const grant = grants.get(key);
    if (
      !grant ||
      request.headers.get('authorization') !== `UpToken ${grant.token}`
    )
      return answer({ error: 'unauthorized' }, 401);
    if (request.method === 'POST' && uploadId === undefined) {
      const id = randomUUID();
      pending.set(id, { key, parts: new Map() });
      return answer({ uploadId: id });
    }
    const upload = uploadId === undefined ? undefined : pending.get(uploadId);
    if (!upload || upload.key !== key)
      return answer({ error: 'no_such_upload' }, 404);
    if (request.method === 'PUT' && part !== undefined) {
      const number = Number(part);
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (
        !Number.isInteger(number) ||
        number < 1 ||
        number > 10000 ||
        !bytes.length ||
        bytes.length > maxPartBytes
      )
        return answer({ error: 'invalid_part' }, 400);
      upload.parts.set(number, bytes);
      return answer({ etag: sha256(bytes) });
    }
    if (request.method === 'POST' && part === undefined) {
      const body = (await request.json().catch(() => null)) as {
        parts?: { partNumber?: unknown; etag?: unknown }[];
        mimeType?: unknown;
      } | null;
      const listed = Array.isArray(body?.parts) ? body.parts : [];
      const chunks: Uint8Array[] = [];
      for (const [index, entry] of listed.entries()) {
        const bytes = upload.parts.get(index + 1);
        if (
          entry.partNumber !== index + 1 ||
          !bytes ||
          entry.etag !== sha256(bytes)
        )
          return answer({ error: 'invalid_part_list' }, 400);
        chunks.push(bytes);
      }
      const bytes = new Uint8Array(Buffer.concat(chunks));
      const mediaType = typeof body?.mimeType === 'string' ? body.mimeType : '';
      if (
        !chunks.length ||
        bytes.length > grant.byteLimit ||
        (grant.contentType !== 'application/octet-stream' &&
          mediaType !== grant.contentType)
      )
        return answer({ error: 'policy_violation' }, 403);
      const existing = objects.get(key);
      if (existing && sha256(existing.bytes) !== sha256(bytes))
        return answer({ error: 'file_exists' }, 409);
      objects.set(key, { bytes, mediaType });
      pending.delete(uploadId!);
      return answer({ key, hash: sha256(bytes) });
    }
    return answer({ error: 'method_not_allowed' }, 405);
  }

  return { storage, handle };
}

/** Registered only for local and e2e test runs, never in a production build. */
export function testKodoEnabled() {
  return process.env.NODE_ENV !== 'production' && getEnv().APP_ENV === 'test';
}

const shared = globalThis as typeof globalThis & {
  __testKodo?: ReturnType<typeof createTestKodo>;
};
/** The one process-wide double, so the upload route and completion share it. */
export function testKodoForServer() {
  if (!testKodoEnabled()) return null;
  shared.__testKodo ??= createTestKodo(
    `${new URL(getEnv().BETTER_AUTH_URL).origin}/api/test/kodo`,
  );
  return shared.__testKodo;
}

export async function testKodoRoute(request: Request, path: readonly string[]) {
  const kodo = testKodoForServer();
  if (!kodo) return new Response(null, { status: 404 });
  return kodo.handle(request, path);
}
