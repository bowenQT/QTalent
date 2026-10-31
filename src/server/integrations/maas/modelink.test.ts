import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createFakeModelinkMaas,
  createModelinkMaasClient,
  createModelinkMaasClientFromEnv,
  MODELINK_ENDPOINT,
  MODELINK_MODEL,
  type ModelinkStructuredInput,
} from './modelink';
import { MaasRequestNotSentError } from './client';

const schema = z
  .object({ status: z.enum(['supported', 'insufficient']) })
  .strict();
const input: ModelinkStructuredInput<z.infer<typeof schema>> = {
  messages: [
    { role: 'user', content: '演示：只返回 JSON，不形成正式人才结论。' },
  ],
  promptVersion: 'modelink-demo-v1',
  schema,
};
const image = 'data:image/png;base64,iVBORw0KGgo=';
const imageInput: typeof input = {
  ...input,
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: '演示：从图片返回 JSON。' },
        { type: 'image_url', image_url: { url: image, detail: 'high' } },
      ],
    },
  ],
};
const envelope = (
  content = '{"status":"supported"}',
  model: string = MODELINK_MODEL,
) => ({
  id: 'chatcmpl-demo-843',
  model,
  choices: [
    {
      message: {
        role: 'assistant',
        content,
        reasoning_content: 'private reasoning',
      },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
});
const response = (body: unknown = envelope(), headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { headers });
const config = { apiKey: 'dummy-modelink-test-key' };
const setup = (
  fetcher = vi.fn<typeof fetch>().mockResolvedValue(response()),
) => ({
  fetcher,
  client: createModelinkMaasClient(config, { fetch: fetcher }),
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Modelink structured text and image boundary', () => {
  it.each([input, imageInput])(
    'uses the exact fixed protocol without construction requests',
    async (request) => {
      const { client, fetcher } = setup();
      expect(fetcher).not.toHaveBeenCalled();
      const result = await client.generateStructured(request);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][0]).toBe(MODELINK_ENDPOINT);
      expect(fetcher.mock.calls[0][1]).toMatchObject({
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: 'Bearer dummy-modelink-test-key',
          'Content-Type': 'application/json',
        },
      });
      expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
        model: 'google/gemini-3.8-flash',
        messages: request.messages,
        response_format: { type: 'json_object' },
        stream: false,
        max_tokens: 4096,
      });
      expect(result).toMatchObject({
        ok: true,
        value: { status: 'supported' },
        metadata: {
          model: MODELINK_MODEL,
          promptVersion: 'modelink-demo-v1',
          attempts: 1,
          requestId: 'chatcmpl-demo-843',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      });
      expect(JSON.stringify(result)).not.toContain('private reasoning');
      expect(JSON.stringify(result)).not.toContain(config.apiKey);
    },
  );

  it.each([
    {},
    { apiKey: '' },
    { apiKey: 'bad\nkey' },
    { ...config, model: 'gemini-3.8-flash' },
    { ...config, endpoint: 'https://api.qnaigc.com/v1/chat/completions' },
    { ...config, maxAttempts: 3 },
    { ...config, attemptTimeoutMs: 30001 },
  ])('rejects configuration before sending %j', async (configuration) => {
    const fetcher = vi.fn<typeof fetch>();
    expect(
      await createModelinkMaasClient(configuration, {
        fetch: fetcher,
      }).generateStructured(input),
    ).toMatchObject({
      ok: false,
      kind: 'configuration',
      metadata: { attempts: 0, model: MODELINK_MODEL },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { ...input, messages: [] },
    { ...input, messages: undefined },
    { ...input, messages: null },
    { ...input, promptVersion: '' },
    { ...input, messages: [{ role: 'user', content: 'No output format' }] },
    {
      ...input,
      messages: [{ role: 'user', content: [{ type: 'text', text: ' ' }] }],
    },
    {
      ...input,
      messages: [
        { role: 'user', content: 'JSON', hidden: 'unfiltered evidence' },
      ],
    },
    {
      ...input,
      messages: [{ role: 'system', content: imageInput.messages[0].content }],
    },
    {
      ...input,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'JSON' },
            {
              type: 'image_url',
              image_url: { url: 'https://private.test/raw?token=secret' },
            },
          ],
        },
      ],
    },
    {
      ...input,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'JSON' },
            {
              type: 'image_url',
              image_url: { url: 'data:image/svg+xml;base64,PHN2Zy8+' },
            },
          ],
        },
      ],
    },
    {
      ...input,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'JSON' },
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,!!!!' },
            },
          ],
        },
      ],
    },
    {
      ...input,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'JSON' },
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,abc' },
            },
          ],
        },
      ],
    },
    {
      ...input,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'JSON' },
            {
              type: 'image_url',
              image_url: { url: image, extra: 'unfiltered' },
            },
          ],
        },
      ],
    },
    { ...input, schema: z.record(z.string(), z.unknown()) },
  ])('rejects malformed or unbounded input locally', async (request) => {
    const { client, fetcher } = setup();
    const result = await client.generateStructured(request as typeof input);
    expect(result).toMatchObject({ ok: false, kind: 'invalid_request' });
    expect(result).not.toHaveProperty('value');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('bounds text, individual image bytes, image count and complete payload', async () => {
    const { client, fetcher } = setup();
    const part = { type: 'image_url' as const, image_url: { url: image } };
    for (const messages of [
      [{ role: 'user' as const, content: 'JSON' + '字'.repeat(90000) }],
      [
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: 'JSON' },
            {
              ...part,
              image_url: {
                url:
                  'data:image/png;base64,' +
                  Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64'),
              },
            },
          ],
        },
      ],
      [
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: 'JSON' },
            ...Array.from({ length: 11 }, () => part),
          ],
        },
      ],
      [
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: 'JSON' },
            ...Array.from({ length: 3 }, () => ({
              ...part,
              image_url: {
                url:
                  'data:image/jpeg;base64,' +
                  Buffer.alloc(3 * 1024 * 1024).toString('base64'),
              },
            })),
          ],
        },
      ],
    ]) {
      expect(
        await client.generateStructured({ ...input, messages }),
      ).toMatchObject({ kind: 'invalid_request' });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('counts original whitespace bytes toward the text limit before sending', async () => {
    const { client, fetcher } = setup();
    const result = await client.generateStructured({
      ...input,
      messages: [{ role: 'user', content: ' '.repeat(262144) + 'JSON' }],
    });
    expect(result).toMatchObject({ ok: false, kind: 'invalid_request' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    envelope(''),
    envelope('```json\n{"status":"supported"}\n```'),
    envelope('null'),
    envelope('{}'),
    envelope('{"status":"invented"}'),
    envelope('{"status":1}'),
    envelope('{"status":"supported","extra":1}'),
    envelope('{"status":"supported"}', 'gemini-3.8-flash'),
    { ...envelope(), choices: [] },
    {
      ...envelope(),
      choices: [{ ...envelope().choices[0], finish_reason: 'length' }],
    },
    {
      ...envelope(),
      choices: [{ ...envelope().choices[0], finish_reason: 'content_filter' }],
    },
  ])('never produces a success value for invalid output', async (body) => {
    const { client, fetcher } = setup(
      vi.fn<typeof fetch>().mockResolvedValue(response(body)),
    );
    const result = await client.generateStructured(imageInput);
    expect(result).toMatchObject({
      ok: false,
      kind: 'invalid_response',
      retryable: false,
    });
    expect(result).not.toHaveProperty('value');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('preserves a safe gateway request ID for malformed or failed responses', async () => {
    for (const reply of [
      new Response('private invalid response', {
        headers: { http_x_reqid: 'chatcmpl-gateway-843' },
      }),
      new Response('private error', {
        status: 503,
        headers: { http_x_reqid: 'chatcmpl-gateway-843' },
      }),
    ]) {
      const { client } = setup(vi.fn<typeof fetch>().mockResolvedValue(reply));
      const result = await client.generateStructured(input);
      expect(result).toMatchObject({
        ok: false,
        metadata: { requestId: 'chatcmpl-gateway-843' },
      });
      expect(result).not.toHaveProperty('value');
      expect(JSON.stringify(result)).not.toContain('private');
    }
  });

  it('does not pass arbitrary gateway IDs through the metadata', async () => {
    const { client } = setup(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          response(
            { ...envelope(), id: 'private value' },
            { http_x_reqid: 'untrusted secret' },
          ),
        ),
    );
    expect(
      (await client.generateStructured(input)).metadata,
    ).not.toHaveProperty('requestId');
  });
});

describe('Modelink failure and cancellation semantics', () => {
  it.each([
    [401, 'authentication'],
    [403, 'permission'],
    [422, 'invalid_request'],
    [429, 'outcome_unknown'],
    [503, 'outcome_unknown'],
  ])('does not auto-replay HTTP %s', async (status, kind) => {
    const { client, fetcher } = setup(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response('secret body', { status: Number(status) }),
        ),
    );
    const result = await client.generateStructured(imageInput);
    expect(result).toMatchObject({ ok: false, kind, status, retryable: false });
    expect(result).not.toHaveProperty('value');
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('only retries a transport-proven pre-send failure', async () => {
    vi.useFakeTimers();
    const { client, fetcher } = setup(
      vi
        .fn<typeof fetch>()
        .mockRejectedValueOnce(new MaasRequestNotSentError())
        .mockResolvedValueOnce(response()),
    );
    const result = client.generateStructured(input);
    await vi.advanceTimersByTimeAsync(250);
    expect(await result).toMatchObject({
      ok: true,
      metadata: { model: MODELINK_MODEL, attempts: 2 },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('discards late results after timeout and cancels the late body', async () => {
    vi.useFakeTimers();
    let finish!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = createModelinkMaasClient(
      { ...config, attemptTimeoutMs: 20 },
      { fetch: fetcher },
    ).generateStructured(imageInput);
    await vi.advanceTimersByTimeAsync(20);
    const result = await pending;
    expect(result).toMatchObject({
      ok: false,
      kind: 'outcome_unknown',
      reason: 'timeout',
      retryable: false,
    });
    expect(result).not.toHaveProperty('value');
    const cancel = vi.fn();
    finish(new Response(new ReadableStream({ cancel })));
    await vi.runAllTimersAsync();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('bounds response reading and classifies a mid-body disconnect as unknown', async () => {
    const { client, fetcher } = setup(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TypeError('secret disconnect'));
            },
          }),
        ),
      ),
    );
    const result = await client.generateStructured(input);
    expect(result).toMatchObject({
      kind: 'outcome_unknown',
      reason: 'network',
      retryable: false,
    });
    expect(result).not.toHaveProperty('value');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const oversized = createModelinkMaasClient(
      { ...config, maxResponseBytes: 10 },
      { fetch: vi.fn<typeof fetch>().mockResolvedValue(response()) },
    );
    expect(await oversized.generateStructured(input)).toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('applies timeout to a stalled response body', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{'));
          },
          cancel,
        }),
      ),
    );
    const pending = createModelinkMaasClient(
      { ...config, attemptTimeoutMs: 20 },
      { fetch: fetcher },
    ).generateStructured(input);
    await vi.advanceTimersByTimeAsync(20);
    expect(await pending).toMatchObject({
      kind: 'outcome_unknown',
      reason: 'timeout',
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('distinguishes cancellation before and after dispatch', async () => {
    const controller = new AbortController();
    controller.abort();
    const { client, fetcher } = setup();
    expect(
      await client.generateStructured({ ...input, signal: controller.signal }),
    ).toMatchObject({ kind: 'cancelled', metadata: { attempts: 0 } });
    expect(fetcher).not.toHaveBeenCalled();
    const inFlight = new AbortController();
    const sent = setup(
      vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {})),
    );
    const result = sent.client.generateStructured({
      ...input,
      signal: inFlight.signal,
    });
    inFlight.abort();
    expect(await result).toMatchObject({
      kind: 'outcome_unknown',
      reason: 'cancelled',
      retryable: false,
    });
    expect(sent.fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects success if the validator cancels or throws', async () => {
    const controller = new AbortController();
    const { client } = setup();
    const cancelling = schema.superRefine(() => controller.abort());
    expect(
      await client.generateStructured({
        ...input,
        schema: cancelling,
        signal: controller.signal,
      }),
    ).toMatchObject({ kind: 'outcome_unknown', reason: 'cancelled' });
    const throwing = schema.superRefine(() => {
      throw new Error('private evidence');
    });
    const result = await setup().client.generateStructured({
      ...input,
      schema: throwing,
    });
    expect(result).toMatchObject({ kind: 'invalid_response' });
    expect(JSON.stringify(result)).not.toContain('private evidence');
  });
});

describe('explicit environment construction and offline fake', () => {
  it('maps only Modelink environment names without contacting the provider', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response());
    const client = createModelinkMaasClientFromEnv(
      {
        MODELINK_API_KEY: config.apiKey,
        MODELINK_BASE_URL: 'https://api.modelink.ai/v1',
        MODELINK_MODEL,
      },
      { fetch: fetcher },
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(await client.generateStructured(input)).toMatchObject({ ok: true });
  });

  it.each([
    {},
    { MODELINK_API_KEY: ' ' },
    {
      MODELINK_API_KEY: config.apiKey,
      MODELINK_BASE_URL: 'https://other.test/v1',
    },
    { MODELINK_API_KEY: config.apiKey, MODELINK_MODEL: 'other' },
    { QINIU_MAAS_API_KEY: config.apiKey },
  ])(
    'does not silently reuse another provider or config',
    async (environment) => {
      const fetcher = vi.fn<typeof fetch>();
      expect(
        await createModelinkMaasClientFromEnv(environment, {
          fetch: fetcher,
        }).generateStructured(input),
      ).toMatchObject({ kind: 'configuration' });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it('uses process environment and global fetch only on explicit invocation', async () => {
    vi.stubEnv('MODELINK_API_KEY', config.apiKey);
    vi.stubEnv('MODELINK_BASE_URL', 'https://api.modelink.ai/v1');
    vi.stubEnv('MODELINK_MODEL', MODELINK_MODEL);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetcher);
    try {
      const client = createModelinkMaasClientFromEnv();
      expect(fetcher).not.toHaveBeenCalled();
      expect(await client.generateStructured(input)).toMatchObject({
        ok: true,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('validates fake text and image outputs with no global network', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const fake = createFakeModelinkMaas({ status: 'supported' });
    for (const request of [input, imageInput])
      expect(await fake.generateStructured(request)).toMatchObject({
        ok: true,
        value: { status: 'supported' },
        metadata: { model: MODELINK_MODEL, attempts: 0 },
      });
    expect(
      await createFakeModelinkMaas({ status: 'invented' }).generateStructured(
        input,
      ),
    ).toMatchObject({ kind: 'invalid_response' });
    expect(
      await fake.generateStructured({ ...input, messages: [] }),
    ).toMatchObject({ kind: 'invalid_request' });
    const signal = AbortSignal.abort();
    expect(await fake.generateStructured({ ...input, signal })).toMatchObject({
      kind: 'cancelled',
    });
    const controller = new AbortController();
    expect(
      await fake.generateStructured({
        ...input,
        signal: controller.signal,
        schema: schema.superRefine(() => controller.abort()),
      }),
    ).toMatchObject({ kind: 'cancelled' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
