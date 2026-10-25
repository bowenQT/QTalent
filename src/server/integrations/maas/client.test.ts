import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createFakeMaas,
  createMaasClient,
  MAAS_MODEL,
  MaasRequestNotSentError,
  type StructuredMaasInput,
} from './index';

const schema = z
  .object({ status: z.enum(['supported', 'insufficient']) })
  .strict();
const input: StructuredMaasInput<z.infer<typeof schema>> = {
  messages: [
    { role: 'user', content: 'Return JSON for synthetic demo evidence.' },
  ],
  promptVersion: 'demo-v1',
  schema,
};
const config = { apiKey: 'dummy-test-only' };
const envelope = (content = '{"status":"supported"}', finish = 'stop') => ({
  id: 'request-123',
  model: MAAS_MODEL,
  choices: [{ message: { role: 'assistant', content }, finish_reason: finish }],
  usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
});
const response = (body: unknown = envelope()) =>
  new Response(JSON.stringify(body));
const clientWith = (
  fetcher = vi.fn<typeof fetch>().mockResolvedValue(response()),
) => ({
  fetcher,
  client: createMaasClient(config, { fetch: fetcher }),
});
afterEach(() => vi.useRealTimers());

describe('structured MaaS boundary', () => {
  it('does not contact the provider at construction, and sends only the exact protocol', async () => {
    const { client, fetcher } = clientWith();
    expect(fetcher).not.toHaveBeenCalled();
    const result = await client.generateStructured(input);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.qnaigc.com/v1/chat/completions');
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: 'Bearer dummy-test-only',
        'Content-Type': 'application/json',
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: MAAS_MODEL,
      messages: input.messages,
      response_format: { type: 'json_object' },
      stream: false,
      max_tokens: 4096,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { status: 'supported' },
      metadata: {
        model: MAAS_MODEL,
        promptVersion: 'demo-v1',
        attempts: 1,
        requestId: 'request-123',
        usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
      },
    });
  });

  it.each([
    {},
    { apiKey: '' },
    { apiKey: 'bad\nkey' },
    { ...config, model: 'other' },
    { ...config, endpoint: 'https://other.test/v1' },
    { ...config, attemptTimeoutMs: 0 },
    { ...config, maxAttempts: 3 },
    { ...config, totalTimeoutMs: Infinity },
  ])('rejects invalid configuration without dispatch: %j', async (invalid) => {
    const fetcher = vi.fn<typeof fetch>();
    const result = await createMaasClient(invalid, {
      fetch: fetcher,
    }).generateStructured(input);
    expect(result).toMatchObject({
      ok: false,
      kind: 'configuration',
      retryable: false,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { ...input, messages: [] },
    { ...input, promptVersion: '' },
    { ...input, messages: [{ role: 'user', content: 'no format requested' }] },
    {
      ...input,
      messages: [{ role: 'user', content: 'JSON', extra: 'hidden evidence' }],
    },
    {
      ...input,
      messages: [{ role: 'user', content: 'JSON' + 'x'.repeat(262144) }],
    },
  ])('rejects invalid requests locally', async (invalid) => {
    const { client, fetcher } = clientWith();
    const result = await client.generateStructured(invalid as typeof input);
    expect(result).toMatchObject({
      ok: false,
      kind: 'invalid_request',
      retryable: false,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    envelope(''),
    envelope('not json'),
    envelope('null'),
    envelope('{"status":"invented"}'),
    envelope('{}'),
    envelope('{"status":1}'),
    envelope('{"status":"supported"}', 'length'),
    envelope('{"status":"supported"}', 'content_filter'),
    { choices: [] },
    { ...envelope(), model: 'substituted-model' },
    { ...envelope(), choices: [envelope().choices[0], envelope().choices[0]] },
  ])(
    'rejects invalid/truncated/schema-breaking output without a success value',
    async (body) => {
      const { client, fetcher } = clientWith(
        vi.fn<typeof fetch>().mockResolvedValue(response(body)),
      );
      const result = await client.generateStructured(input);
      expect(result).toMatchObject({
        ok: false,
        kind: 'invalid_response',
        retryable: false,
      });
      expect(result).not.toHaveProperty('value');
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects non-JSON HTTP bodies', async () => {
    const { client } = clientWith(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('<html>error</html>')),
    );
    expect(await client.generateStructured(input)).toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('caps the actual response bytes rather than trusting Content-Length', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('x'.repeat(1025), { headers: { 'Content-Length': '1' } }),
      );
    const result = await createMaasClient(
      { ...config, maxResponseBytes: 1024 },
      { fetch: fetcher },
    ).generateStructured(input);
    expect(result).toMatchObject({
      kind: 'invalid_response',
      retryable: false,
    });
  });

  it.each([
    [400, 'invalid_request'],
    [401, 'authentication'],
    [403, 'permission'],
    [404, 'invalid_request'],
    [429, 'outcome_unknown'],
    [500, 'outcome_unknown'],
    [503, 'outcome_unknown'],
    [302, 'outcome_unknown'],
  ])(
    'maps status %s without inferring non-execution or retrying',
    async (status, kind) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response('secret provider payload', {
          status: Number(status),
          headers: { 'Retry-After': '1' },
        }),
      );
      const result = await createMaasClient(config, {
        fetch: fetcher,
      }).generateStructured(input);
      expect(result).toMatchObject({
        ok: false,
        kind,
        retryable: false,
        status,
      });
      expect(JSON.stringify(result)).not.toContain('secret');
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it('does not expose provider reasoning, unknown usage fields or unsafe identifiers', async () => {
    const body = {
      ...envelope(),
      id: 'secret payload !',
      reasoning_content: 'sensitive',
      usage: { ...envelope().usage, secret: 'sensitive' },
    };
    body.choices[0].message = {
      ...body.choices[0].message,
      reasoning_content: 'sensitive',
    } as (typeof body.choices)[0]['message'];
    const { client } = clientWith(
      vi.fn<typeof fetch>().mockResolvedValue(response(body)),
    );
    const result = await client.generateStructured(input);
    expect(result).toMatchObject({ ok: true });
    expect(result.metadata).not.toHaveProperty('requestId');
    expect(JSON.stringify(result)).not.toMatch(
      /sensitive|secret|dummy-test-only/,
    );
  });

  it('keeps the supplied fake compatible and uses the same structured validator', async () => {
    const fake = createFakeMaas({ status: 'supported' });
    expect(await fake.extract({ sourceRefs: ['demo'], text: 'demo' })).toEqual({
      status: 'supported',
    });
    expect(await fake.generateStructured(input)).toMatchObject({
      ok: true,
      value: { status: 'supported' },
      metadata: { model: MAAS_MODEL, promptVersion: 'demo-v1', attempts: 0 },
    });
    expect(
      await createFakeMaas({ status: 'invented' }).generateStructured(input),
    ).toMatchObject({ kind: 'invalid_response' });
  });
});

describe('dispatch, interruption and bounded retry semantics', () => {
  it('only retries a transport-proven pre-send failure', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new MaasRequestNotSentError())
      .mockResolvedValueOnce(response());
    const pending = createMaasClient(config, {
      fetch: fetcher,
    }).generateStructured(input);
    await vi.advanceTimersByTimeAsync(250);
    expect(await pending).toMatchObject({
      ok: true,
      metadata: { attempts: 2 },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('bounds retries at two attempts and permits the caller to retry only known-not-sent outcomes', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new MaasRequestNotSentError());
    const pending = createMaasClient(config, {
      fetch: fetcher,
    }).generateStructured(input);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({
      kind: 'network',
      retryable: true,
      metadata: { attempts: 2 },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not retry generic network errors or untrusted lookalike errors', async () => {
    for (const error of [
      new TypeError('network secret'),
      { name: 'MaasRequestNotSentError' },
    ]) {
      const fetcher = vi.fn<typeof fetch>().mockRejectedValue(error);
      const result = await createMaasClient(config, {
        fetch: fetcher,
      }).generateStructured(input);
      expect(result).toMatchObject({
        kind: 'outcome_unknown',
        reason: 'network',
        retryable: false,
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toContain('secret');
    }
  });

  it('does not retry body interruption, even if the thrown error claims not-sent', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.error(new MaasRequestNotSentError());
      },
    });
    const { client, fetcher } = clientWith(
      vi.fn<typeof fetch>().mockResolvedValue(new Response(stream)),
    );
    expect(await client.generateStructured(input)).toMatchObject({
      kind: 'outcome_unknown',
      reason: 'network',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('treats an in-flight timeout as unknown and discards late responses', async () => {
    vi.useFakeTimers();
    let finish!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = createMaasClient(
      { ...config, attemptTimeoutMs: 100 },
      { fetch: fetcher },
    ).generateStructured(input);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({
      kind: 'outcome_unknown',
      reason: 'timeout',
      retryable: false,
    });
    finish(response());
    await vi.runAllTimersAsync();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('applies timeout while reading a response whose stream never finishes', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{'));
      },
      cancel,
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(stream));
    const pending = createMaasClient(
      { ...config, attemptTimeoutMs: 100 },
      { fetch: fetcher },
    ).generateStructured(input);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({
      kind: 'outcome_unknown',
      reason: 'timeout',
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('cancels before dispatch without contacting provider', async () => {
    const controller = new AbortController();
    controller.abort();
    const { client, fetcher } = clientWith();
    expect(
      await client.generateStructured({ ...input, signal: controller.signal }),
    ).toMatchObject({ kind: 'cancelled', metadata: { attempts: 0 } });
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      await createFakeMaas({ status: 'supported' }).generateStructured({
        ...input,
        signal: controller.signal,
      }),
    ).toMatchObject({ kind: 'cancelled' });
  });

  it('cancels after dispatch as unknown even when the transport ignores cancellation', async () => {
    const controller = new AbortController();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(() => new Promise(() => {}));
    const pending = createMaasClient(config, {
      fetch: fetcher,
    }).generateStructured({ ...input, signal: controller.signal });
    controller.abort();
    expect(await pending).toMatchObject({
      kind: 'outcome_unknown',
      reason: 'cancelled',
      retryable: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('cancels during backoff without another request', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new MaasRequestNotSentError());
    const pending = createMaasClient(config, {
      fetch: fetcher,
    }).generateStructured({ ...input, signal: controller.signal });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    expect(await pending).toMatchObject({
      kind: 'cancelled',
      retryable: false,
    });
    await vi.runAllTimersAsync();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not start an attempt when the total budget cannot accommodate backoff', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new MaasRequestNotSentError());
    expect(
      await createMaasClient(
        { ...config, totalTimeoutMs: 100 },
        { fetch: fetcher },
      ).generateStructured(input),
    ).toMatchObject({ kind: 'network', retryable: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('limits the second attempt to the remaining total budget', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new MaasRequestNotSentError())
      .mockImplementationOnce(() => new Promise(() => {}));
    const pending = createMaasClient(
      { ...config, totalTimeoutMs: 300, attemptTimeoutMs: 1000 },
      { fetch: fetcher },
    ).generateStructured(input);
    await vi.advanceTimersByTimeAsync(300);
    expect(await pending).toMatchObject({
      kind: 'outcome_unknown',
      reason: 'timeout',
      metadata: { attempts: 2, elapsedMs: 300 },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('additional boundary regressions', () => {
  it('rejects permissive non-object schemas and malformed fake requests', async () => {
    const { client, fetcher } = clientWith();
    expect(
      await client.generateStructured({
        ...input,
        schema: z.record(z.string(), z.unknown()),
      }),
    ).toMatchObject({ kind: 'invalid_request' });
    expect(
      await createFakeMaas({}).generateStructured({ ...input, messages: [] }),
    ).toMatchObject({ kind: 'invalid_request' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns a safe error when a custom validator throws', async () => {
    const throwing = schema.superRefine(() => {
      throw new Error('secret original text');
    });
    const { client } = clientWith();
    const result = await client.generateStructured({
      ...input,
      schema: throwing,
    });
    expect(result).toMatchObject({ kind: 'invalid_response' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('rejects empty and invalid UTF-8 response bodies', async () => {
    for (const body of [null, new Uint8Array([0xff])]) {
      const { client } = clientWith(
        vi.fn<typeof fetch>().mockResolvedValue(new Response(body)),
      );
      expect(await client.generateStructured(input)).toMatchObject({
        kind: 'invalid_response',
      });
    }
  });

  it('does not require usage accounting but never fabricates it', async () => {
    const { client } = clientWith(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          response({ ...envelope(), usage: { prompt_tokens: -1 } }),
        ),
    );
    const result = await client.generateStructured(input);
    expect(result).toMatchObject({ ok: true });
    expect(result.metadata).not.toHaveProperty('usage');
  });

  it('allows a task to disable adapter retry and own its shared budget', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new MaasRequestNotSentError());
    const result = await createMaasClient(
      { ...config, maxAttempts: 1 },
      { fetch: fetcher },
    ).generateStructured(input);
    expect(result).toMatchObject({
      kind: 'network',
      retryable: true,
      metadata: { attempts: 1 },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('uses injected global fetch only when explicitly called', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetcher);
    try {
      const client = createMaasClient(config);
      expect(fetcher).not.toHaveBeenCalled();
      expect(await client.generateStructured(input)).toMatchObject({
        ok: true,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('cannot publish success after a validator triggers cancellation', async () => {
    const controller = new AbortController();
    const cancelling = schema.superRefine(() => controller.abort());
    const { client } = clientWith();
    expect(
      await client.generateStructured({
        ...input,
        signal: controller.signal,
        schema: cancelling,
      }),
    ).toMatchObject({ kind: 'outcome_unknown', reason: 'cancelled' });
  });

  it('cancels a late response body rather than leaking its stream', async () => {
    vi.useFakeTimers();
    let finish!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const cancel = vi.fn();
    const pending = createMaasClient(
      { ...config, attemptTimeoutMs: 100 },
      { fetch: fetcher },
    ).generateStructured(input);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({ kind: 'outcome_unknown' });
    finish(new Response(new ReadableStream({ cancel })));
    await vi.runAllTimersAsync();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
