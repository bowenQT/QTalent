import 'server-only';
import { z } from 'zod';
import { createJevBoundary, JevError, type JevClient } from './boundary';
import {
  fromWire,
  JEV_BASE_URL,
  JEV_ENDPOINT,
  JEV_MODEL,
  toWire,
} from './protocol';

// Application safety budgets, not supplier limits. Server callers may lower them.
const liveConfigSchema = z.strictObject({
  apiKey: z.string().regex(/^[\x21-\x7e]+$/),
  endpoint: z.literal(JEV_ENDPOINT).default(JEV_ENDPOINT),
  model: z.literal(JEV_MODEL).default(JEV_MODEL),
  timeoutMs: z.number().int().positive().max(20_000).default(15_000),
  maxRequestBytes: z.number().int().positive().max(24_576).default(24_576),
  maxResponseBytes: z
    .number()
    .int()
    .positive()
    .max(2_000_000)
    .default(2_000_000),
});
type Transport = { fetch?: typeof fetch };

function cancelBody(response: Response) {
  // Cleanup is non-blocking: cancellation hooks may stall or reject.
  void response.body?.cancel().catch(() => undefined);
}

function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
) {
  return new Promise<ReadableStreamReadResult<Uint8Array>>(
    (resolve, reject) => {
      const abort = () => reject(new JevError('cancelled'));
      signal.addEventListener('abort', abort, { once: true });
      // Always consume a pending read, including its late rejection after abort.
      reader
        .read()
        .then(resolve, reject)
        .finally(() => {
          signal.removeEventListener('abort', abort);
        });
      if (signal.aborted) abort();
    },
  );
}

async function readResponse(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
) {
  if (!response.body) throw new JevError('invalid_response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await readChunk(reader, signal);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new JevError('invalid_response');
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
    ) as unknown;
  } catch {
    throw new JevError('invalid_response');
  }
}

/** Explicit server opt-in. Import/creation never dispatches, probes, or retries. */
export function createJevClient(
  configuration: unknown,
  transport: Transport = {},
): JevClient {
  const checked = liveConfigSchema.safeParse(configuration);
  const send = transport.fetch ?? globalThis.fetch;
  if (!checked.success) return createJevBoundary();
  const config = checked.data;
  return createJevBoundary(
    async (input, signal) => {
      const body = JSON.stringify(toWire(input));
      if (Buffer.byteLength(body, 'utf8') > config.maxRequestBytes)
        throw new JevError('invalid_request');
      const response = await send(config.endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body,
        signal,
      });
      if (signal.aborted) {
        cancelBody(response);
        throw new JevError('cancelled');
      }
      if (response.status !== 200) {
        cancelBody(response);
        // Never read or expose an HTTP error body; it may echo keys/evidence.
        if (response.status === 400) throw new JevError('invalid_request');
        if (response.status === 401) throw new JevError('authentication');
        if (response.status === 403) throw new JevError('permission');
        if (response.status === 429) throw new JevError('rate_limited');
        if (response.status >= 500) throw new JevError('unavailable');
        throw new JevError('invalid_response');
      }
      return fromWire(
        await readResponse(response, config.maxResponseBytes, signal),
      );
    },
    { timeoutMs: config.timeoutMs },
  );
}

const environmentSchema = z.object({
  QINIU_MAAS_API_KEY: liveConfigSchema.shape.apiKey,
  QINIU_JEV_BASE_URL: z.literal(JEV_BASE_URL).default(JEV_BASE_URL),
  QINIU_JEV_MODEL: z.literal(JEV_MODEL).default(JEV_MODEL),
});

/** Read existing names only on explicit composition; never load a .env file. */
export function createJevClientFromEnv(
  environment: Record<string, string | undefined> = process.env,
  transport: Transport = {},
): JevClient {
  const checked = environmentSchema.safeParse(environment);
  if (!checked.success) return createJevBoundary();
  return createJevClient(
    {
      apiKey: checked.data.QINIU_MAAS_API_KEY,
      endpoint: `${checked.data.QINIU_JEV_BASE_URL}/systemone`,
      model: checked.data.QINIU_JEV_MODEL,
    },
    transport,
  );
}
