import { describe, expect, it, vi } from 'vitest';
import { createKodoClient, KodoError } from './index';

const config = {
  endpoint: 'https://demo-bucket.s3.cn-east-1.qiniucs.com',
  uploadEndpoint: 'https://up.example.test',
  managementEndpoint: 'https://rs.example.test',
  accessKey: 'synthetic-ak',
  secretKey: 'synthetic-secret',
  bucket: 'demo-bucket',
};
const xml = (code: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>synthetic detail</Message><Resource>/demo/key</Resource><RequestId>demo</RequestId></Error>`;

describe('S3 private GET error classification', () => {
  // Only Code/status are known from the reviewed live evidence in #48/6554197593.
  // This envelope and every other field are synthetic, never a raw provider response.
  it.each([
    ['ExpiredToken', 'expired'],
    ['NotSupportAnonymous', 'unauthorized'],
  ])(
    'maps the observed HTTP400 %s without exposing its body',
    async (providerCode, code) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response(xml(providerCode), { status: 400 }));
      const client = createKodoClient(config, { fetch });
      const error = await client
        .openObject({ objectKey: 'demo/key' })
        .catch((error: unknown) => error);
      expect(error).toBeInstanceOf(KodoError);
      expect(error).toMatchObject({
        code,
        status: 400,
        message: `Kodo ${code}`,
      });
      expect(fetch).toHaveBeenCalledOnce();
      expect(error).not.toHaveProperty('cause');
      expect(error).not.toHaveProperty('s3Code');
      expect(JSON.stringify(error)).not.toContain('synthetic detail');
      expect(JSON.stringify(error)).not.toContain(providerCode);
    },
  );
});

async function failure(response: Response): Promise<KodoError> {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
  const error = await createKodoClient(config, { fetch })
    .openObject({ objectKey: 'demo/key' })
    .catch((error: unknown) => error);
  expect(error).toBeInstanceOf(KodoError);
  expect(fetch).toHaveBeenCalledOnce();
  expect(response.body?.locked ?? false).toBe(false);
  return error as KodoError;
}

describe('untrusted S3 error envelope', () => {
  it.each([
    xml('InvalidArgument'),
    xml('FutureProviderCode'),
    '<Error><Message>ExpiredToken NotSupportAnonymous</Message></Error>',
    '<Error><Code>InvalidArgument</Code><Message>ExpiredToken</Message></Error>',
    '<Error><Code>ExpiredToken</Code>',
    '<Other><Code>ExpiredToken</Code></Other>',
    '<Error><Code>ExpiredToken</Code><Code>ExpiredToken</Code></Error>',
    '<Error><Code>ExpiredToken</Code><Message>one</Message><Message>two</Message></Error>',
    '<Error><Details><Code>ExpiredToken</Code></Details></Error>',
    '<Error><!--<Code>ExpiredToken</Code>--></Error>',
    '<Error><Message><![CDATA[<Code>ExpiredToken</Code>]]></Message></Error>',
    '<Error><Code>ExpiredToken</Code></Error>trailing',
    '<Error><Code>ExpiredToken</Code><Message>&unknown;</Message></Error>',
    '<Error><Code>ExpiredToken</Code><Message>&#0;</Message></Error>',
    '<Error><Code>ExpiredToken</Code><Message>&#xD800;</Message></Error>',
    '<Error><Code>ExpiredToken</Code><Message>&#1114112;</Message></Error>',
    '<Error><Code>ExpiredToken</Code><Message>\u0001</Message></Error>',
    '<Error><Code>ExpiredToken</Code><Message>]]></Message></Error>',
    '<Error><Code>ExpiredToken</Code><Message>\uFFFF</Message></Error>',
    '<Error><Code>ExpiredTok&#101;n</Code></Error>',
    '<Error><Code>expiredtoken</Code></Error>',
    '<?xml version="2.0"?><Error><Code>ExpiredToken</Code></Error>',
    ' <?xml version="1.0"?><Error><Code>ExpiredToken</Code></Error>',
    '<!DOCTYPE Error [<!ENTITY ext SYSTEM "https://never-fetch.test/">]><Error><Code>ExpiredToken</Code></Error>',
    '<Error><Code>ExpiredToken</Code>unparsed</Error>',
    '<Error><Code>ExpiredToken</Code><Message>unclosed</Error>',
    '<Error><Code/></Error>',
    '',
    JSON.stringify({ Code: 'ExpiredToken' }),
  ])(
    'keeps the original HTTP400 classification for unsupported/invalid XML %#',
    async (body) => {
      expect(await failure(new Response(body, { status: 400 }))).toMatchObject({
        code: 'invalid_input',
        status: 400,
      });
    },
  );

  it('accepts only an unambiguous scalar Code, including normal XML escapes in ignored fields', async () => {
    const body = `<?xml version='1.0' encoding='UTF-8'?>\n<Error xmlns="http://s3.amazonaws.com/doc/2006-03-01/">\n<Code> ExpiredToken </Code><Message>&lt;&gt;&amp;&quot;&apos;&#9;&#10;&#13;&#32;&#xE000;&#65533;&#x10000;</Message><RequestId/><Resource>synthetic</Resource>\n</Error>`;
    expect(await failure(new Response(body, { status: 400 }))).toMatchObject({
      code: 'expired',
      status: 400,
    });
  });

  it('rejects invalid UTF-8 and an absent body without exposing provider data', async () => {
    for (const body of [new Uint8Array([0xc3, 0x28]), null])
      expect(await failure(new Response(body, { status: 400 }))).toMatchObject({
        code: 'invalid_input',
        status: 400,
      });
  });

  it('only buffers a complete error document up to 8KiB, never a trusted prefix', async () => {
    const base = '<Error><Code>ExpiredToken</Code><Message></Message></Error>';
    const exact = base.replace(
      '<Message>',
      '<Message>' + 'x'.repeat(8192 - Buffer.byteLength(base)),
    );
    expect(Buffer.byteLength(exact)).toBe(8192);
    expect(await failure(new Response(exact, { status: 400 }))).toMatchObject({
      code: 'expired',
    });
    expect(
      await failure(new Response(exact + ' ', { status: 400 })),
    ).toMatchObject({ code: 'invalid_input' });
    expect(
      await failure(
        new Response(xml('ExpiredToken'), {
          status: 400,
          headers: { 'content-length': '8193' },
        }),
      ),
    ).toMatchObject({ code: 'invalid_input' });
    expect(
      await failure(
        new Response(exact + ' ', {
          status: 400,
          headers: { 'content-length': '1' },
        }),
      ),
    ).toMatchObject({ code: 'invalid_input' });
  });

  it('cancels an over-limit stream without retaining cancellation exceptions', async () => {
    const cancel = vi.fn(() => {
      throw new Error('SYNTHETIC_CANCEL_SECRET');
    });
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(xml('ExpiredToken') + 'x'.repeat(8193)),
          );
        },
        cancel,
      }),
      { status: 400 },
    );
    const error = await failure(response);
    expect(error).toMatchObject({ code: 'invalid_input', status: 400 });
    expect(cancel).toHaveBeenCalledOnce();
    expect(JSON.stringify(error)).not.toContain('SYNTHETIC_CANCEL_SECRET');
  });

  it('treats an unreadable or already locked body as its original HTTP error', async () => {
    const broken = new Response(
      new ReadableStream({
        start(c) {
          c.error(new Error('SYNTHETIC_READ_SECRET'));
        },
      }),
      { status: 400 },
    );
    expect(await failure(broken)).toMatchObject({ code: 'invalid_input' });
    const locked = new Response(xml('ExpiredToken'), { status: 400 });
    const reader = locked.body!.getReader();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(locked);
    await expect(
      createKodoClient(config, { fetch }).read('demo'),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    reader.releaseLock();
  });

  it('never exposes Message, Resource, signatures, XML or causes in errors', async () => {
    const marker = 'SYNTHETIC_MESSAGE_KEY_SIGNATURE';
    const body = `<Error><Code>NotSupportAnonymous</Code><Message>https://never-fetch.test/${marker}?X-Amz-Signature=fake&amp;token=fake</Message><Resource>${marker}</Resource></Error>`;
    const error = await failure(new Response(body, { status: 400 }));
    expect(error).toMatchObject({
      code: 'unauthorized',
      status: 400,
      message: 'Kodo unauthorized',
    });
    expect(Object.keys(error).sort()).toEqual(['code', 'name', 'status']);
    expect(error.stack + JSON.stringify(error)).not.toMatch(
      /SYNTHETIC_MESSAGE|X-Amz|never-fetch|<Error>|NotSupportAnonymous/,
    );
    expect(error).not.toHaveProperty('cause');
  });
});

