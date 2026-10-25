import { inspect } from 'node:util';
import { KodoError } from './protocol';
export const TRANSCRIPTION_MIN_TTL_MS = 3 * 60 * 60 * 1000;
export const TRANSCRIPTION_SAFETY_MS = 5 * 60 * 1000;
const sources = new WeakMap<TranscriptionSource, string>();
/** Server-only capability: never put this object in a DTO. Only submission unwraps it. */
export class TranscriptionSource {
  readonly purpose = 'tingwu-offline';
  constructor(
    readonly objectKey: string,
    readonly expiresAt: number,
    url: string,
  ) {
    sources.set(this, url);
    Object.freeze(this);
  }
  toJSON() {
    return '[Kodo transcription source redacted]';
  }
  [inspect.custom]() {
    return '[Kodo transcription source redacted]';
  }
}
export function takeTranscriptionSourceUrl(
  source: TranscriptionSource,
  options: { now?: () => number; requiredRemainingTtlMs?: number } = {},
): string {
  const required = options.requiredRemainingTtlMs ?? TRANSCRIPTION_MIN_TTL_MS;
  if (!Number.isSafeInteger(required) || required < TRANSCRIPTION_MIN_TTL_MS)
    throw new KodoError('invalid_input');
  const url = sources.get(source);
  if (!url) throw new KodoError('invalid_input');
  if (source.expiresAt - (options.now ?? Date.now)() < required)
    throw new KodoError('expired');
  return url;
}
