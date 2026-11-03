import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ appEnv: 'test' }));
vi.mock('../env', () => ({
  getEnv: () => ({
    APP_ENV: h.appEnv,
    BETTER_AUTH_URL: 'http://127.0.0.1:3000',
    DATABASE_URL: 'postgres://test-kodo.test/db',
  }),
}));

import { createTestKodo } from '../integrations/kodo/test-kodo';
import { testKodoForServer, testKodoRoute } from './test-kodo';
import { POST, PUT } from '../../app/api/test/kodo/[...path]/route';

const endpoint = 'http://127.0.0.1:3000/api/test/kodo';
const keyPath = (key: string) =>
  Buffer.from(key).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
const sha = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

async function upload(
  kodo: ReturnType<typeof createTestKodo>,
  token: string,
  key: string,
  chunks: Uint8Array<ArrayBuffer>[],
  mimeType: string,
) {
  const path = ['buckets', 'test-bucket', 'objects', keyPath(key), 'uploads'];
  const auth = { authorization: `UpToken ${token}` };
  const init = await kodo.handle(
    new Request(endpoint, { method: 'POST', headers: auth }),
    path,
  );
  const { uploadId } = (await init.json()) as { uploadId: string };
  const parts = [];
  for (const [index, chunk] of chunks.entries()) {
    const put = await kodo.handle(
      new Request(endpoint, { method: 'PUT', headers: auth, body: chunk }),
      [...path, uploadId, String(index + 1)],
    );
    parts.push({
      partNumber: index + 1,
      etag: ((await put.json()) as { etag: string }).etag,
    });
  }
  return kodo.handle(
    new Request(endpoint, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ parts, mimeType }),
    }),
    [...path, uploadId],
  );
}

const directory = mkdtempSync(join(tmpdir(), 'test-kodo-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe('test Kodo double', () => {
  afterEach(() => {
    h.appEnv = 'test';
    vi.unstubAllEnvs();
  });

  it('stores a v2 multipart upload that another process reads back', async () => {
    const kodo = createTestKodo(endpoint, directory);
    const grant = kodo.storage.issueUploadGrant({
      objectKey: 'demo/material-1',
      byteLimit: 64,
      contentType: 'text/plain',
      expiresAt: Date.now() + 60_000,
    });
    expect(grant).toMatchObject({
      uploadEndpoint: endpoint,
      multipartVersion: 2,
    });
    const policy = JSON.parse(
      Buffer.from(grant.token.split(':')[2]!, 'base64').toString(),
    );
    expect(policy.scope).toBe('test-bucket:demo/material-1');
    const first = new TextEncoder().encode('演示');
    const second = new TextEncoder().encode('材料');
    const done = await upload(
      kodo,
      grant.token,
      grant.objectKey,
      [first, second],
      'text/plain',
    );
    const bytes = new Uint8Array([...first, ...second]);
    expect(await done.json()).toEqual({
      key: 'demo/material-1',
      hash: sha(bytes),
    });
    // A second instance on the same directory stands in for the worker process.
    const worker = createTestKodo(endpoint, directory);
    await expect(
      worker.storage.statObject({ objectKey: 'demo/material-1' }),
    ).resolves.toEqual({
      key: 'demo/material-1',
      byteLength: bytes.length,
      mediaType: 'text/plain',
      etag: sha(bytes),
    });
    const opened = await worker.storage.openObject({
      objectKey: 'demo/material-1',
    });
    expect(
      new Uint8Array(await new Response(opened.body).arrayBuffer()),
    ).toEqual(bytes);
  });

  it('refuses a wrong token, oversized content and a different media type', async () => {
    const kodo = createTestKodo(endpoint, directory);
    const grant = kodo.storage.issueUploadGrant({
      objectKey: 'demo/material-2',
      byteLimit: 4,
      contentType: 'text/plain',
      expiresAt: Date.now() + 60_000,
    });
    const small = new TextEncoder().encode('ab');
    expect(
      (await upload(kodo, 'forged', grant.objectKey, [small], 'text/plain'))
        .status,
    ).toBe(401);
    expect(
      (
        await upload(
          kodo,
          grant.token,
          grant.objectKey,
          [small, small, small],
          'text/plain',
        )
      ).status,
    ).toBe(403);
    expect(
      (await upload(kodo, grant.token, grant.objectKey, [small], 'image/png'))
        .status,
    ).toBe(403);
    await expect(
      kodo.storage.statObject({ objectKey: 'demo/material-2' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('is not registered in a production build or outside the test environment', async () => {
    const request = () =>
      new Request(`${endpoint}/buckets/test-bucket/objects/a/uploads`, {
        method: 'POST',
      });
    const context = {
      params: Promise.resolve({
        path: ['buckets', 'test-bucket', 'objects', 'a', 'uploads'],
      }),
    };
    expect(testKodoForServer()).not.toBeNull();
    expect((await POST(request(), context)).status).toBe(401);
    vi.stubEnv('NODE_ENV', 'production');
    expect(testKodoForServer()).toBeNull();
    expect((await POST(request(), context)).status).toBe(404);
    expect((await PUT(request(), context)).status).toBe(404);
    vi.unstubAllEnvs();
    h.appEnv = 'demo';
    expect(testKodoForServer()).toBeNull();
    expect((await testKodoRoute(request(), [])).status).toBe(404);
  });
});
