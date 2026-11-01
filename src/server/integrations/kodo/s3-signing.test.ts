import { describe, expect, it, vi } from 'vitest';
import { createKodoClient, takeTranscriptionSourceUrl } from './index';
import type { LiveKodoConfig } from './client';
import { presignS3Get } from './s3-signing';

const config = {
  endpoint: 'https://demo-bucket.s3.cn-east-1.qiniucs.com',
  uploadEndpoint: 'https://up.example.test',
  managementEndpoint: 'https://rs.example.test',
  accessKey: 'synthetic-ak',
  secretKey: 'synthetic-secret',
  bucket: 'demo-bucket',
};
const instant = Date.parse('2026-11-01T01:02:03.000Z');
function source(
  input: LiveKodoConfig & { s3Region?: string },
  key = 'demo/audio.wav',
  now = instant,
  ttl = 11100000,
) {
  const network = vi.fn<typeof fetch>();
  const value = createKodoClient(input, {
    now: () => now,
    fetch: network,
  }).createTranscriptionSource({
    objectKey: key,
    purpose: 'tingwu-offline',
    requiredRemainingTtlMs: ttl,
  });
  expect(network).not.toHaveBeenCalled();
  return {
    value,
    url: new URL(takeTranscriptionSourceUrl(value, { now: () => now })),
  };
}
describe('the unique Kodo private read signer uses S3 SigV4', () => {
  it('matches the independently published AWS query-signature vector', () => {
    // Public, expired AWS documentation vector; these are not operational credentials.
    // https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-query-string-auth.html
    const { url } = source(
      {
        ...config,
        endpoint: 'https://examplebucket.s3.amazonaws.com',
        bucket: 'examplebucket',
        s3Region: 'us-east-1',
        accessKey: 'AKIAIOSFODNN7EXAMPLE',
        secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      },
      'test.txt',
      Date.parse('2013-05-24T00:00:00.000Z'),
      86400000,
    );
    expect(url.searchParams.get('X-Amz-Signature')).toBe(
      'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
    expect(url.searchParams.get('X-Amz-Credential')).toBe(
      'AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request',
    );
    expect(url.searchParams.get('X-Amz-Expires')).toBe('86400');
    expect(url.searchParams.has('e')).toBe(false);
    expect(url.searchParams.has('token')).toBe(false);
  });
  it('retains the configured virtual origin and derives only its documented S3 region', () => {
    const { url } = source(config);
    expect(url.origin).toBe(config.endpoint);
    expect(url.pathname).toBe('/demo/audio.wav');
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Credential')).toBe(
      'synthetic-ak/20261101/cn-east-1/s3/aws4_request',
    );
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
  });
  it('uses the configured S3 alias rather than replacing it with the native bucket name', () => {
    const { url } = source({
      ...config,
      bucket: 'native-bucket',
      endpoint: 'https://existing-s3-alias.s3.cn-east-2.qiniucs.com',
    });
    expect(url.host).toBe('existing-s3-alias.s3.cn-east-2.qiniucs.com');
    expect(url.searchParams.get('X-Amz-Credential')).toContain(
      '/cn-east-2/s3/',
    );
  });
  it('binds a documented path-style endpoint to the configured bucket', () => {
    const { url } = source({
      ...config,
      endpoint: 'https://s3.cn-east-1.qiniucs.com',
    });
    expect(url.origin).toBe('https://s3.cn-east-1.qiniucs.com');
    expect(url.pathname).toBe('/demo-bucket/demo/audio.wav');
  });
  it('encodes reserved bytes using SigV4 rules while preserving key slashes', () => {
    const { url } = source(config, "demo//空 格+?!'()*%/audio.wav");
    expect(url.pathname).toBe(
      '/demo//%E7%A9%BA%20%E6%A0%BC%2B%3F%21%27%28%29%2A%25/audio.wav',
    );
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
  });
  it('rejects a conflicting region and unknown origins without an explicit region', () => {
    expect(() => source({ ...config, s3Region: 'cn-east-2' })).toThrow(
      'invalid_input',
    );
    expect(() =>
      source({ ...config, endpoint: 'https://objects.example.test' }),
    ).toThrow('invalid_input');
  });
  it('does not sign a non-finite security clock', () => {
    expect(() => source(config, 'demo/a', Number.NaN)).toThrow('invalid_input');
  });
  it('keeps the capability expiry equal to the actual second-aligned signature expiry', () => {
    const now = instant + 789;
    const { value, url } = source(config, 'demo/a', now, 86400000);
    const date = url.searchParams.get('X-Amz-Date')!;
    const signedAt = Date.parse(
      date.replace(
        /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
        '$1-$2-$3T$4:$5:$6Z',
      ),
    );
    expect(
      signedAt + Number(url.searchParams.get('X-Amz-Expires')) * 1000,
    ).toBe(value.expiresAt);
    expect(value.expiresAt - now).toBeGreaterThanOrEqual(86400000);
  });
});

describe('internal short read signature boundaries', () => {
  it('expires on the actual second boundary and never signs an already expired deadline', () => {
    const signed = presignS3Get(config, {
      objectKey: 'demo/a',
      now: instant + 789,
      expiresAt: instant + 3999,
    });
    expect(signed.expiresAt).toBe(instant + 3000);
    expect(new URL(signed.url).searchParams.get('X-Amz-Expires')).toBe('3');
    for (const expiresAt of [instant, instant - 1, instant + 500])
      expect(() =>
        presignS3Get(config, {
          objectKey: 'demo/a',
          now: instant + 789,
          expiresAt,
        }),
      ).toThrow('expired');
  });
  it('bounds signing time, credentials, region and exact object inputs before I/O', () => {
    for (const now of [
      -1,
      Number.POSITIVE_INFINITY,
      8640000000000001,
      Date.UTC(10000, 0, 1),
    ])
      expect(() =>
        presignS3Get(config, {
          objectKey: 'demo/a',
          now,
          expiresAt: instant + 5000,
        }),
      ).toThrow('invalid_input');
    for (const expiresAt of [Number.NaN, instant + 604801000])
      expect(() =>
        presignS3Get(config, { objectKey: 'demo/a', now: instant, expiresAt }),
      ).toThrow('invalid_input');
    for (const objectKey of ['../a', 'a/../b', 'a\\b', '\uD800'])
      expect(() =>
        presignS3Get(config, {
          objectKey,
          now: instant,
          expiresAt: instant + 5000,
        }),
      ).toThrow('invalid_input');
    for (const patch of [
      { endpoint: 'http://objects.example.test' },
      { bucket: '../other' },
      { accessKey: '' },
      { secretKey: '' },
      { s3Region: 'CN EAST' },
    ])
      expect(() =>
        presignS3Get(
          { ...config, ...patch },
          { objectKey: 'demo/a', now: instant, expiresAt: instant + 5000 },
        ),
      ).toThrow('invalid_input');
    expect(() => source(config, 'demo/a', instant, 86400001)).toThrow(
      'invalid_input',
    );
  });
});
