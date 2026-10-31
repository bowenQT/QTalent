import { describe, expect, it, vi } from 'vitest';
import {
  createKodoClient,
  KodoError,
  takeTranscriptionSourceUrl,
} from './index';
const config = {
  endpoint: 'https://objects.example.test',
  uploadEndpoint: 'https://up.example.test',
  managementEndpoint: 'https://rs.example.test',
  accessKey: 'synthetic-ak',
  secretKey: 'synthetic-secret',
  bucket: 'test-bucket',
};
describe('private Kodo adapter', () => {
  it('issues insert-only exact-object size/type/time-limited upload policy', () => {
    const client = createKodoClient(config, {
      now: () => 1000,
      fetch: vi.fn(),
    });
    const grant = client.issueUploadGrant({
      objectKey: 'synthetic/a',
      byteLimit: 12,
      contentType: 'audio/wav',
      expiresAt: 61000,
    });
    expect(
      JSON.parse(
        Buffer.from(grant.token.split(':')[2], 'base64url').toString(),
      ),
    ).toMatchObject({
      scope: 'test-bucket:synthetic/a',
      insertOnly: 1,
      fsizeLimit: 12,
      mimeLimit: 'audio/wav',
      deadline: 61,
      returnBody: '{"key":"$(key)","hash":"$(etag)"}',
    });
    const opaque = JSON.parse(
      Buffer.from(
        client
          .issueUploadGrant({
            objectKey: 'synthetic/a',
            byteLimit: 12,
            contentType: 'application/octet-stream',
            expiresAt: 61000,
          })
          .token.split(':')[2]!,
        'base64url',
      ).toString(),
    );
    expect(opaque.mimeLimit).toBeUndefined();
    expect(opaque.returnBody).toBe('{"key":"$(key)","hash":"$(etag)"}');
    expect(() =>
      client.issueUploadGrant({
        objectKey: 'synthetic/a',
        byteLimit: 12,
        contentType: '!audio/wav',
        expiresAt: 61000,
      }),
    ).toThrow(KodoError);
    expect(() =>
      client.issueUploadGrant({
        objectKey: 'a"b',
        byteLimit: 12,
        contentType: 'audio/wav',
        expiresAt: 61000,
      }),
    ).toThrow(KodoError);
  });
  it('signs the origin fetch will actually send', () => {
    const client = createKodoClient(
      { ...config, endpoint: 'https://CDN.Example:443/' },
      { now: () => 1_700_000_000_000, fetch: vi.fn() },
    );
    const source = client.createTranscriptionSource({
      objectKey: 'synthetic/a',
      purpose: 'tingwu-offline',
      requiredRemainingTtlMs: 11100000,
    });
    const url = takeTranscriptionSourceUrl(source, {
      now: () => 1_700_000_000_000,
      requiredRemainingTtlMs: 10800000,
    });
    expect(url.startsWith('https://cdn.example/synthetic/a?e=')).toBe(true);
    expect(url).not.toContain(':443');
    expect(url).not.toContain('CDN');
  });
  it('keeps transcription URLs out of JSON and requires enough remaining TTL', () => {
    let time = 1000;
    const client = createKodoClient(config, {
      now: () => time,
      fetch: vi.fn(),
    });
    const source = client.createTranscriptionSource({
      objectKey: 'synthetic/a',
      purpose: 'tingwu-offline',
      requiredRemainingTtlMs: 11100000,
    });
    expect(JSON.stringify(source)).not.toContain('token');
    expect(
      takeTranscriptionSourceUrl(source, {
        now: () => time,
        requiredRemainingTtlMs: 10800000,
      }),
    ).toContain('https://objects.example.test/synthetic/a?e=');
    time += 400000;
    expect(() =>
      takeTranscriptionSourceUrl(source, {
        now: () => time,
        requiredRemainingTtlMs: 10800000,
      }),
    ).toThrow();
  });
});

it('issues the frozen 2 GiB media limit in exact bytes without allocating an object', () => {
  const network = vi.fn();
  const client = createKodoClient(config, { now: () => 1000, fetch: network });
  for (const byteLimit of [1_073_741_825, 2_000_000_000, 2_147_483_648]) {
    const grant = client.issueUploadGrant({
      objectKey: 'synthetic/limit',
      byteLimit,
      contentType: 'application/octet-stream',
      expiresAt: 61000,
    });
    const policy = JSON.parse(
      Buffer.from(grant.token.split(':')[2], 'base64url').toString(),
    );
    expect(policy.fsizeLimit).toBe(byteLimit);
  }
  expect(() =>
    client.issueUploadGrant({
      objectKey: 'synthetic/limit',
      byteLimit: 2_147_483_649,
      contentType: 'application/octet-stream',
      expiresAt: 61000,
    }),
  ).toThrow(KodoError);
  expect(network).not.toHaveBeenCalled();
});
