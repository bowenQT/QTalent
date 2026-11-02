import { describe, expect, it, vi } from 'vitest';
import type { UploadGrant } from '@/contracts/media';
import type { MaterialBatchReceipt } from '@/contracts/materials';
import { bucketOf, PART_BYTES, uploadToKodo } from './kodo-upload';
import {
  createLiveMaterialsPort,
  NO_ACTIVE_NODE,
  type MaterialsTransport,
} from './live-port';

const urlSafe = (value: string) =>
  btoa(value).replace(/\+/g, '-').replace(/\//g, '_');
const KEY = 'materials/demo-key';
const grant = (scope = `demo-bucket:${KEY}`): UploadGrant => ({
  uploadId: 'upload-1',
  recordCollectionId: 'collection-1',
  revision: 3,
  expiresAt: '2026-11-03T12:00:00.000Z',
  method: 'resumable_v2',
  uploadEndpoint: 'https://upload.example.test',
  uploadToken: `ak:sig:${urlSafe(JSON.stringify({ scope, deadline: 1 }))}`,
  objectKey: KEY,
  maxBytes: 3 * PART_BYTES,
});
const receipt = { batchId: 'batch-1' } as unknown as MaterialBatchReceipt;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

/** A Kodo double that stores parts and answers like the v2 multipart API. */
function kodo({ failPart }: { failPart?: number } = {}) {
  const calls: { method: string; url: string }[] = [];
  const fetcher = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ method, url: href });
      if (init?.signal?.aborted) throw init.signal.reason;
      if (method === 'POST' && href.endsWith('/uploads'))
        return json({ uploadId: 'kodo/1', expireAt: 1 });
      if (method === 'PUT') {
        const part = Number(href.split('/').pop());
        return part === failPart
          ? json({ error: 'busy' }, 503)
          : json({ etag: `etag-${part}`, md5: 'x' });
      }
      return json({ key: KEY, hash: 'stored-hash' });
    },
  );
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

function transport(
  overrides: Partial<MaterialsTransport> = {},
): MaterialsTransport {
  return {
    requestUpload: vi.fn(async () => ({
      status: 'success' as const,
      upload: grant(),
    })),
    completeUpload: vi.fn(async (input) => ({
      status: 'success' as const,
      result: {
        uploadId: input.uploadId,
        recordCollectionId: 'collection-1',
        originalId: 'original-1',
        originalVersionId: 'version-1',
        source: null,
        jobId: 'job-1',
        revision: 4,
      },
    })),
    submitBatch: vi.fn(async () => ({
      status: 'success' as const,
      receipt,
    })),
    readBatch: vi.fn(async () => ({
      status: 'success' as const,
      replayed: false,
      result: receipt,
    })),
    ...overrides,
  };
}

const audio = (bytes = 10) =>
  new File([new Uint8Array(bytes)], '演示访谈.m4a', { type: '' });

describe('bucketOf', () => {
  it('reads the bucket from the token scope for the granted key only', () => {
    expect(bucketOf(grant())).toBe('demo-bucket');
    expect(bucketOf(grant('demo-bucket:other-key'))).toBeNull();
    expect(bucketOf({ ...grant(), uploadToken: 'not-a-token' })).toBeNull();
  });
});

describe('uploadToKodo', () => {
  it('sends init, every part and complete, reporting parts stored', async () => {
    const { fetcher, calls } = kodo();
    const progress: number[] = [];
    const result = await uploadToKodo(
      grant(),
      new Blob([new Uint8Array(PART_BYTES * 2 + 1)]),
      'audio/mp4',
      (percent) => progress.push(percent),
      new AbortController().signal,
      fetcher,
    );
    expect(result).toEqual({ status: 'stored', hash: 'stored-hash' });
    const base = `https://upload.example.test/buckets/demo-bucket/objects/${urlSafe(KEY)}/uploads`;
    expect(calls).toEqual([
      { method: 'POST', url: base },
      { method: 'PUT', url: `${base}/kodo%2F1/1` },
      { method: 'PUT', url: `${base}/kodo%2F1/2` },
      { method: 'PUT', url: `${base}/kodo%2F1/3` },
      { method: 'POST', url: `${base}/kodo%2F1` },
    ]);
    expect(progress.map(Math.round)).toEqual([33, 67, 100]);
    const complete = vi.mocked(fetcher).mock.calls[4]![1]!;
    expect(JSON.parse(String(complete.body))).toEqual({
      parts: [1, 2, 3].map((partNumber) => ({
        partNumber,
        etag: `etag-${partNumber}`,
      })),
      mimeType: 'audio/mp4',
    });
  });

  it('fails on a refused part, a form grant or a foreign scope', async () => {
    const signal = new AbortController().signal;
    const blob = new Blob([new Uint8Array(PART_BYTES + 1)]);
    const refused = kodo({ failPart: 2 });
    expect(
      await uploadToKodo(
        grant(),
        blob,
        'audio/mp4',
        () => {},
        signal,
        refused.fetcher,
      ),
    ).toEqual({ status: 'failed' });
    expect(refused.calls).toHaveLength(3);
    for (const bad of [
      { ...grant(), method: 'form' as const },
      grant('demo-bucket:other-key'),
    ]) {
      const unused = kodo();
      expect(
        await uploadToKodo(
          bad,
          blob,
          'audio/mp4',
          () => {},
          signal,
          unused.fetcher,
        ),
      ).toEqual({ status: 'failed' });
      expect(unused.calls).toHaveLength(0);
    }
  });
});

