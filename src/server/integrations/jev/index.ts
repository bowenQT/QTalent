import { z } from 'zod';

export const jevConfigSchema = z.strictObject({
  endpoint: z.url().startsWith('https://'),
  apiKey: z.string().refine((value) => value.trim().length > 0),
  model: z.literal('typesafe/jev-1.14'),
});
export const conclusionSchema = z.enum([
  'supported',
  'not_supported',
  'insufficient',
  'conflict',
]);
const inputSchema = z.strictObject({
  requirement: z.string().refine((value) => value.trim().length > 0),
  evidence: z
    .array(
      z.strictObject({
        sourceRef: z.string().refine((value) => value.trim().length > 0),
        text: z.string().refine((value) => value.trim().length > 0),
      }),
    )
    .min(1),
});
const resultSchema = z.object({ conclusion: conclusionSchema });
export type JevInput = z.infer<typeof inputSchema>;
export type JevConclusion = z.infer<typeof conclusionSchema>;
export type JevErrorKind =
  | 'configuration'
  | 'invalid_request'
  | 'authentication'
  | 'permission'
  | 'rate_limited'
  | 'unavailable'
  | 'network'
  | 'outcome_unknown'
  | 'invalid_response'
  | 'timeout'
  | 'cancelled';

/** No cause/payload: errors may be logged, but must not disclose evidence or keys. */
export class JevError extends Error {
  readonly retryable = false;
  readonly outcomeUnknown: boolean;
  constructor(readonly kind: JevErrorKind) {
    super(`Jev processing failed: ${kind}`);
    this.name = 'JevError';
    this.outcomeUnknown = ['outcome_unknown', 'timeout', 'cancelled'].includes(
      kind,
    );
  }
}
export interface JevClient {
  decide(
    input: JevInput,
    options?: { signal?: AbortSignal },
  ): Promise<{ conclusion: JevConclusion }>;
}

/** Internal normalized execution seam, NOT a provider wire format or live transport. */
export type JevExecution = (
  input: JevInput,
  signal: AbortSignal,
) => Promise<unknown>;

/**
 * Single-attempt boundary. The provider/channel is not selected yet, so there is
 * deliberately no default execution, fetch, env read, fallback, or HTTP retry.
 */
export function createJevBoundary(
  execute?: JevExecution,
  options: { timeoutMs?: number } = {},
): JevClient {
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 20_000) {
    throw new JevError('configuration');
  }
  return {
    async decide(input, { signal } = {}) {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) throw new JevError('invalid_request');
      if (signal?.aborted) throw new JevError('cancelled');
      if (!execute) throw new JevError('configuration');

      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let cancel: (() => void) | undefined;
      try {
        // A race is required: an execution that ignores AbortSignal must not keep
        // the caller waiting or publish a late conclusion after cancellation.
        const stopped = new Promise<never>((_resolve, reject) => {
          const stop = (kind: 'timeout' | 'cancelled') => {
            reject(new JevError(kind));
            controller.abort();
          };
          cancel = () => stop('cancelled');
          signal?.addEventListener('abort', cancel, { once: true });
          timer = setTimeout(() => stop('timeout'), timeoutMs);
        });
        const response = await Promise.race([
          stopped,
          new Promise<unknown>((resolve) => {
            resolve(execute(parsed.data, controller.signal));
          }),
        ]);
        const result = resultSchema.safeParse(response);
        if (!result.success) throw new JevError('invalid_response');
        // Whitelist projection: no confidence/probabilities/raw payload escapes.
        return { conclusion: result.data.conclusion };
      } catch (error) {
        // Unknown network failures may have reached the provider. Never infer
        // that a disconnected request was not processed or is safe to resend.
        throw new JevError(
          error instanceof JevError ? error.kind : 'outcome_unknown',
        );
      } finally {
        clearTimeout(timer);
        if (cancel) signal?.removeEventListener('abort', cancel);
      }
    },
  };
}
export function createFakeJev(conclusion: JevConclusion): JevClient {
  const value = conclusionSchema.parse(conclusion);
  return createJevBoundary(async () => ({ conclusion: value }));
}
