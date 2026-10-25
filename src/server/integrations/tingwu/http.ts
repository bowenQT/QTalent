import { createHash, createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';

export type TingwuErrorCode =
  | 'configuration_error'
  | 'invalid_request'
  | 'provider_auth'
  | 'rate_limited'
  | 'provider_failed'
  | 'protocol_error'
  | 'timeout'
  | 'aborted'
  | 'transport_error';
export class TingwuHttpError extends Error {
  constructor(
    public readonly code: TingwuErrorCode,
    public readonly httpStatus?: number,
  ) {
    super(code);
    this.name = 'TingwuHttpError';
  }
}
export interface TingwuHttpRequest {
  method: 'GET' | 'PUT';
  action: 'CreateTask' | 'GetTaskInfo';
  path: string;
  query?: Record<string, string>;
  body?: object;
  signal?: AbortSignal;
}
export type TingwuRequest = (request: TingwuHttpRequest) => Promise<unknown>;
export interface TimerClock {
  schedule(callback: () => void, milliseconds: number): () => void;
}
export const systemClock: TimerClock = {
  schedule(callback, milliseconds) {
    const timer = setTimeout(callback, milliseconds);
    return () => clearTimeout(timer);
  },
};
const configSchema = z.object({
  endpoint: z.literal('https://tingwu.cn-beijing.aliyuncs.com'),
  accessKeyId: z.string().min(1),
  accessKeySecret: z.string().min(1),
  appKey: z.string().min(1),
});
export type TingwuHttpConfig = z.infer<typeof configSchema>;
const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');

/** Only Tingwu OpenAPI; no retries, redirects, arbitrary hosts or raw provider errors. */
export function createTingwuHttp(
  input: unknown,
  dependencies: {
    fetch?: typeof fetch;
    now?: () => Date;
    nonce?: () => string;
    clock?: TimerClock;
  } = {},
): TingwuRequest {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) throw new TingwuHttpError('configuration_error');
  const config = parsed.data;
  const fetcher = dependencies.fetch ?? fetch;
  const clock = dependencies.clock ?? systemClock;
  return async (request) => {
    if (
      !/^\/openapi\/tingwu\/v2\/tasks(?:\/[a-zA-Z0-9_-]+)?$/.test(request.path)
    )
      throw new TingwuHttpError('invalid_request');
    if (request.signal?.aborted) throw new TingwuHttpError('aborted');
    const body = request.body === undefined ? '' : JSON.stringify(request.body);
    const query = Object.entries(request.query ?? {})
      .map(([key, value]) => [encode(key), encode(value)])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
    const headers: Record<string, string> = {
      host: 'tingwu.cn-beijing.aliyuncs.com',
      'x-acs-action': request.action,
      'x-acs-content-sha256': hash(body),
      'x-acs-date': (dependencies.now ?? (() => new Date()))()
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z'),
      'x-acs-signature-nonce': (dependencies.nonce ?? randomUUID)(),
      'x-acs-version': '2023-09-30',
    };
    const keys = Object.keys(headers).sort();
    const signedHeaders = keys.join(';');
    const canonical = [
      request.method,
      request.path,
      query,
      keys.map((key) => `${key}:${headers[key]}\n`).join(''),
      signedHeaders,
      hash(body),
    ].join('\n');
    const signature = createHmac('sha256', config.accessKeySecret)
      .update(`ACS3-HMAC-SHA256\n${hash(canonical)}`)
      .digest('hex');
    headers.authorization = `ACS3-HMAC-SHA256 Credential=${config.accessKeyId},SignedHeaders=${signedHeaders},Signature=${signature}`;
    headers['content-type'] = 'application/json';
    const controller = new AbortController();
    let cancelTimer = () => {};
    let cancelAbort = () => {};
    const interrupted = new Promise<never>((_, reject) => {
      cancelTimer = clock.schedule(() => {
        controller.abort();
        reject(new TingwuHttpError('timeout'));
      }, 10000);
      const abort = () => {
        controller.abort();
        reject(new TingwuHttpError('aborted'));
      };
      request.signal?.addEventListener('abort', abort, { once: true });
      cancelAbort = () => request.signal?.removeEventListener('abort', abort);
    });
    try {
      return await Promise.race([
        interrupted,
        (async () => {
          const response = await fetcher(
            `${config.endpoint}${request.path}${query ? `?${query}` : ''}`,
            {
              method: request.method,
              headers,
              body: body || undefined,
              signal: controller.signal,
              redirect: 'error',
            },
          );
          if (!response.ok)
            throw new TingwuHttpError(
              response.status === 401 || response.status === 403
                ? 'provider_auth'
                : response.status === 429
                  ? 'rate_limited'
                  : 'provider_failed',
              response.status,
            );
          let result: unknown;
          try {
            result = await response.json();
          } catch {
            throw new TingwuHttpError('protocol_error');
          }
          if (!result || typeof result !== 'object' || Array.isArray(result))
            throw new TingwuHttpError('protocol_error');
          if ('Code' in result && result.Code !== '0' && result.Code !== 0)
            throw new TingwuHttpError('provider_failed');
          return result;
        })(),
      ]);
    } catch (error) {
      if (error instanceof TingwuHttpError) throw error;
      // Exception messages can contain signed URLs, response text or credentials.
      throw new TingwuHttpError('transport_error');
    } finally {
      cancelTimer();
      cancelAbort();
    }
  };
}
