import { expect, it } from 'vitest';
import { fixture } from '../../../../../tests/fixtures/upload-fake';
import { verifyUploadObject } from './content';
import type { UploadStorage } from './types';

it('verifies exactly 2 GiB from a bounded synthetic stream against an independent OpenSSL digest', async () => {
  const f = fixture();
  const bytes = 2 ** 31;
  const key = 'synthetic/two-gib';
  const chunk = new Uint8Array(1024 * 1024).fill(0x61);
  let chunks = 0;
  const storage: UploadStorage = {
    ...f.options.storage,
    async statObject() {
      return {
        key,
        byteLength: bytes,
        mediaType: 'text/plain',
        etag: 'synthetic-stable-object',
      };
    },
    async openObject() {
      return {
        status: 200,
        headers: {
          'content-type': 'text/plain',
          'content-length': String(bytes),
        },
        body: new ReadableStream<Uint8Array>({
          pull(controller) {
            if (chunks < 2048) {
              chunks++;
              controller.enqueue(chunk);
            } else controller.close();
          },
        }),
        close() {},
      };
    },
  };
  const result = await verifyUploadObject(storage, key, {
    ...f.request,
    declaredBytes: bytes,
  });
  expect(result.byteLength).toBe(2147483648);
  expect(chunks).toBe(2048);
  // Generated once with /usr/bin/openssl dgst -sha256 over 2048 * 1 MiB ASCII a.
  // The expected value is not calculated by the implementation under test.
  expect(result.sha256).toBe(
    '95df3ea61db557b22c1abf609645c3423bf83774c22c75e3c637f8cb7fc33fd8',
  );
}, 45000);
