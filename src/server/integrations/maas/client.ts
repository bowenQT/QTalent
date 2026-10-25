import { z } from 'zod';
import {
  MAAS_ENDPOINT,
  MAAS_MODEL,
  metadataFor,
  validInput,
  validateValue,
  type MaasMetadata,
  type MaasResult,
  type StructuredMaasClient,
} from './structured';

const liveConfigSchema = z
  .object({
    // Inject from the server environment at composition time. Never read process.env here.
    apiKey: z.string().regex(/^[^\s]+$/),
    endpoint: z.literal(MAAS_ENDPOINT).default(MAAS_ENDPOINT),
    model: z.literal(MAAS_MODEL).default(MAAS_MODEL),
    attemptTimeoutMs: z.number().int().positive().max(30000).default(30000),
    totalTimeoutMs: z.number().int().positive().max(45000).default(45000),
    maxAttempts: z.number().int().min(1).max(2).default(2),
    maxResponseBytes: z.number().int().positive().max(1048576).default(1048576),
    maxTokens: z.number().int().positive().max(16384).default(4096),
  })
  .strict();
const responseSchema = z.object({
  id: z.unknown().optional(),
  model: z.literal(MAAS_MODEL),
  choices: z
    .array(
      z.object({
        finish_reason: z.literal('stop'),
        message: z.object({
          role: z.literal('assistant'),
          content: z.string().trim().min(1),
        }),
      }),
    )
    .length(1),
  usage: z.unknown().optional(),
});
const usageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
});

/** Only a trusted server transport with proof of no dispatch may throw this.
 * Native fetch failures do not establish that fact and are never retried.
 */
export class MaasRequestNotSentError extends Error {
  constructor() {
    super('MaaS request was not sent');
    this.name = 'MaasRequestNotSentError';
  }
}
class InvalidResponseError extends Error {}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    // Attach handlers even when already aborted, consuming late rejections.
    operation
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

async function readResponse(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<unknown> {
  if (!response.body) throw new InvalidResponseError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new InvalidResponseError();
      chunks.push(value);
    }
  } catch (error) {
    // Cancellation is cleanup only; a stalled transport must not hold the caller open.
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } catch {
    throw new InvalidResponseError();
  }
}

function providerMetadata(
  body: z.infer<typeof responseSchema>,
  metadata: MaasMetadata,
): void {
  if (typeof body.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(body.id))
    metadata.requestId = body.id;
  const usage = usageSchema.safeParse(body.usage);
  if (usage.success)
    metadata.usage = {
      promptTokens: usage.data.prompt_tokens,
      completionTokens: usage.data.completion_tokens,
      totalTokens: usage.data.total_tokens,
    };
}

/** Explicit opt-in only. Importing or constructing a client never sends a request. */
export function createMaasClient(
  configuration: unknown,
  transport: { fetch?: typeof fetch } = {},
): StructuredMaasClient {
  const checked = liveConfigSchema.safeParse(configuration);
  const send = transport.fetch ?? fetch;
  return {
    async generateStructured(input) {
      const started = Date.now();
      const metadata = metadataFor(input);
      const failure = (
        kind: Extract<MaasResult<never>, { ok: false }>['kind'],
        extra: Partial<
          Pick<
            Extract<MaasResult<never>, { ok: false }>,
            'reason' | 'status' | 'retryable'
          >
        > = {},
      ): MaasResult<never> => {
        metadata.elapsedMs = Date.now() - started;
        return { ok: false, kind, retryable: false, metadata, ...extra };
      };
      if (!checked.success) return failure('configuration');
      if (!validInput(input)) return failure('invalid_request');
      if (input.signal?.aborted) return failure('cancelled');
      const config = checked.data;
      const body = JSON.stringify({
        model: config.model,
        messages: input.messages,
        response_format: { type: 'json_object' },
        stream: false,
        max_tokens: config.maxTokens,
      });
      for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
        const remaining = config.totalTimeoutMs - (Date.now() - started);
        if (remaining <= 0 || input.signal?.aborted)
          return failure(input.signal?.aborted ? 'cancelled' : 'network', {
            retryable: !input.signal?.aborted,
          });
        const controller = new AbortController();
        let interruption: 'cancelled' | 'timeout' | undefined;
        const cancel = () => {
          interruption = 'cancelled';
          controller.abort();
        };
        input.signal?.addEventListener('abort', cancel, { once: true });
        const timer = setTimeout(
          () => {
            interruption = 'timeout';
            controller.abort();
          },
          Math.min(config.attemptTimeoutMs, remaining),
        );
        metadata.attempts = attempt;
        let receivedResponse = false;
        let notSent = false;
        try {
          const response = await abortable(
            send(config.endpoint, {
              method: 'POST',
              redirect: 'error',
              headers: {
                Authorization: `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
              },
              body,
              signal: controller.signal,
            }).then((response) => {
              if (controller.signal.aborted)
                void response.body?.cancel().catch(() => undefined);
              return response;
            }),
            controller.signal,
          );
          receivedResponse = true;
          if (controller.signal.aborted)
            return failure('outcome_unknown', { reason: interruption });
          if (!response.ok) {
            void response.body?.cancel().catch(() => undefined);
            const status = response.status;
            if (status === 401) return failure('authentication', { status });
            if (status === 403) return failure('permission', { status });
            if (status === 400 || status === 404 || status === 422)
              return failure('invalid_request', { status });
            // No published Qiniu guarantee that 429/5xx means not processed/billed.
            return failure('outcome_unknown', {
              status,
              reason: status === 429 ? 'rate_limited' : 'unavailable',
            });
          }
          const raw = await readResponse(
            response,
            config.maxResponseBytes,
            controller.signal,
          );
          if (controller.signal.aborted)
            return failure('outcome_unknown', { reason: interruption });
          const parsed = responseSchema.safeParse(raw);
          if (!parsed.success) return failure('invalid_response');
          providerMetadata(parsed.data, metadata);
          let value: unknown;
          try {
            value = JSON.parse(parsed.data.choices[0].message.content);
          } catch {
            return failure('invalid_response');
          }
          const result = validateValue(value, input, metadata);
          if (controller.signal.aborted)
            return failure('outcome_unknown', { reason: interruption });
          metadata.elapsedMs = Date.now() - started;
          return result;
        } catch (error) {
          if (interruption)
            return failure('outcome_unknown', { reason: interruption });
          if (error instanceof InvalidResponseError)
            return failure('invalid_response');
          notSent =
            !receivedResponse && error instanceof MaasRequestNotSentError;
          if (!notSent)
            return failure('outcome_unknown', { reason: 'network' });
        } finally {
          clearTimeout(timer);
          input.signal?.removeEventListener('abort', cancel);
        }
        if (notSent) {
          const delay = 250;
          if (
            attempt === config.maxAttempts ||
            config.totalTimeoutMs - (Date.now() - started) <= delay
          )
            return failure('network', { retryable: true });
          // One bounded backoff. No HTTP status alone authorizes replay.
          const waitController = new AbortController();
          const cancelWait = () => waitController.abort();
          input.signal?.addEventListener('abort', cancelWait, { once: true });
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            if (input.signal?.aborted) return failure('cancelled');
            await abortable(
              new Promise<void>((resolve) => {
                timer = setTimeout(resolve, delay);
              }),
              waitController.signal,
            );
          } catch {
            return failure('cancelled');
          } finally {
            clearTimeout(timer);
            input.signal?.removeEventListener('abort', cancelWait);
          }
        }
      }
      return failure('network', { retryable: true });
    },
  };
}
