import { createCipheriv, createHash } from 'node:crypto';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { lookup } from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import type {
  ClientRequest,
  IncomingMessage,
  RequestListener,
} from 'node:http';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWecomMediaDownloader,
  decryptWecomFile,
  isPublicMediaAddress,
  validateMediaURL,
  type WecomMediaIO,
  type MediaRequestPlan,
} from './media';
vi.mock('node:https', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:https')>()),
  request: vi.fn(() => {
    throw new Error('No public network allowed in this test');
  }),
}));
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]),
}));
// Public synthetic vector. OpenSSL independently produced this ciphertext with a 32-byte padded input.
const key = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
const aesKey = key.toString('base64');
const plain = Buffer.from('demo-WeCom-32-byte-padding');
const golden = Buffer.from(
  '1d593079b032c52b38c746809b05c54ea479c1ed13d9e66fddca37f731e01d74',
  'hex',
);
const origin = 'https://media.example.invalid';
const media = {
  kind: 'file' as const,
  url: `${origin}/encrypted?demo=1`,
  aesKey,
};
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  vi.clearAllMocks();
});
function encryptPadded(padded: Buffer) {
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]);
}
function encrypt(bytes: Buffer) {
  const pad = 32 - (bytes.length % 32);
  return encryptPadded(Buffer.concat([bytes, Buffer.alloc(pad, pad)]));
}
async function local(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No local address');
  const plans: MediaRequestPlan[] = [];
  const io: WecomMediaIO = {
    resolve: async () => [{ address: '8.8.8.8', family: 4 }],
    fetch: (plan, signal) =>
      new Promise((resolve, reject) => {
        plans.push(plan);
        const path = new URL(plan.url);
        const req = httpRequest(
          `http://127.0.0.1:${address.port}${path.pathname}${path.search}`,
          { signal },
          (res) =>
            resolve({
              status: res.statusCode ?? 0,
              contentLength: res.headers['content-length'],
              body: res,
            }),
        );
        req.on('error', reject);
        req.end();
      }),
  };
  return { io, plans };
}
describe('WeCom actual encrypted byte format', () => {
  it('decrypts an independent OpenSSL vector and supports the protocol 32-byte padding', () => {
    expect(Buffer.from(decryptWecomFile(golden, aesKey))).toEqual(plain);
    expect(
      Buffer.from(decryptWecomFile(golden, aesKey.replace(/=$/, ''))),
    ).toEqual(plain);
    for (const size of [1, 15, 16, 31, 32, 33, 63, 64]) {
      const bytes = Buffer.alloc(size, 77);
      expect(Buffer.from(decryptWecomFile(encrypt(bytes), aesKey))).toEqual(
        bytes,
      );
    }
  });
  it.each([
    Buffer.alloc(32),
    Buffer.alloc(32, 33),
    Buffer.concat([Buffer.alloc(31, 7), Buffer.from([8])]),
  ])('rejects invalid manual padding', (padded) => {
    expect(() => decryptWecomFile(encryptPadded(padded), aesKey)).toThrow(
      'invalid_media',
    );
  });
  it('rejects malformed keys, ciphertext and empty/plain oversize independently of download', () => {
    for (const value of ['', aesKey + 'extra', 'A'.repeat(42) + 'B='])
      expect(() => decryptWecomFile(golden, value)).toThrow('invalid_media');
    for (const bytes of [new Uint8Array(), new Uint8Array(16)])
      expect(() => decryptWecomFile(bytes, aesKey)).toThrow('invalid_media');
    expect(() => decryptWecomFile(golden, aesKey, 24)).toThrow('media_limit');
    expect(() =>
      decryptWecomFile(encrypt(Buffer.alloc(80)), aesKey, 1),
    ).toThrow('media_limit');
    expect(() => decryptWecomFile(encrypt(Buffer.alloc(0)), aesKey)).toThrow(
      'invalid_media',
    );
    expect(() => decryptWecomFile(golden, aesKey, 0)).toThrow('invalid_config');
  });
});
describe('independent URL/DNS and bounded streaming boundaries', () => {
  it.each([
    'http://media.example.invalid/a',
    'https://user:pass@media.example.invalid/a',
    'https://media.example.invalid/a#fragment',
    'https://media.example.invalid.evil.invalid/a',
    'https://media.example.invalid:8443/a',
    'https://127.0.0.1/a',
    'https://2130706433/a',
    'https://media.example.invalid./a',
    'https://media.example.invalid\\@127.0.0.1/a',
    ' https://media.example.invalid/a',
  ])('rejects unsafe URL before any network: %s', async (url) => {
    const resolve = vi.fn();
    const fetch = vi.fn();
    const download = createWecomMediaDownloader(
      { allowedOrigins: [origin] },
      { resolve, fetch },
    );
    await expect(download({ ...media, url })).rejects.toMatchObject({
      kind: 'unsafe_url',
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '169.254.169.254',
    '100.100.100.200',
    '172.31.1.1',
    '192.168.1.1',
    '0.0.0.0',
    '224.1.1.1',
    '198.19.0.1',
    '192.0.2.1',
    '203.0.113.1',
    '::1',
    '::ffff:8.8.8.8',
    'fc00::1',
    'fe80::1',
    '2002:a00:1::',
    '2001:db8::1',
    '2001:0db8::1',
    '2001::1',
    '2001:20::1',
    '64:ff9b::808:808',
    'not-an-ip',
  ])('rejects a nonpublic or reserved address: %s', (address) => {
    expect(isPublicMediaAddress(address)).toBe(false);
  });
  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '2001:4860:4860::8888',
    '2606:4700:4700::1111',
  ])('accepts recognized public address: %s', (address) => {
    expect(isPublicMediaAddress(address)).toBe(true);
  });
  it('checks every DNS answer and pins an immutable approved plan', async () => {
    const fetch = vi.fn();
    for (const addresses of [
      [],
      [{ address: '127.0.0.1', family: 4 }],
      [{ address: '8.8.8.8', family: 6 }],
      [
        { address: '8.8.8.8', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ],
    ]) {
      const download = createWecomMediaDownloader(
        { allowedOrigins: [origin] },
        { resolve: async () => addresses, fetch },
      );
      await expect(download(media)).rejects.toMatchObject({
        kind: 'unsafe_url',
      });
    }
    expect(fetch).not.toHaveBeenCalled();
    const { io, plans } = await local((_req, res) => res.end(golden));
    const result = await createWecomMediaDownloader(
      { allowedOrigins: [origin] },
      io,
    )(media);
    expect(Buffer.from(result.bytes)).toEqual(plain);
    expect(result.sha256).toBe(
      createHash('sha256').update(plain).digest('hex'),
    );
    expect(result.byteLength).toBe(plain.length);
    expect(plans).toEqual([
      {
        url: media.url,
        hostname: 'media.example.invalid',
        address: '8.8.8.8',
        family: 4,
      },
    ]);
    expect(Object.isFrozen(plans[0])).toBe(true);
    expect(Object.keys(result)).toEqual(['bytes', 'byteLength', 'sha256']);
  });
  it('does not follow even a response redirect to a private address', async () => {
    let hits = 0;
    const { io } = await local((_req, res) => {
      hits++;
      res.writeHead(302, { location: 'http://169.254.169.254/metadata' }).end();
    });
    await expect(
      createWecomMediaDownloader({ allowedOrigins: [origin] }, io)(media),
    ).rejects.toMatchObject({ kind: 'download_failed' });
    expect(hits).toBe(1);
  });
  it('enforces actual streamed encrypted bytes without a length header and decrypted size', async () => {
    const encrypted = encrypt(Buffer.alloc(40, 77));
    const { io } = await local((_req, res) => {
      res.write(encrypted.subarray(0, 32));
      res.end(encrypted.subarray(32));
    });
    await expect(
      createWecomMediaDownloader(
        { allowedOrigins: [origin], maxBytes: 1 },
        io,
      )(media),
    ).rejects.toMatchObject({ kind: 'media_limit' });
    const second = await local((_req, res) => res.end(golden));
    await expect(
      createWecomMediaDownloader(
        { allowedOrigins: [origin], maxBytes: 24 },
        second.io,
      )(media),
    ).rejects.toMatchObject({ kind: 'media_limit' });
  });
  it('rejects declared oversize, malformed lengths, truncation and body failures', async () => {
    for (const length of ['9999', '-1', 'NaN', '33']) {
      const body = Readable.from([golden]);
      const download = createWecomMediaDownloader(
        { allowedOrigins: [origin], maxBytes: 64 },
        {
          resolve: async () => [{ address: '8.8.8.8', family: 4 }],
          fetch: async () => ({ status: 200, contentLength: length, body }),
        },
      );
      await expect(download(media)).rejects.toMatchObject({
        kind: length === '9999' ? 'media_limit' : 'download_failed',
      });
      expect(body.destroyed).toBe(true);
    }
    const { io } = await local((_req, res) => {
      res.writeHead(200, {
        'content-length': String(golden.length + 10),
        connection: 'close',
      });
      res.end(golden);
    });
    await expect(
      createWecomMediaDownloader({ allowedOrigins: [origin] }, io)(media),
    ).rejects.toMatchObject({ kind: 'download_failed' });
  });
  it('times out a real stalled stream and honors pre/during-DNS cancellation without unhandled late rejection', async () => {
    const { io } = await local((_req, res) =>
      res.write(golden.subarray(0, 16)),
    );
    await expect(
      createWecomMediaDownloader(
        { allowedOrigins: [origin], timeoutMs: 30 },
        io,
      )(media),
    ).rejects.toMatchObject({ kind: 'timeout' });
    const resolve = vi.fn();
    const download = createWecomMediaDownloader(
      { allowedOrigins: [origin] },
      { resolve },
    );
    await expect(download(media, AbortSignal.abort())).rejects.toMatchObject({
      kind: 'closed',
    });
    expect(resolve).not.toHaveBeenCalled();
    let rejectLate!: (e: Error) => void;
    const waiting = new Promise<never>((_resolve, reject) => {
      rejectLate = reject;
    });
    const controller = new AbortController();
    const delayed = createWecomMediaDownloader(
      { allowedOrigins: [origin] },
      { resolve: () => waiting },
    )(media, controller.signal);
    const expected = expect(delayed).rejects.toMatchObject({ kind: 'closed' });
    controller.abort();
    await expected;
    rejectLate(new Error('synthetic late resolver error'));
    await new Promise((r) => setTimeout(r, 0));
  });
  it('captures configuration and rejects missing origins/bad media/key before DNS', async () => {
    for (const config of [
      { allowedOrigins: [] },
      { allowedOrigins: ['http://127.0.0.1'] },
      { allowedOrigins: [origin], maxBytes: 0 },
    ])
      expect(() => createWecomMediaDownloader(config)).toThrow(
        'invalid_config',
      );
    const resolve = vi.fn();
    const origins = [origin];
    const download = createWecomMediaDownloader(
      { allowedOrigins: origins },
      { resolve },
    );
    origins.push('https://other.example.invalid');
    await expect(
      download({ ...media, url: 'https://other.example.invalid/file' }),
    ).rejects.toMatchObject({ kind: 'unsafe_url' });
    for (const aesKey of ['bad', 'A'.repeat(42) + 'B='])
      await expect(download({ ...media, aesKey })).rejects.toMatchObject({
        kind: 'invalid_media',
      });
    await expect(
      download({ ...media, kind: 'text' } as never),
    ).rejects.toMatchObject({ kind: 'invalid_media' });
    await expect(download(media, {} as AbortSignal)).rejects.toMatchObject({
      kind: 'invalid_config',
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(() => validateMediaURL(media.url, [])).toThrow('unsafe_url');
  });
  it('production HTTPS transport preserves TLS verification, chosen DNS and peer binding', async () => {
    let options: RequestOptions | undefined;
    let peer = '8.8.8.8';
    vi.mocked(httpsRequest).mockImplementation(((...args: unknown[]) => {
      options = args[1] as RequestOptions;
      const callback = args[2] as (response: IncomingMessage) => void;
      const req = Object.assign(new EventEmitter(), {
        end: () =>
          queueMicrotask(() =>
            callback(
              Object.assign(Readable.from([golden]), {
                statusCode: 200,
                headers: { 'content-length': String(golden.length) },
                socket: { remoteAddress: peer },
              }) as unknown as IncomingMessage,
            ),
          ),
      });
      return req as unknown as ClientRequest;
    }) as typeof httpsRequest);
    const download = createWecomMediaDownloader({ allowedOrigins: [origin] });
    expect(Buffer.from((await download(media)).bytes)).toEqual(plain);
    expect(lookup).toHaveBeenCalledWith('media.example.invalid', {
      all: true,
      verbatim: true,
    });
    expect(options).toMatchObject({
      rejectUnauthorized: true,
      agent: false,
      servername: 'media.example.invalid',
      family: 4,
    });
    const callback = vi.fn();
    options!.lookup!('media.example.invalid', { family: 4 }, callback);
    expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4);
    peer = '127.0.0.1';
    await expect(download(media)).rejects.toMatchObject({ kind: 'unsafe_url' });
  });
});