describe('createLiveMaterialsPort', () => {
  it('uploads through grant, Kodo and completion', async () => {
    const api = transport();
    const { fetcher } = kodo();
    const port = createLiveMaterialsPort(api, fetcher);
    const outcome = await port.upload(
      audio(),
      () => {},
      new AbortController().signal,
    );
    expect(outcome).toEqual({ status: 'uploaded', uploadId: 'upload-1' });
    expect(vi.mocked(api.requestUpload).mock.calls[0]![0]).toMatchObject({
      purpose: 'audio',
      filename: '演示访谈.m4a',
      declaredBytes: 10,
      declaredMediaType: 'audio/mp4',
    });
    expect(vi.mocked(api.completeUpload).mock.calls[0]![0]).toMatchObject({
      uploadId: 'upload-1',
      receiptRef: 'stored-hash',
      expectedRevision: 3,
    });
  });

  it('rejects what the server will not take, without a transfer', async () => {
    const { fetcher, calls } = kodo();
    const port = createLiveMaterialsPort(
      transport({
        requestUpload: async () => ({
          status: 'unsupported',
          reason: 'size',
          message: '文件超过 2 GB',
        }),
      }),
      fetcher,
    );
    const signal = new AbortController().signal;
    expect(await port.upload(audio(), () => {}, signal)).toEqual({
      status: 'rejected',
      message: '文件超过 2 GB',
    });
    expect(
      (await port.upload(new File(['x'], 'a.exe'), () => {}, signal)).status,
    ).toBe('rejected');
    expect(calls).toHaveLength(0);
  });

  it('interrupts on an abort, a failed part or a lost connection', async () => {
    const abort = new AbortController();
    abort.abort(new Error('closed'));
    const api = transport();
    expect(
      (
        await createLiveMaterialsPort(api, kodo().fetcher).upload(
          audio(),
          () => {},
          abort.signal,
        )
      ).status,
    ).toBe('interrupted');
    expect(api.completeUpload).not.toHaveBeenCalled();
    const signal = new AbortController().signal;
    expect(
      (
        await createLiveMaterialsPort(
          transport(),
          kodo({ failPart: 1 }).fetcher,
        ).upload(audio(), () => {}, signal)
      ).status,
    ).toBe('interrupted');
    expect(
      await createLiveMaterialsPort(
        transport({
          requestUpload: () => Promise.reject(new TypeError('offline')),
        }),
      ).upload(audio(), () => {}, signal),
    ).toEqual({ status: 'interrupted', message: '上传中断，可以重试' });
  });

  it('maps batch submission: accepted, no node in progress, declined, offline', async () => {
    const files = [{ clientFileId: 'c-1', uploadId: 'upload-1' }];
    const submit = (submitBatch: MaterialsTransport['submitBatch']) =>
      createLiveMaterialsPort(transport({ submitBatch })).submit({
        operationId: 'op-1',
        files,
      });
    expect(await submit(async () => ({ status: 'success', receipt }))).toEqual({
      status: 'accepted',
      receipt,
    });
    expect(await submit(async () => ({ status: 'no_active_node' }))).toEqual({
      status: 'refused',
      message: NO_ACTIVE_NODE,
    });
    expect(
      await submit(async () => ({ status: 'declined', message: '没有权限' })),
    ).toEqual({ status: 'refused', message: '没有权限' });
    expect(
      await submit(() => Promise.reject(new TypeError('offline'))),
    ).toEqual({ status: 'interrupted', message: '提交中断，可以重新提交' });
  });

  it('reads the receipt, or null when it cannot be read', async () => {
    expect(await createLiveMaterialsPort(transport()).read('batch-1')).toBe(
      receipt,
    );
    const missing = createLiveMaterialsPort(
      transport({
        readBatch: async () => ({ status: 'not_found', message: '找不到' }),
      }),
    );
    expect(await missing.read('batch-1')).toBeNull();
  });
});
