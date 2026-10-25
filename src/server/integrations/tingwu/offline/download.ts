import { OfflineError } from './errors';
/** Result URL is used only inside this function; errors never contain it. */
export async function downloadResult(
  urlText: string,
  origins: ReadonlySet<string>,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<unknown> {
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    throw new OfflineError('malformed_result');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    !origins.has(url.origin)
  )
    throw new OfflineError('malformed_result');
  if (signal?.aborted) throw new OfflineError('cancelled');
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let rejectStop!: (error: OfflineError) => void;
  const stop = new Promise<never>((_, reject) => {
    rejectStop = reject;
  });
  const cancelled = () => rejectStop(new OfflineError('cancelled'));
  signal?.addEventListener('abort', cancelled, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectStop(new OfflineError('timeout', true));
  }, 10000);
  try {
    return await Promise.race([
      stop,
      (async () => {
        const response = await fetcher(url, {
          redirect: 'error',
          signal: controller.signal,
        });
        if (!response.ok)
          throw new OfflineError(
            'result_unavailable',
            response.status === 429 || response.status >= 500,
          );
        if (!response.body) throw new OfflineError('malformed_result');
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 16 * 1024 * 1024)
              throw new OfflineError('malformed_result');
            chunks.push(value);
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        try {
          return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
        } catch {
          throw new OfflineError('malformed_result');
        }
      })(),
    ]);
  } catch (error) {
    if (signal?.aborted) throw new OfflineError('cancelled');
    if (timedOut) throw new OfflineError('timeout', true);
    if (error instanceof OfflineError) throw error;
    throw new OfflineError('transport_error', true);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    signal?.removeEventListener('abort', cancelled);
  }
}
