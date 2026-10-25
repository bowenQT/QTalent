import { createHash } from 'node:crypto';
import { z } from 'zod';
export const kodoConfigSchema = z.object({
  endpoint: z.url().startsWith('https://'),
  accessKey: z.string().min(1),
  secretKey: z.string().min(1),
  bucket: z.string().min(1),
});
const keySchema = z.string().min(1).max(750);
export type ObjectReceipt = { key: string; byteLength: number; sha256: string };
export interface KodoClient {
  write(input: { key: string; bytes: Uint8Array }): Promise<ObjectReceipt>;
  read(key: string): Promise<Uint8Array>;
}
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
