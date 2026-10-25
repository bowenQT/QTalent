import { describe, expect, it, vi } from 'vitest';
import { createKodoClient, takeTranscriptionSourceUrl } from './index';
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
    });
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
