import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  MaasRequestNotSentError,
  MODELINK_ENDPOINT,
  MODELINK_MODEL,
} from '../integrations/maas';
import { createRecordArrangeModelClient } from './record-arrange-worker';

const request = {
  messages: [{ role: 'user' as const, content: '演示：返回 JSON {"ok":true}' }],
  promptVersion: 'bow-845-worker-test-v1',
  schema: z.object({ ok: z.boolean() }).strict(),
};
const environment = { MODELINK_API_KEY: 'synthetic-offline-845-key' };
afterEach(() => vi.useRealTimers());

it('uses the actual Modelink protocol and fixed output budget without sending during construction', async () => {
  const send = vi.fn<typeof fetch>(async (url, init) => {
    expect(url).toBe(MODELINK_ENDPOINT);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: MODELINK_MODEL,
      response_format: { type: 'json_object' },
      max_tokens: 8192,
      stream: false,
    });
    return new Response(
      JSON.stringify({
        model: MODELINK_MODEL,
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: '{"ok":true}' },
          },
        ],
      }),
    );
  });
  const client = createRecordArrangeModelClient(environment, { fetch: send });
  expect(send).not.toHaveBeenCalled();
  expect(await client.generateStructured(request)).toMatchObject({
    ok: true,
    value: { ok: true },
  });
  expect(send).toHaveBeenCalledTimes(1);
});

it('does not multiply842 retry by retrying even a proven unsent transport failure', async () => {
  const send = vi.fn<typeof fetch>(async () => {
    throw new MaasRequestNotSentError();
  });
  const result = await createRecordArrangeModelClient(environment, {
    fetch: send,
  }).generateStructured(request);
  expect(result).toMatchObject({
    ok: false,
    kind: 'network',
    retryable: true,
    metadata: { attempts: 1 },
  });
  expect(send).toHaveBeenCalledTimes(1);
});

it.each([
  {},
  { ...environment, MODELINK_BASE_URL: 'https://invalid.example/v1' },
  { ...environment, MODELINK_MODEL: 'unapproved-model' },
])(
  'fails closed for missing or unsupported server configuration before dispatch',
  async (config) => {
    const send = vi.fn<typeof fetch>();
    expect(
      await createRecordArrangeModelClient(config, {
        fetch: send,
      }).generateStructured(request),
    ).toMatchObject({ ok: false });
    expect(send).not.toHaveBeenCalled();
  },
);

it('terminates a dispatched timeout at30 seconds and never retries an unknown outcome', async () => {
  vi.useFakeTimers();
  let aborted = false;
  const send = vi.fn<typeof fetch>(async (_url, init) => {
    init?.signal?.addEventListener('abort', () => {
      aborted = true;
    });
    return new Promise<Response>(() => {});
  });
  const pending = createRecordArrangeModelClient(environment, {
    fetch: send,
  }).generateStructured(request);
  await vi.advanceTimersByTimeAsync(29999);
  expect(aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toMatchObject({
    ok: false,
    kind: 'outcome_unknown',
    retryable: false,
  });
  expect(aborted).toBe(true);
  expect(send).toHaveBeenCalledTimes(1);
});

it('rejects an oversized actual response body', async () => {
  const send = vi.fn<typeof fetch>(
    async () => new Response('x'.repeat(1048577)),
  );
  expect(
    await createRecordArrangeModelClient(environment, {
      fetch: send,
    }).generateStructured(request),
  ).toMatchObject({ ok: false, kind: 'invalid_response' });
  expect(send).toHaveBeenCalledTimes(1);
});
