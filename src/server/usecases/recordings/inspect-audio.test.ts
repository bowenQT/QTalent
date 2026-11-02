import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { createKodoClient } from '../../integrations/kodo';
import type { ArchivedUpload } from '../../modules/records/recordings/types';
import { createKodoAudioInspector } from './inspect-audio';

const created = vi.hoisted(() => [] as string[]);
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>();
  return {
    ...fs,
    mkdtemp: async (...args: Parameters<typeof fs.mkdtemp>) => {
      const path = await fs.mkdtemp(...args);
      created.push(String(path));
      return path;
    },
  };
});
afterEach(async () => {
  // Observe the real allocation; never replace download, decoder or removal with fakes.
  for (const path of created.splice(0))
    await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
});
const options = {
  ffprobePath:
    process.env.QTALENT_TEST_FFPROBE_PATH ??
    (process.platform === 'darwin'
      ? '/opt/homebrew/bin/ffprobe'
      : '/usr/bin/ffprobe'),
  ffmpegPath:
    process.env.QTALENT_TEST_FFMPEG_PATH ??
    (process.platform === 'darwin'
      ? '/opt/homebrew/bin/ffmpeg'
      : '/usr/bin/ffmpeg'),
  timeoutMs: 10000,
  maxDurationMs: 10000,
  maxBytes: 100000,
  readTimeoutMs: 10000,
};
function fixture() {
  const bytes = Buffer.alloc(3244);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24);
  bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(3200, 40);
  const reference = {
    uploadId: 'demo-upload',
    uploadJobId: 'demo-job',
    originalId: 'demo-original',
    originalVersionId: 'demo-version',
  };
  const upload: ArchivedUpload = {
    uploadId: reference.uploadId,
    recordCollectionId: 'demo-collection',
    jobId: reference.uploadJobId,
    originalId: reference.originalId,
    originalVersionId: reference.originalVersionId,
    purpose: 'audio',
    filename: '演示.wav',
    accountId: 'demo-account',
    quotaScope: 'opaque',
    target: { kind: 'people', personIds: ['demo-person'] },
    object: {
      objectKey: 'synthetic/demo-audio',
      byteLength: bytes.length,
      mediaType: 'audio/wav',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      etag: 'synthetic-etag',
    },
  };
  const stat = {
    key: upload.object.objectKey,
    byteLength: bytes.length,
    mediaType: 'audio/wav',
    etag: upload.object.etag,
  };
  const close = vi.fn();
  const opened = {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 500));
        controller.enqueue(bytes.subarray(500));
        controller.close();
      },
    }),
    headers: {
      'content-length': String(bytes.length),
      'content-type': 'audio/wav',
    },
    status: 200,
    close,
  };
  const kodo = {
    statObject: vi.fn(async () => ({ ...stat })),
    openObject: vi.fn(async () => opened),
  };
  return { bytes, reference, upload, stat, opened, close, kodo };
}
describe('verified archived Kodo bytes to actual audio inspection', () => {
  it('streams both chunks, hashes the exact version and actually decodes its sample count', async () => {
    const f = fixture();
    expect(
      await createKodoAudioInspector(f.kodo, options)(f.upload, f.reference),
    ).toEqual({
      originalVersionId: f.reference.originalVersionId,
      sha256: f.upload.object.sha256,
      byteLength: f.bytes.length,
      format: 'wav',
      durationMs: 100,
    });
    expect(f.kodo.statObject).toHaveBeenCalledTimes(2);
    expect(f.kodo.openObject).toHaveBeenCalledTimes(1);
    expect(f.close).toHaveBeenCalledTimes(1);
  });
  it('uses the existing real Kodo client with a synthetic HTTP transport', async () => {
    const f = fixture();
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.method === 'HEAD' || String(_url).includes('/stat/'))
        return Response.json({
          fsize: f.bytes.length,
          mimeType: 'audio/wav',
          hash: f.stat.etag,
        });
      return new Response(f.bytes, {
        headers: {
          'content-length': String(f.bytes.length),
          'content-type': 'audio/wav',
        },
      });
    });
    const storageConfig = {
      endpoint: 'https://objects.example.test',
      s3Region: 'cn-east-1',
      uploadEndpoint: 'https://up.example.test',
      managementEndpoint: 'https://rs.example.test',
      accessKey: 'synthetic-ak',
      secretKey: 'synthetic-secret',
      bucket: 'demo',
    };
    const client = createKodoClient(storageConfig, {
      fetch: fetcher,
      now: () => 1700000000000,
    });
    expect(
      (await createKodoAudioInspector(client, options)(f.upload, f.reference))
        .durationMs,
    ).toBe(100);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it.each([
    'uploadId',
    'uploadJobId',
    'originalId',
    'originalVersionId',
  ] as const)(
    'rejects mismatched %s before reading any storage object',
    async (key) => {
      const f = fixture();
      await expect(
        createKodoAudioInspector(f.kodo, options)(f.upload, {
          ...f.reference,
          [key]: 'other-version',
        }),
      ).rejects.toMatchObject({ code: 'invalid_archive' });
      expect(f.kodo.statObject).not.toHaveBeenCalled();
      expect(f.kodo.openObject).not.toHaveBeenCalled();
    },
  );
  it.each([
    { byteLength: 100001 },
    { byteLength: 0 },
    { byteLength: 1.1 },
    { sha256: 'not-a-digest' },
    { etag: '' },
    { objectKey: '' },
    { mediaType: 'video/mp4' },
  ])('rejects invalid archived object facts before reading', async (bad) => {
    const f = fixture();
    Object.assign(f.upload.object, bad);
    await expect(
      createKodoAudioInspector(f.kodo, options)(f.upload, f.reference),
    ).rejects.toMatchObject({ code: 'invalid_archive' });
    expect(f.kodo.openObject).not.toHaveBeenCalled();
  });
  it('rejects attachment-purpose bytes', async () => {
    const f = fixture();
    f.upload.purpose = 'attachment';
    await expect(
      createKodoAudioInspector(f.kodo, options)(f.upload, f.reference),
    ).rejects.toMatchObject({ code: 'invalid_archive' });
  });
  it.each([
    { key: 'other-object' },
    { etag: 'changed-version' },
    { byteLength: 3245 },
    { mediaType: 'audio/mpeg' },
  ])('rejects a changed object stat before its body is read', async (bad) => {
    const f = fixture();
    Object.assign(f.stat, bad);
    await expect(
      createKodoAudioInspector(f.kodo, options)(f.upload, f.reference),
    ).rejects.toMatchObject({ code: 'invalid_archive' });
    expect(f.kodo.openObject).not.toHaveBeenCalled();
  });
  it('rechecks object identity after reading and before decoding', async () => {
    const f = fixture();
    f.kodo.statObject
      .mockResolvedValueOnce({ ...f.stat })
      .mockResolvedValueOnce({ ...f.stat, etag: 'other-version' });
    await expect(
      createKodoAudioInspector(f.kodo, options)(f.upload, f.reference),
    ).rejects.toMatchObject({ code: 'invalid_archive' });
    expect(f.kodo.statObject).toHaveBeenCalledTimes(2);
    expect(f.close).toHaveBeenCalled();
  });
  it.each(['length', 'type', 'status'])(
    'rejects invalid response %s',
    async (which) => {
      const f = fixture();
      if (which === 'length') f.opened.headers['content-length'] = '1';
      if (which === 'type') f.opened.headers['content-type'] = 'audio/mpeg';
      if (which === 'status') f.opened.status = 206;
      await expect(
        createKodoAudioInspector(f.kodo, options)(f.upload, f.reference),
      ).rejects.toMatchObject({ code: 'invalid_archive' });
      expect(f.close).toHaveBeenCalled();
    },
  );
  it.each(['short', 'overflow', 'digest'])(
    'rejects %s body without fabricating a duration',
    async (which) => {
      const f = fixture();
      let body: Uint8Array = f.bytes;
      if (which === 'short') body = body.subarray(0, body.length - 1);
      if (which === 'overflow') body = Buffer.concat([body, Buffer.from([0])]);
      if (which === 'digest') {
        body = Buffer.from(body);
        body[100] ^= 1;
      }
      f.opened.body = new ReadableStream({
        start(c) {
          c.enqueue(body);
          c.close();
        },
      });
      await expect(
        createKodoAudioInspector(f.kodo, options)(f.upload, f.reference),
      ).rejects.toMatchObject({ code: 'invalid_archive' });
      expect(f.kodo.statObject).toHaveBeenCalledTimes(1);
      expect(f.close).toHaveBeenCalled();
    },
  );
  it('rejects digest-valid malformed media instead of accepting the declared MIME', async () => {
    const f = fixture();
    f.bytes.writeUInt32LE(999999, 40);
    f.upload.object.sha256 = createHash('sha256').update(f.bytes).digest('hex');
    await expect(
      createKodoAudioInspector(f.kodo, options)(f.upload, f.reference),
    ).rejects.toMatchObject({ code: 'invalid_archive' });
  });
  it('rejects real container/MIME disagreement', async () => {
    const f = fixture();
    f.upload.object.mediaType = 'audio/mpeg';
    f.stat.mediaType = 'audio/mpeg';
    f.opened.headers['content-type'] = 'audio/mpeg';
    await expect(
      createKodoAudioInspector(f.kodo, options)(f.upload, f.reference),
    ).rejects.toMatchObject({ code: 'invalid_archive' });
  });
  it('does not inherit mutations to the upload handoff while awaiting storage', async () => {
    const f = fixture();
    f.kodo.statObject.mockImplementation(async () => {
      f.upload.originalVersionId = 'mutated';
      f.upload.object.sha256 = 'b'.repeat(64);
      f.upload.object.objectKey = 'mutated';
      return { ...f.stat };
    });
    const result = await createKodoAudioInspector(f.kodo, options)(
      f.upload,
      f.reference,
    );
    expect(result.originalVersionId).toBe(f.reference.originalVersionId);
    expect(result.sha256).toBe(
      createHash('sha256').update(f.bytes).digest('hex'),
    );
  });
  it('closes a stalled body on timeout without retaining audio or exposing errors', async () => {
    const f = fixture();
    const cancel = vi.fn();
    f.opened.body = new ReadableStream({
      pull: () => new Promise(() => {}),
      cancel,
    });
    await expect(
      createKodoAudioInspector(f.kodo, { ...options, readTimeoutMs: 30 })(
        f.upload,
        f.reference,
      ),
    ).rejects.toMatchObject({ code: 'provider_unavailable' });
    expect(cancel).toHaveBeenCalled();
    expect(f.close).toHaveBeenCalled();
  });
  it('honors cancellation before any storage read', async () => {
    const f = fixture();
    await expect(
      createKodoAudioInspector(f.kodo, options)(
        f.upload,
        f.reference,
        AbortSignal.abort(),
      ),
    ).rejects.toMatchObject({ code: 'provider_unavailable' });
    expect(f.kodo.statObject).not.toHaveBeenCalled();
  });
  it('redacts storage exceptions', async () => {
    const f = fixture();
    f.kodo.statObject.mockRejectedValue(
      new Error('synthetic-private-object-and-header'),
    );
    await expect(
      createKodoAudioInspector(f.kodo, options)(f.upload, f.reference),
    ).rejects.toThrow(/^provider_unavailable$/);
  });
  it('has no fake fallback when FFmpeg is unavailable and cleans the verified bytes', async () => {
    const f = fixture();
    await expect(
      createKodoAudioInspector(f.kodo, {
        ...options,
        ffmpegPath: '/does-not-exist/q859-ffmpeg',
      })(f.upload, f.reference),
    ).rejects.toMatchObject({ code: 'provider_unavailable' });
  });
  it.each([
    { maxBytes: 0 },
    { maxBytes: 2147483649 },
    { readTimeoutMs: 0 },
    { readTimeoutMs: 600001 },
  ])('requires bounded download configuration', (bad) => {
    const f = fixture();
    expect(() =>
      createKodoAudioInspector(f.kodo, { ...options, ...bad }),
    ).toThrow('invalid_audio_inspector_config');
  });
});
