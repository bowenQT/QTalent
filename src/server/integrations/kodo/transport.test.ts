import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeKodo,
  createKodoClient,
  takeTranscriptionSourceUrl,
} from './index';
import { base64, objectEtag, sign } from './protocol';
const config = {
  endpoint: 'https://objects.example.test',
  uploadEndpoint: 'https://up.example.test',
  managementEndpoint: 'https://rs.example.test',
  accessKey: 'synthetic-ak',
  secretKey: 'synthetic-secret',
  bucket: 'test-bucket',
};
const bytes = new Uint8Array([1, 2, 3]);
const j = (value: unknown, status = 200) => {
  const response = new Response(JSON.stringify(value), {
    status: status > 599 ? 400 : status,
  });
  if (status > 599)
    Object.defineProperty(response, 'status', { value: status });
  return response;
};
const metadata = (value: Uint8Array = bytes) => ({
  fsize: value.length,
  hash: objectEtag(value),
  mimeType: 'audio/wav',
});
afterEach(() => vi.unstubAllGlobals());
function mockStore() {
  const objects = new Map<string, Uint8Array>();
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const target = new URL(String(url));
    if (target.hostname === 'rs.example.test') {
      const key = Buffer.from(target.pathname.slice(6), 'base64')
        .toString()
        .split(':')
        .slice(1)
        .join(':');
      const value = objects.get(key);
      return value ? j(metadata(value)) : j({}, 404);
    }
    if (init?.body instanceof FormData) {
      const value = new Uint8Array(
        await (init.body.get('file') as Blob).arrayBuffer(),
      );
      const key = String(init.body.get('key'));
      objects.set(key, value);
      return j({ key, hash: objectEtag(value) });
    }
    const value = objects.get(decodeURIComponent(target.pathname.slice(1)));
    return value
      ? new Response(new Uint8Array(value), {
          headers: {
            'content-length': String(value.length),
            'content-type': 'audio/wav',
            'x-secret': 'hidden',
          },
        })
      : j({}, 404);
  });
  return { fetch, objects };
}
describe('Kodo transport and immutable contract', () => {
  for (const mode of ['fake', 'real'] as const)
    it(`${mode}: write/read/replay/conflict keep immutable bytes`, async () => {
      vi.stubGlobal('fetch', () => {
        throw new Error('External network forbidden');
      });
      const transport = mockStore();
      const client =
        mode === 'fake'
          ? createFakeKodo()
          : createKodoClient(config, {
              fetch: transport.fetch,
              now: () => 1000,
            });
      const input = { key: 'synthetic/key', bytes: new Uint8Array(bytes) };
      const receipt = await client.write(input);
      expect(receipt).toEqual({
        key: input.key,
        byteLength: 3,
        sha256:
          '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
      });
      expect(await client.write(input)).toEqual(receipt);
      input.bytes[0] = 9;
      expect(await client.read(input.key)).toEqual(bytes);
      await expect(client.write(input)).rejects.toThrow('conflict');
      await expect(client.read('missing')).rejects.toThrow('not found');
    });
  it('uses documented padded URL base64 and QBox signing vector', () => {
    expect(base64('a?')).toBe('YT8=');
    expect(
      sign(
        'MY_SECRET_KEY',
        '/move/bmV3ZG9jczpmaW5kX21hbi50eHQ=/bmV3ZG9jczpmaW5kLm1hbi50eHQ=\n',
      ),
    ).toBe('FXsYh0wKHYPEsIAgdPD9OfjkeEM=');
    expect(objectEtag(new Uint8Array())).toBe('Fto5o-5ea0sNMlW_75VgGJCv2AcJ');
    expect(objectEtag(new Uint8Array(4194305))).toHaveLength(28);
  });
  it('verifies key, length and full-object hash before receipt, never a part ETag', async () => {
    for (const bad of [
      { etag: 'part' },
      { key: 'wrong', hash: objectEtag(bytes) },
      { key: 'synthetic/key', hash: 'wrong' },
    ]) {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(j({}, 404))
        .mockResolvedValueOnce(j(bad));
      await expect(
        createKodoClient(config, { fetch }).write({
          key: 'synthetic/key',
          bytes,
        }),
      ).rejects.toMatchObject({ code: 'integrity' });
    }
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(j({}, 404))
      .mockResolvedValueOnce(
        j({ key: 'synthetic/key', hash: objectEtag(bytes) }),
      )
      .mockResolvedValueOnce(j({ ...metadata(), fsize: 2 }));
    await expect(
      createKodoClient(config, { fetch }).write({
        key: 'synthetic/key',
        bytes,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
  it('recovers unknown write outcome by stat without replaying POST', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(j({}, 404))
      .mockRejectedValueOnce(new Error('secret signed URL'))
      .mockResolvedValueOnce(j(metadata()));
    expect(
      await createKodoClient(config, { fetch }).write({
        key: 'synthetic/key',
        bytes,
      }),
    ).toMatchObject({ byteLength: 3 });
    expect(
      fetch.mock.calls.filter(([, init]) => init?.method === 'POST'),
    ).toHaveLength(1);
  });
  it('does not issue receipt when unknown outcome is still absent', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(j({}, 404))
      .mockRejectedValueOnce(new Error('secret signed URL'))
      .mockResolvedValueOnce(j({}, 404));
    await expect(
      createKodoClient(config, { fetch }).write({
        key: 'synthetic/key',
        bytes,
      }),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('rejects bad checksum before network and validates stat response', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(j({ fsize: -1 }));
    const client = createKodoClient(config, { fetch });
    await expect(
      client.writeSegment({
        objectKey: 'synthetic/key',
        bytes,
        checksum: 'wrong',
      }),
    ).rejects.toMatchObject({ code: 'integrity' });
    expect(fetch).not.toHaveBeenCalled();
    await expect(
      client.statObject({ objectKey: 'synthetic/key' }),
    ).rejects.toMatchObject({ code: 'integrity' });
  });
  it('bounds retries, maps statuses, and never retains provider messages', async () => {
    for (const [status, code, count] of [
      [429, 'rate_limited', 3],
      [503, 'unavailable', 3],
      [401, 'unauthorized', 1],
      [614, 'conflict', 1],
      [400, 'invalid_input', 1],
      [416, 'invalid_range', 1],
    ] as const) {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockImplementation(async () => j({ error: 'secret token' }, status));
      await expect(
        createKodoClient(config, { fetch }).statObject({ objectKey: 'x' }),
      ).rejects.toMatchObject({ code });
      expect(fetch).toHaveBeenCalledTimes(count);
    }
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new Error('token=secret'));
    await expect(createKodoClient(config, { fetch }).read('x')).rejects.toThrow(
      'Kodo unavailable',
    );
  });
  it('maps cancellation and timeout without exposing raw transport errors', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      if (init?.signal?.aborted) throw new Error('raw secret');
      await new Promise((_resolve, reject) =>
        init?.signal?.addEventListener(
          'abort',
          () => reject(new Error('raw secret')),
          { once: true },
        ),
      );
      return j({});
    });
    const client = createKodoClient(config, { fetch, timeoutMs: 5 });
    await expect(
      client.statObject({ objectKey: 'x', signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    await expect(client.read('x')).rejects.toMatchObject({ code: 'timeout' });
  });
});
describe('private proxy stream', () => {
  it('classifies timeouts after headers during JSON and stream consumption', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async (_url, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener(
                'abort',
                () => controller.error(new Error('raw signature')),
                { once: true },
              );
            },
          }),
          { headers: { 'content-length': '4', 'content-type': 'audio/wav' } },
        ),
    );
    const client = createKodoClient(config, { fetch, timeoutMs: 5 });
    await expect(client.read('x')).rejects.toMatchObject({ code: 'timeout' });
    await expect(client.statObject({ objectKey: 'x' })).rejects.toMatchObject({
      code: 'timeout',
    });
  });

  it('returns only allowlisted headers and exact byte range', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(new Uint8Array([2, 3]), {
        status: 206,
        headers: {
          'content-range': 'bytes 1-2/3',
          'content-length': '2',
          'content-type': 'audio/wav',
          location: 'signed-secret',
          'set-cookie': 'private',
        },
      }),
    );
    const opened = await createKodoClient(config, { fetch }).openObject({
      objectKey: 'synthetic/space ?#',
      range: { start: 1 },
    });
    expect(opened.headers).toEqual({
      'content-range': 'bytes 1-2/3',
      'content-length': '2',
      'content-type': 'audio/wav',
    });
    expect(
      new Uint8Array(await new Response(opened.body).arrayBuffer()),
    ).toEqual(new Uint8Array([2, 3]));
    expect(String(fetch.mock.calls[0][0])).toContain('space%20%3F%23?e=');
    expect(fetch.mock.calls[0][1]).toMatchObject({
      redirect: 'error',
      headers: { Range: 'bytes=1-' },
    });
  });
  it('rejects invalid ranges before I/O and ignored or malformed range responses', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = createKodoClient(config, { fetch });
    await expect(
      client.openObject({ objectKey: 'x', range: { start: 2, end: 1 } }),
    ).rejects.toMatchObject({ code: 'invalid_range' });
    expect(fetch).not.toHaveBeenCalled();
    for (const status of [200, 206]) {
      fetch.mockResolvedValueOnce(
        new Response(bytes, {
          status,
          headers: {
            'content-length': '3',
            'content-type': 'audio/wav',
            'content-range': 'bytes 0-2/3',
          },
        }),
      );
      await expect(
        client.openObject({ objectKey: 'x', range: { start: 1, end: 2 } }),
      ).rejects.toMatchObject({ code: 'invalid_range' });
    }
  });
  it('rejects missing metadata, truncated and failing streams', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(bytes));
    const client = createKodoClient(config, { fetch });
    await expect(client.read('x')).rejects.toMatchObject({ code: 'integrity' });
    fetch.mockResolvedValueOnce(
      new Response(bytes, {
        headers: { 'content-length': '4', 'content-type': 'audio/wav' },
      }),
    );
    await expect(client.read('x')).rejects.toMatchObject({ code: 'integrity' });
    fetch.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          pull(c) {
            c.error(new Error('signed-secret'));
          },
        }),
        { headers: { 'content-length': '4', 'content-type': 'audio/wav' } },
      ),
    );
    await expect(client.read('x')).rejects.toThrow('Kodo unavailable');
  });
  it('supports cancelling and closing reads', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(bytes, {
          headers: { 'content-length': '3', 'content-type': 'audio/wav' },
        }),
    );
    const client = createKodoClient(config, { fetch });
    const opened = await client.openObject({ objectKey: 'x' });
    await opened.body.cancel();
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
    const second = await client.openObject({ objectKey: 'x' });
    second.close();
    await expect(new Response(second.body).arrayBuffer()).rejects.toMatchObject(
      { code: 'cancelled' },
    );
  });
});
describe('grant validation and server source', () => {
  it('rejects credentialed/non-HTTPS endpoints, unsafe key/type/TTL/size', () => {
    for (const endpoint of [
      'http://bad.test',
      'https://a:b@bad.test',
      'https://bad.test/path',
      'https://bad.test?x=y',
    ])
      expect(() => createKodoClient({ ...config, endpoint })).toThrow();
    const client = createKodoClient(config, { now: () => 1000 });
    const input = {
      objectKey: 'x',
      contentType: 'audio/wav',
      byteLimit: 3,
      expiresAt: 61000,
    };
    for (const patch of [
      { objectKey: '../x' },
      { objectKey: 'x\\y' },
      { objectKey: '' },
      { contentType: '*' },
      { byteLimit: 0 },
      { expiresAt: 3602000 },
    ])
      expect(() => client.issueUploadGrant({ ...input, ...patch })).toThrow();
    expect(() =>
      client.issueUploadGrant({ ...input, expiresAt: 1000 }),
    ).toThrow('expired');
  });
  it('redacts inspect/JSON and prevents forged/stale source capabilities', () => {
    const client = createKodoClient(config, { now: () => 1000 });
    const source = client.createTranscriptionSource({
      objectKey: 'x',
      purpose: 'tingwu-offline',
      requiredRemainingTtlMs: 11100000,
    });
    expect(inspect(source)).toBe('[Kodo transcription source redacted]');
    expect(Object.values(source).join()).not.toContain('token');
    expect(() =>
      takeTranscriptionSourceUrl({ ...source } as typeof source, {
        now: () => 1000,
      }),
    ).toThrow();
    expect(() =>
      takeTranscriptionSourceUrl(source, {
        now: () => 1000,
        requiredRemainingTtlMs: 0,
      }),
    ).toThrow();
    expect(() =>
      client.createTranscriptionSource({
        objectKey: 'x',
        purpose: 'tingwu-offline',
        requiredRemainingTtlMs: 10800000,
      }),
    ).toThrow();
    expect(takeTranscriptionSourceUrl(source, { now: () => 1000 })).toMatch(
      /^https:\/\/objects.example.test\/x\?e=11101&token=synthetic-ak:/,
    );
  });
});
