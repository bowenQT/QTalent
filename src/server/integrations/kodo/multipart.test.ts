import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createKodoClient } from './index';
import { objectEtag, sha256 } from './protocol';
const config = {
  endpoint: 'https://objects.example.test',
  uploadEndpoint: 'https://up.example.test',
  managementEndpoint: 'https://rs.example.test',
  accessKey: 'synthetic-ak',
  secretKey: 'synthetic-secret',
  bucket: 'test-bucket',
};
const j = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const large = new Uint8Array(8 * 1024 * 1024 + 3).fill(7);
function setup() {
  let time = 1000;
  let complete = false;
  let failPart = 2;
  let completeMode = 'normal';
  const parts = new Map<number, { bytes: Uint8Array; etag: string }>();
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const target = new URL(String(url));
    if (target.hostname === 'rs.example.test')
      return complete
        ? j({
            fsize: large.length,
            hash: objectEtag(large),
            mimeType: 'audio/wav',
          })
        : j({}, 404);
    if (target.pathname.endsWith('/uploads'))
      return j({ uploadId: 'test-upload', expireAt: 604801 });
    if (!init?.method)
      return j({
        uploadId: 'test-upload',
        expireAt: 604801,
        partNumberMarker: 0,
        parts: Array.from(parts, ([partNumber, part]) => ({
          partNumber,
          size: part.bytes.length,
          etag: part.etag,
        })),
      });
    if (init.method === 'PUT') {
      const number = Number(target.pathname.split('/').at(-1));
      if (number === failPart) throw new Error('synthetic interruption');
      const bytes = new Uint8Array(init.body as Uint8Array);
      expect(new Headers(init.headers).get('Content-MD5')).toBe(
        createHash('md5').update(bytes).digest('hex'),
      );
      const etag = `part-${number}`;
      parts.set(number, { bytes, etag });
      return j({ etag, md5: createHash('md5').update(bytes).digest('hex') });
    }
    expect(JSON.parse(String(init?.body))).toEqual({
      parts: [
        { partNumber: 1, etag: 'part-1' },
        { partNumber: 2, etag: 'part-2' },
        { partNumber: 3, etag: 'part-3' },
      ],
      mimeType: 'audio/wav',
    });
    if (completeMode === 'part-only') return j({ etag: 'part-3' });
    complete = completeMode !== 'absent';
    if (completeMode === 'unknown' || completeMode === 'absent')
      throw new Error('unknown complete outcome');
    return j({ key: 'synthetic/large', hash: objectEtag(large) });
  });
  const client = createKodoClient(config, { fetch, now: () => time });
  return {
    client,
    fetch,
    parts,
    expire: () => {
      time = 604802000;
    },
    noFailure: () => {
      failPart = 0;
    },
    setCompleteMode: (value: string) => {
      completeMode = value;
    },
  };
}
const input = () => ({
  objectKey: 'synthetic/large',
  bytes: large,
  contentType: 'audio/wav',
});
describe('authenticated resumable multipart v2', () => {
  it('interrupts, resumes only missing parts, completes and verifies a full object', async () => {
    const s = setup();
    let checkpoint = await s.client.beginMultipart(input());
    await expect(
      s.client.resumeMultipart({
        ...input(),
        checkpoint,
        onCheckpoint: (next) => {
          checkpoint = next;
        },
      }),
    ).rejects.toMatchObject({ code: 'unavailable' });
    expect(s.parts.size).toBe(1);
    s.noFailure();
    const receipt = await s.client.resumeMultipart({
      ...input(),
      checkpoint,
      onCheckpoint: (next) => {
        checkpoint = next;
      },
    });
    expect(receipt.byteLength).toBe(large.length);
    expect(
      s.fetch.mock.calls.filter(
        ([url, init]) => init?.method === 'PUT' && String(url).endsWith('/1'),
      ),
    ).toHaveLength(1);
    expect(
      Buffer.concat(
        Array.from(s.parts.values(), (part) => Buffer.from(part.bytes)),
      ).equals(Buffer.from(large)),
    ).toBe(true);
    s.expire();
    expect(
      await s.client.resumeMultipart({
        ...input(),
        checkpoint,
        onCheckpoint: vi.fn(),
      }),
    ).toEqual(receipt);
  });
  it('binds checkpoint to key, bytes, bucket and signature before I/O', async () => {
    const s = setup();
    const checkpoint = await s.client.beginMultipart(input());
    s.fetch.mockClear();
    for (const patch of [
      { objectKey: 'other' },
      { bytes: new Uint8Array([1]) },
      { contentType: 'audio/mp3' },
      { checkpoint: checkpoint + 'x' },
      { checkpoint: 'bad' },
      { checkpoint: checkpoint.split('.')[0] + '.' + 'é'.repeat(28) },
    ])
      await expect(
        s.client.resumeMultipart({
          ...input(),
          checkpoint,
          onCheckpoint: vi.fn(),
          ...patch,
        }),
      ).rejects.toMatchObject({ code: 'invalid_resume' });
    expect(s.fetch).not.toHaveBeenCalled();
    const other = createKodoClient(
      { ...config, bucket: 'other' },
      { fetch: s.fetch },
    );
    await expect(
      other.resumeMultipart({ ...input(), checkpoint, onCheckpoint: vi.fn() }),
    ).rejects.toMatchObject({ code: 'invalid_resume' });
  });
  it('rejects expired contexts and malformed list responses', async () => {
    const s = setup();
    const checkpoint = await s.client.beginMultipart(input());
    s.expire();
    await expect(
      s.client.resumeMultipart({
        ...input(),
        checkpoint,
        onCheckpoint: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'expired' });
    const t = setup();
    const fresh = await t.client.beginMultipart(input());
    t.fetch
      .mockResolvedValueOnce(j({}, 404))
      .mockResolvedValueOnce(j({ uploadId: 'wrong' }));
    await expect(
      t.client.resumeMultipart({
        ...input(),
        checkpoint: fresh,
        onCheckpoint: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'invalid_resume' });
  });
  it('does not trust an uncheckpointed remote part and checks upload checksums', async () => {
    const s = setup();
    s.noFailure();
    const checkpoint = await s.client.beginMultipart(input());
    s.parts.set(1, {
      bytes: new Uint8Array(4 * 1024 * 1024),
      etag: 'untrusted',
    });
    await s.client.resumeMultipart({
      ...input(),
      checkpoint,
      onCheckpoint: vi.fn(),
    });
    expect(s.parts.get(1)?.bytes[0]).toBe(7);
    const t = setup();
    const fresh = await t.client.beginMultipart(input());
    t.fetch
      .mockResolvedValueOnce(j({}, 404))
      .mockResolvedValueOnce(
        j({
          uploadId: 'test-upload',
          expireAt: 604801,
          partNumberMarker: 0,
          parts: [],
        }),
      )
      .mockResolvedValueOnce(j({ etag: 'x', md5: 'wrong' }));
    await expect(
      t.client.resumeMultipart({
        ...input(),
        checkpoint: fresh,
        onCheckpoint: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'integrity' });
  });
  for (const mode of ['part-only', 'unknown', 'absent'])
    it(`${mode}: completion cannot acknowledge parts as durable objects`, async () => {
      const s = setup();
      s.noFailure();
      s.setCompleteMode(mode);
      const checkpoint = await s.client.beginMultipart(input());
      const result = s.client.resumeMultipart({
        ...input(),
        checkpoint,
        onCheckpoint: vi.fn(),
      });
      if (mode === 'unknown')
        expect((await result).byteLength).toBe(large.length);
      else
        await expect(result).rejects.toMatchObject({
          code: mode === 'part-only' ? 'integrity' : 'unavailable',
        });
    });
  it('checkpoints the bytes from before init returns', async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const digest = sha256(bytes);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      bytes[0] = 9;
      return j({ uploadId: 'test-upload', expireAt: 604801 });
    });
    const client = createKodoClient(config, { fetch, now: () => 1000 });
    const checkpoint = await client.beginMultipart({
      objectKey: 'synthetic/small',
      bytes,
      contentType: 'audio/wav',
    });
    const payload = checkpoint
      .split('.')[0]!
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    expect(JSON.parse(Buffer.from(payload, 'base64').toString()).sha256).toBe(
      digest,
    );
  });
  it('rejects invalid start responses and empty input', async () => {
    const s = setup();
    await expect(
      s.client.beginMultipart({ ...input(), bytes: new Uint8Array() }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    s.fetch.mockResolvedValueOnce(j({ uploadId: 'x' }));
    await expect(s.client.beginMultipart(input())).rejects.toMatchObject({
      code: 'integrity',
    });
    s.fetch.mockResolvedValueOnce(j({ uploadId: 'x', expireAt: 1 }));
    await expect(s.client.beginMultipart(input())).rejects.toMatchObject({
      code: 'expired',
    });
  });
});
