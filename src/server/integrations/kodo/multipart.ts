import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  base64,
  keySchema,
  mimeSchema,
  parse,
  sha256,
  sign,
  KodoError,
  type ObjectReceipt,
  type UploadInput,
  type UploadGrant,
} from './protocol';
const PART_SIZE = 4 * 1024 * 1024;
const partSchema = z.object({
  partNumber: z.number().int().min(1).max(256),
  etag: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const checkpointSchema = z.object({
  bucket: z.string(),
  objectKey: keySchema,
  uploadId: z.string().min(1),
  expiresAt: z.number().int(),
  byteLength: z
    .number()
    .int()
    .positive()
    .max(1024 * 1024 * 1024),
  sha256: z.string(),
  contentType: mimeSchema,
  parts: z.array(partSchema).max(256),
});
export type MultipartInput = {
  objectKey: string;
  bytes: Uint8Array;
  contentType: string;
  signal?: AbortSignal;
};
type Ports = {
  bucket: string;
  secret: string;
  uploadOrigin: string;
  now: () => number;
  grant: (input: UploadInput) => UploadGrant;
  request: (
    url: string,
    init: RequestInit,
    retry?: boolean,
  ) => Promise<Response>;
  json: (response: Response) => Promise<unknown>;
  existing: (
    key: string,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ) => Promise<ObjectReceipt | undefined>;
  verify: (
    key: string,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ) => Promise<ObjectReceipt>;
};
export function multipart(ports: Ports) {
  function seal(value: z.infer<typeof checkpointSchema>) {
    const payload = base64(JSON.stringify(value));
    return `${payload}.${sign(ports.secret, `kodo-resume-v1:${payload}`)}`;
  }
  function unseal(checkpoint: string) {
    const [payload, signature, extra] = checkpoint.split('.');
    const expected = sign(ports.secret, `kodo-resume-v1:${payload}`);
    if (
      !signature ||
      !/^[A-Za-z0-9_-]{27}=$/.test(signature) ||
      extra ||
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    )
      throw new KodoError('invalid_resume');
    try {
      return checkpointSchema.parse(
        JSON.parse(Buffer.from(payload, 'base64').toString()),
      );
    } catch {
      throw new KodoError('invalid_resume');
    }
  }
  function path(key: string, uploadId?: string) {
    return `${ports.uploadOrigin}/buckets/${ports.bucket}/objects/${base64(key)}/uploads${uploadId ? `/${encodeURIComponent(uploadId)}` : ''}`;
  }
  function validate(input: MultipartInput) {
    return parse(
      z.object({
        objectKey: keySchema,
        bytes: z
          .instanceof(Uint8Array)
          .refine((b) => b.length > 0 && b.length <= 1024 * 1024 * 1024),
        contentType: mimeSchema,
      }),
      input,
    );
  }
  async function beginMultipart(input: MultipartInput): Promise<string> {
    const value = validate(input);
    const bytes = new Uint8Array(value.bytes);
    const digest = sha256(bytes);
    const grant = ports.grant({
      objectKey: value.objectKey,
      byteLimit: bytes.length,
      contentType: value.contentType,
      expiresAt: ports.now() + 3600000,
    });
    const response = await ports.request(path(value.objectKey), {
      method: 'POST',
      headers: { Authorization: `UpToken ${grant.token}` },
      signal: input.signal,
    });
    const result = z
      .object({
        uploadId: z.string().min(1),
        expireAt: z.number().int().positive(),
      })
      .safeParse(await ports.json(response));
    if (!result.success) throw new KodoError('integrity');
    if (result.data.expireAt * 1000 <= ports.now())
      throw new KodoError('expired');
    return seal({
      bucket: ports.bucket,
      objectKey: value.objectKey,
      byteLength: bytes.length,
      sha256: digest,
      contentType: value.contentType,
      uploadId: result.data.uploadId,
      expiresAt: result.data.expireAt * 1000,
      parts: [],
    });
  }
  async function resumeMultipart(
    input: MultipartInput & {
      checkpoint: string;
      onCheckpoint: (checkpoint: string) => void | Promise<void>;
    },
  ): Promise<ObjectReceipt> {
    const value = validate(input);
    const bytes = new Uint8Array(value.bytes);
    const state = unseal(input.checkpoint);
    if (
      state.bucket !== ports.bucket ||
      state.objectKey !== value.objectKey ||
      state.byteLength !== bytes.length ||
      state.sha256 !== sha256(bytes) ||
      state.contentType !== value.contentType
    )
      throw new KodoError('invalid_resume');
    // Recover a complete object before touching a spent/expired upload ID.
    const existing = await ports.existing(value.objectKey, bytes, input.signal);
    if (existing) return existing;
    if (state.expiresAt <= ports.now()) throw new KodoError('expired');
    const grant = ports.grant({
      objectKey: value.objectKey,
      byteLimit: bytes.length,
      contentType: value.contentType,
      expiresAt: Math.min(state.expiresAt, ports.now() + 3600000),
    });
    const headers = { Authorization: `UpToken ${grant.token}` };
    const target = path(value.objectKey, state.uploadId);
    const response = await ports.request(
      `${target}?max-parts=1000`,
      { headers, signal: input.signal },
      true,
    );
    const listed = z
      .object({
        uploadId: z.string(),
        expireAt: z.number().int(),
        partNumberMarker: z.literal(0),
        parts: z.array(
          z.object({
            partNumber: z.number().int().positive(),
            etag: z.string().min(1),
            size: z.number().int().positive(),
          }),
        ),
      })
      .safeParse(await ports.json(response));
    if (
      !listed.success ||
      listed.data.uploadId !== state.uploadId ||
      listed.data.expireAt * 1000 !== state.expiresAt
    )
      throw new KodoError('invalid_resume');
    const completed: z.infer<typeof partSchema>[] = [];
    for (
      let offset = 0, partNumber = 1;
      offset < bytes.length;
      offset += PART_SIZE, partNumber++
    ) {
      if (ports.now() >= grant.expiresAt) throw new KodoError('expired');
      const part = bytes.slice(offset, offset + PART_SIZE);
      const digest = sha256(part);
      const saved = state.parts.find((p) => p.partNumber === partNumber);
      const remote = listed.data.parts.find((p) => p.partNumber === partNumber);
      if (
        saved &&
        remote &&
        saved.etag === remote.etag &&
        remote.size === part.length &&
        saved.sha256 === digest
      ) {
        completed.push(saved);
        continue;
      }
      // A remote part without a matching authenticated checkpoint is not trusted.
      const md5 = createHash('md5').update(part).digest('hex');
      const result = await ports.request(`${target}/${partNumber}`, {
        method: 'PUT',
        headers: {
          ...headers,
          'Content-Type': 'application/octet-stream',
          'Content-MD5': md5,
        },
        body: part,
        signal: input.signal,
      });
      const uploaded = z
        .object({ etag: z.string().min(1), md5: z.string() })
        .safeParse(await ports.json(result));
      if (!uploaded.success || uploaded.data.md5 !== md5)
        throw new KodoError('integrity');
      completed.push({ partNumber, etag: uploaded.data.etag, sha256: digest });
      await input.onCheckpoint(seal({ ...state, parts: completed }));
    }
    if (ports.now() >= grant.expiresAt) throw new KodoError('expired');
    try {
      const result = await ports.request(target, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parts: completed.map(({ partNumber, etag }) => ({
            partNumber,
            etag,
          })),
          mimeType: state.contentType,
        }),
        signal: input.signal,
      });
      const done = z
        .object({ key: z.literal(state.objectKey), hash: z.string().min(1) })
        .safeParse(await ports.json(result));
      if (!done.success) throw new KodoError('integrity');
    } catch (error) {
      if (
        !(error instanceof KodoError) ||
        !['unavailable', 'timeout', 'conflict'].includes(error.code)
      )
        throw error;
      const recovered = await ports.existing(
        state.objectKey,
        bytes,
        input.signal,
      );
      if (recovered) return recovered;
      throw error;
    }
    return ports.verify(state.objectKey, bytes, input.signal);
  }
  return { beginMultipart, resumeMultipart };
}