describe('S3 error body lifetime and protocol isolation', () => {
  it('preserves cancellation while reading a pending error body, and cancels that body', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
      status: 400,
    });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    const controller = new AbortController();
    const operation = createKodoClient(config, { fetch }).openObject({
      objectKey: 'demo',
      signal: controller.signal,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(response.body?.locked).toBe(true);
    controller.abort();
    await expect(operation).rejects.toMatchObject({ code: 'cancelled' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });

  it('cancels an error body even when the caller was already aborted at headers', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
      status: 400,
    });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    await expect(
      createKodoClient(config, { fetch }).openObject({
        objectKey: 'demo',
        signal: AbortSignal.abort(),
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });

  it('does not stall on a broken pending cancel hook after an over-limit body', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(8193));
        },
        cancel,
      }),
      { status: 400 },
    );
    expect(await failure(response)).toMatchObject({ code: 'invalid_input' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('bounds a stalled error body by the existing request timeout and cancels its stream', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
      status: 400,
    });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    await expect(
      createKodoClient(config, { fetch, timeoutMs: 5 }).read('demo'),
    ).rejects.toMatchObject({ code: 'timeout' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [404, 'not_found'],
    [416, 'invalid_range'],
    [429, 'rate_limited'],
    [503, 'unavailable'],
  ])('leaves non400 HTTP%s on its original mapping', async (status, code) => {
    expect(
      await failure(
        new Response(xml('ExpiredToken'), { status: Number(status) }),
      ),
    ).toMatchObject({ code, status });
  });

  it('does not reinterpret native management or upload errors as S3 errors', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(xml('ExpiredToken'), { status: 400 }),
      );
    const client = createKodoClient(config, { fetch });
    await expect(
      client.statObject({ objectKey: 'demo' }),
    ).rejects.toMatchObject({ code: 'invalid_input', status: 400 });
    fetch
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(
        new Response(xml('NotSupportAnonymous'), { status: 400 }),
      );
    await expect(
      client.writeSegment({
        objectKey: 'demo',
        bytes: new Uint8Array([1, 2, 3]),
      }),
    ).rejects.toMatchObject({ code: 'invalid_input', status: 400 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('keeps a successful GET as data even when its contents resemble an error', async () => {
    const body = xml('ExpiredToken');
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(body, {
        headers: {
          'content-length': String(Buffer.byteLength(body)),
          'content-type': 'application/xml',
        },
      }),
    );
    expect(
      new TextDecoder().decode(
        await createKodoClient(config, { fetch }).read('demo'),
      ),
    ).toBe(body);
  });
});
