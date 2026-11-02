import { describe, expect, it, vi } from 'vitest';
import { fixture } from '../../../../../tests/fixtures/upload-fake';
import { createUploadService } from './service';
import { createOriginalReader } from './read';

async function ready() {
  const f = fixture();
  const upload = createUploadService(f.options);
  const grant = await upload.request('account', f.request);
  await f.put(grant.objectKey);
  const result = await upload.complete('account', {
    uploadId: grant.uploadId,
    operationId: 'c',
    receiptRef: 'r',
    expectedRevision: 1,
  });
  const reference = {
    originalVersionId: result.originalVersionId,
    fragmentId: 'real-fragment-from-parser',
  };
  const reader = createOriginalReader(f.options);
  return { ...f, reference, reader, originalId: result.originalId };
}
const ticket = (url: string) =>
  new URL(url, 'https://app.invalid').searchParams.get('ticket')!;
describe('short lived authenticated original proxy', () => {
  it('accepts an authorized original/version identity without inventing a fragment and honors its requested range', async () => {
    const f = await ready();
    const lookup = vi.spyOn(f.options.policy, 'canReadOriginal');
    const identity = {
      originalId: f.originalId,
      originalVersionId: f.reference.originalVersionId,
    };
    const grant = await f.reader.grant('account', {
      ...identity,
      range: { start: 0, endInclusive: 2 },
    });
    expect(f.snapshot().tickets[0]).toMatchObject({
      originalId: f.originalId,
      fragmentId: null,
      requestedRange: { start: 0, endInclusive: 2 },
    });
    const response = await f.reader.open('account', ticket(grant.url));
    expect(response.status).toBe(206);
    expect(await response.text()).toBe('演');
    expect(
      lookup.mock.calls.every(
        (call) => JSON.stringify(call[1]) === JSON.stringify(identity),
      ),
    ).toBe(true);
    await expect(
      f.reader.grant('account', {
        ...identity,
        originalId: 'different-original',
      }),
    ).rejects.toMatchObject({ status: 'not_found' });
  });
  it('refuses anonymous, invalid references and unknown versions', async () => {
    const f = await ready();
    await expect(f.reader.grant(null, f.reference)).rejects.toMatchObject({
      status: 'unauthenticated',
    });
    await expect(
      f.reader.grant('account', { ...f.reference, objectKey: 'hidden' }),
    ).rejects.toMatchObject({ status: 'validation_error' });
    await expect(
      f.reader.grant('account', {
        ...f.reference,
        originalVersionId: 'missing',
      }),
    ).rejects.toMatchObject({ status: 'not_found' });
  });
  it('stores only ticket digest; gives no provider key, URL or reusable bearer', async () => {
    const f = await ready();
    const g = await f.reader.grant('account', f.reference);
    expect(g.url).toMatch(
      /^\/api\/uploads\/original\?ticket=[A-Za-z0-9_-]{43}$/,
    );
    expect(JSON.stringify(g)).not.toContain(f.snapshot().objects[0].objectKey);
    expect(f.snapshot().tickets[0].digest).not.toBe(ticket(g.url));
    expect(Date.parse(g.expiresAt) - f.now()).toBe(60000);
    await expect(f.reader.open(null, ticket(g.url))).rejects.toMatchObject({
      status: 'unauthenticated',
    });
    await expect(f.reader.open('other', ticket(g.url))).rejects.toMatchObject({
      status: 'not_found',
    });
    await expect(
      f.reader.open('account', 'x'.repeat(43)),
    ).rejects.toMatchObject({ status: 'not_found' });
  });
  it('plays exact fake bytes from a source reference and supports a single closed range', async () => {
    const f = await ready();
    const g = await f.reader.grant('account', f.reference);
    const response = await f.reader.open('account', ticket(g.url));
    expect(await response.text()).toBe('演示x');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const ranged = await f.reader.open('account', ticket(g.url), 'bytes=0-2');
    expect(ranged.status).toBe(206);
    expect(await ranged.text()).toBe('演');
    expect(ranged.headers.get('content-range')).toBe('bytes 0-2/7');
  });
  it('rejects expired and revoked access, including range requests', async () => {
    const f = await ready();
    const g = await f.reader.grant('account', f.reference);
    f.deny();
    await expect(
      f.reader.open('account', ticket(g.url), 'bytes=0-2'),
    ).rejects.toMatchObject({ status: 'not_found' });
    f.allow();
    f.advance(60000);
    await expect(f.reader.open('account', ticket(g.url))).rejects.toMatchObject(
      { status: 'not_found' },
    );
  });
  it.each([
    'bytes=0-1,3-4',
    'bytes=-2',
    'bytes=9-2',
    'bytes=9007199254740992-',
  ])('rejects invalid range %s', async (range) => {
    const f = await ready();
    const g = await f.reader.grant('account', f.reference);
    await expect(
      f.reader.open('account', ticket(g.url), range),
    ).rejects.toMatchObject({ status: 'validation_error' });
  });
  it('rechecks visibility after storage I/O and cancels the unused stream', async () => {
    const f = await ready();
    const g = await f.reader.grant('account', f.reference);
    const original = f.options.storage.openObject;
    const cancel = vi.fn();
    const close = vi.fn();
    vi.spyOn(f.options.storage, 'openObject').mockImplementation(
      async (input) => {
        const opened = await original(input);
        f.deny();
        return {
          ...opened,
          close,
          body: new ReadableStream<Uint8Array>({ cancel }),
        };
      },
    );
    await expect(f.reader.open('account', ticket(g.url))).rejects.toMatchObject(
      { status: 'not_found' },
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});

it.each(['mime', 'length', 'range_total', 'status'])(
  'rejects GET metadata %s that disagrees with the archived object',
  async (kind) => {
    const f = await ready();
    const grant = await f.reader.grant('account', f.reference);
    const original = f.options.storage.openObject;
    const close = vi.fn();
    vi.spyOn(f.options.storage, 'openObject').mockImplementation(
      async (input) => {
        const opened = await original(input);
        if (kind === 'mime') opened.headers['content-type'] = 'text/html';
        if (kind === 'length') opened.headers['content-length'] = '3';
        if (kind === 'range_total')
          opened.headers['content-range'] = 'bytes 0-2/9';
        return {
          ...opened,
          status: kind === 'status' ? (206 as const) : opened.status,
          close,
        };
      },
    );
    await expect(
      f.reader.open(
        'account',
        ticket(grant.url),
        kind === 'range_total' ? 'bytes=0-2' : undefined,
      ),
    ).rejects.toMatchObject({
      status: 'unavailable',
      reason: 'original_integrity',
    });
    expect(close).toHaveBeenCalledOnce();
  },
);
it.each([3, 8])(
  'errors the response stream when its actual %s bytes differ from the archived seven bytes',
  async (size) => {
    const f = await ready();
    const grant = await f.reader.grant('account', f.reference);
    const open = f.options.storage.openObject;
    const close = vi.fn();
    vi.spyOn(f.options.storage, 'openObject').mockImplementation(
      async (input) => ({
        ...(await open(input)),
        close,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(size));
            controller.close();
          },
        }),
      }),
    );
    const response = await f.reader.open('account', ticket(grant.url));
    await expect(response.arrayBuffer()).rejects.toThrow();
    expect(close).toHaveBeenCalledOnce();
  },
);
it('returns only application-controlled headers rather than storage cookies or redirect hints', async () => {
  const f = await ready();
  const grant = await f.reader.grant('account', f.reference);
  const open = f.options.storage.openObject;
  vi.spyOn(f.options.storage, 'openObject').mockImplementation(
    async (input) => {
      const result = await open(input);
      result.headers['set-cookie'] = 'unrelated-storage-cookie=1';
      result.headers.location = 'https://unrelated.invalid';
      return result;
    },
  );
  const response = await f.reader.open('account', ticket(grant.url));
  expect(response.headers.has('set-cookie')).toBe(false);
  expect(response.headers.has('location')).toBe(false);
  expect(await response.text()).toBe('演示x');
});
