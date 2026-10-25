import { multipart } from './multipart';
import { z } from 'zod';
import {
  base64,
  sign,
  parse,
  liveConfigSchema,
  keySchema,
  mimeSchema,
  sha256,
  objectEtag,
  KodoError,
  statusError,
  type KodoClient,
  type UploadInput,
  type UploadGrant,
  type ObjectStat,
  type ByteRange,
  type ObjectReceipt,
} from './protocol';
import {
  TranscriptionSource,
  TRANSCRIPTION_MIN_TTL_MS,
  TRANSCRIPTION_SAFETY_MS,
} from './source';

export type KodoOptions = {
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
};
export type LiveKodoConfig = z.input<typeof liveConfigSchema>;
const statSchema = z.object({
  fsize: z.number().int().nonnegative(),
  mimeType: mimeSchema,
  hash: z.string().min(1),
});
const grantSchema = z.object({
  objectKey: keySchema,
  byteLimit: z
    .number()
    .int()
    .positive()
    .max(1024 * 1024 * 1024),
  contentType: mimeSchema,
  expiresAt: z.number().int().positive(),
});
export function createKodoClient(
  rawConfig: LiveKodoConfig,
  options: KodoOptions = {},
) {
  const config = parse(liveConfigSchema, rawConfig);
  const transport = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = parse(
    z.number().int().min(1).max(120000),
    options.timeoutMs ?? 30000,
  );
  const origin = config.endpoint.replace(/\/$/, '');
  const uploadOrigin = config.uploadEndpoint.replace(/\/$/, '');
  const managementOrigin = config.managementEndpoint.replace(/\/$/, '');
  function signedUrl(objectKey: string, expiresAt: number) {
    const key = parse(keySchema, objectKey);
    const url = `${origin}/${key.split('/').map(encodeURIComponent).join('/')}?e=${Math.floor(expiresAt / 1000)}`;
    return `${url}&token=${config.accessKey}:${sign(config.secretKey, url)}`;
  }
  const responseFailures = new WeakMap<Response, () => KodoError | undefined>();
  async function request(
    url: string,
    init: RequestInit,
    retry = false,
  ): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = init.signal
        ? AbortSignal.any([init.signal, timeout])
        : timeout;
      try {
        const response = await transport(url, {
          ...init,
          signal,
          redirect: 'error',
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw statusError(response.status);
        }
        responseFailures.set(response, () =>
          init.signal?.aborted
            ? new KodoError('cancelled')
            : timeout.aborted
              ? new KodoError('timeout')
              : undefined,
        );
        return response;
      } catch (error) {
        // Never retain transport messages or causes: they can contain signed URLs/headers.
        const safe = init.signal?.aborted
          ? new KodoError('cancelled')
          : timeout.aborted
            ? new KodoError('timeout')
            : error instanceof KodoError
              ? error
              : new KodoError('unavailable');
        if (
          retry &&
          attempt < 2 &&
          (safe.code === 'rate_limited' || safe.code === 'unavailable')
        ) {
          await new Promise((resolve) =>
            setTimeout(resolve, 50 * (attempt + 1)),
          );
          continue;
        }
        throw safe;
      }
    }
  }
  async function json(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw responseFailures.get(response)?.() ?? new KodoError('integrity');
    }
  }
  function issueUploadGrant(input: UploadInput): UploadGrant {
    const value = parse(grantSchema, input);
    const expiresAt = Math.floor(value.expiresAt / 1000) * 1000;
    if (expiresAt <= now()) throw new KodoError('expired');
    if (expiresAt - now() > 3600000) throw new KodoError('invalid_input');
    const encoded = base64(
      JSON.stringify({
        scope: `${config.bucket}:${value.objectKey}`,
        deadline: expiresAt / 1000,
        insertOnly: 1,
        fsizeLimit: value.byteLimit,
        mimeLimit: value.contentType,
        returnBody: '{"key":$(key),"hash":$(etag)}',
      }),
    );
    return {
      objectKey: value.objectKey,
      expiresAt,
      uploadEndpoint: uploadOrigin,
      multipartVersion: 2,
      token: `${config.accessKey}:${sign(config.secretKey, encoded)}:${encoded}`,
    };
  }
  async function statObject(input: {
    objectKey: string;
    signal?: AbortSignal;
  }): Promise<ObjectStat> {
    const key = parse(keySchema, input.objectKey);
    const path = `/stat/${base64(`${config.bucket}:${key}`)}`;
    const response = await request(
      `${managementOrigin}${path}`,
      {
        headers: {
          Authorization: `QBox ${config.accessKey}:${sign(config.secretKey, `${path}\n`)}`,
        },
        signal: input.signal,
      },
      true,
    );
    const result = statSchema.safeParse(await json(response));
    if (!result.success) throw new KodoError('integrity');
    return {
      key,
      byteLength: result.data.fsize,
      mediaType: result.data.mimeType,
      etag: result.data.hash,
    };
  }
  async function openObject(input: {
    objectKey: string;
    range?: ByteRange;
    signal?: AbortSignal;
  }) {
    const key = parse(keySchema, input.objectKey);
    let range: ByteRange | undefined;
    if (input.range) {
      const validated = z
        .object({
          start: z.number().int().nonnegative(),
          end: z.number().int().nonnegative().optional(),
        })
        .refine((r) => r.end === undefined || r.end >= r.start)
        .safeParse(input.range);
      if (!validated.success) throw new KodoError('invalid_range');
      range = validated.data;
    }
    const controller = new AbortController();
    const signal = input.signal
      ? AbortSignal.any([input.signal, controller.signal])
      : controller.signal;
    const response = await request(signedUrl(key, now() + 300000), {
      headers: range
        ? { Range: `bytes=${range.start}-${range.end ?? ''}` }
        : {},
      signal,
    });
    const length = response.headers.get('content-length');
    const contentType = response.headers.get('content-type');
    const contentRange = response.headers.get('content-range');
    const matched = contentRange?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    const validRange =
      range &&
      matched &&
      Number(matched[1]) === range.start &&
      Number(matched[2]) >= range.start &&
      Number(matched[2]) < Number(matched[3]) &&
      (range.end === undefined
        ? Number(matched[2]) === Number(matched[3]) - 1
        : Number(matched[2]) === Math.min(range.end, Number(matched[3]) - 1)) &&
      Number(length) === Number(matched[2]) - Number(matched[1]) + 1;
    if (
      !length ||
      !/^\d+$/.test(length) ||
      !Number.isSafeInteger(Number(length)) ||
      !contentType ||
      /[\r\n]/.test(contentType) ||
      !response.body ||
      (range ? response.status !== 206 || !validRange : response.status !== 200)
    ) {
      controller.abort();
      try {
        await response.body?.cancel();
      } catch {
        throw new KodoError(range ? 'invalid_range' : 'integrity');
      }
      throw new KodoError(range ? 'invalid_range' : 'integrity');
    }
    const reader = response.body.getReader();
    let count = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        try {
          const next = await reader.read();
          if (signal.aborted) throw new KodoError('cancelled');
          if (next.done) {
            if (count !== Number(length)) throw new KodoError('integrity');
            stream.close();
          } else {
            count += next.value.length;
            if (count > Number(length)) throw new KodoError('integrity');
            stream.enqueue(next.value);
          }
        } catch (error) {
          const failure = responseFailures.get(response)?.();
          controller.abort();
          stream.error(
            failure ??
              (error instanceof KodoError
                ? error
                : new KodoError(
                    input.signal?.aborted ? 'cancelled' : 'unavailable',
                  )),
          );
        }
      },
      async cancel() {
        controller.abort();
        try {
          await reader.cancel();
        } catch {
          throw new KodoError('cancelled');
        }
      },
    });
    const headers: Record<string, string> = {
      'content-length': length,
      'content-type': contentType,
    };
    if (range && contentRange) headers['content-range'] = contentRange;
    return {
      body,
      headers,
      status: response.status,
      close: () => controller.abort(),
    };
  }
  async function read(key: string): Promise<Uint8Array> {
    const opened = await openObject({ objectKey: key });
    return new Uint8Array(await new Response(opened.body).arrayBuffer());
  }
  async function verifyObject(
    key: string,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<ObjectReceipt> {
    const stat = await statObject({ objectKey: key, signal });
    if (stat.byteLength !== bytes.byteLength || stat.etag !== objectEtag(bytes))
      throw new KodoError('conflict');
    return { key, byteLength: bytes.byteLength, sha256: sha256(bytes) };
  }
  async function existingReceipt(
    key: string,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ) {
    try {
      return await verifyObject(key, bytes, signal);
    } catch (error) {
      if (error instanceof KodoError && error.code === 'not_found')
        return undefined;
      throw error;
    }
  }
  async function writeSegment(input: {
    objectKey: string;
    bytes: Uint8Array;
    checksum?: string;
    contentType?: string;
    signal?: AbortSignal;
  }): Promise<ObjectReceipt> {
    const key = parse(keySchema, input.objectKey);
    const bytes = new Uint8Array(parse(z.instanceof(Uint8Array), input.bytes));
    const type = parse(
      mimeSchema,
      input.contentType ?? 'application/octet-stream',
    );
    if (input.checksum !== undefined && input.checksum !== sha256(bytes))
      throw new KodoError('integrity');
    const existing = await existingReceipt(key, bytes, input.signal);
    if (existing) return existing;
    const grant = issueUploadGrant({
      objectKey: key,
      byteLimit: Math.max(1, bytes.length),
      contentType: type,
      expiresAt: now() + 600000,
    });
    const form = new FormData();
    form.set('key', key);
    form.set('token', grant.token);
    form.set('file', new Blob([bytes], { type }), 'segment');
    try {
      const response = await request(uploadOrigin, {
        method: 'POST',
        body: form,
        signal: input.signal,
      });
      const result = z
        .object({ key: z.string(), hash: z.string() })
        .safeParse(await json(response));
      if (
        !result.success ||
        result.data.key !== key ||
        result.data.hash !== objectEtag(bytes)
      )
        throw new KodoError('integrity');
    } catch (error) {
      if (
        !(error instanceof KodoError) ||
        !['unavailable', 'timeout', 'conflict'].includes(error.code)
      )
        throw error;
      const recovered = await existingReceipt(key, bytes, input.signal);
      if (recovered) return recovered;
      throw error;
    }
    return verifyObject(key, bytes, input.signal);
  }
  function createTranscriptionSource(input: {
    objectKey: string;
    requiredRemainingTtlMs: number;
    purpose: 'tingwu-offline';
  }): TranscriptionSource {
    const key = parse(keySchema, input.objectKey);
    if (
      input.purpose !== 'tingwu-offline' ||
      !Number.isSafeInteger(input.requiredRemainingTtlMs) ||
      input.requiredRemainingTtlMs <
        TRANSCRIPTION_MIN_TTL_MS + TRANSCRIPTION_SAFETY_MS ||
      input.requiredRemainingTtlMs > 86400000
    )
      throw new KodoError('invalid_input');
    const expiresAt =
      Math.ceil((now() + input.requiredRemainingTtlMs) / 1000) * 1000;
    return new TranscriptionSource(key, expiresAt, signedUrl(key, expiresAt));
  }
  const client = {
    ...multipart({
      bucket: config.bucket,
      secret: config.secretKey,
      uploadOrigin,
      now,
      grant: issueUploadGrant,
      request,
      json,
      existing: existingReceipt,
      verify: verifyObject,
    }),
    issueUploadGrant,
    statObject,
    openObject,
    read,
    writeSegment,
    write: (input: { key: string; bytes: Uint8Array }) =>
      writeSegment({ objectKey: input.key, bytes: input.bytes }),
    createTranscriptionSource,
  } satisfies KodoClient & Record<string, unknown>;
  return client;
}
