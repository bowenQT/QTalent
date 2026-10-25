import { createHash } from 'node:crypto';
import { keySchema, type KodoClient } from './protocol';
export { kodoConfigSchema } from './protocol';
export type { ObjectReceipt, KodoClient } from './protocol';
export function createFakeKodo(): KodoClient {
  const objects = new Map<string, Uint8Array>();
  return {
    async write(input) {
      keySchema.parse(input.key);
      const digest = (bytes: Uint8Array) =>
        createHash('sha256').update(bytes).digest('hex');
      const existing = objects.get(input.key);
      if (existing && digest(existing) !== digest(input.bytes))
        throw new Error('Object content conflict');
      objects.set(input.key, new Uint8Array(input.bytes));
      return {
        key: input.key,
        byteLength: input.bytes.byteLength,
        sha256: digest(input.bytes),
      };
    },
    async read(key) {
      const bytes = objects.get(keySchema.parse(key));
      if (!bytes) throw new Error('Object not found');
      return new Uint8Array(bytes);
    },
  };
}

export { createKodoClient } from './client';
export {
  takeTranscriptionSourceUrl,
  TRANSCRIPTION_MIN_TTL_MS,
  TRANSCRIPTION_SAFETY_MS,
} from './source';
export type { TranscriptionSource } from './source';
export { KodoError } from './protocol';
export type {
  UploadInput,
  UploadGrant,
  ObjectStat,
  ByteRange,
} from './protocol';
