import { expect, it, vi } from 'vitest';
import { KodoError } from '../../../integrations/kodo';
import { fixture } from '../../../../../tests/fixtures/upload-fake';
import { createUploadService } from './service';
import { createOriginalReader } from './read';
import { createUploadHttpHandlers } from './http';
import { UploadError } from './types';

async function ready() {
  const f = fixture();
  const service = createUploadService(f.options);
  const upload = await service.request('account', f.request);
  await f.put(upload.objectKey);
  const completed = await service.complete('account', {
    uploadId: upload.uploadId,
    operationId: 'demo-complete',
    receiptRef: 'demo-notification',
    expectedRevision: 1,
  });
  const reader = createOriginalReader(f.options);
  const grant = await reader.grant('account', {
    originalId: completed.originalId,
    originalVersionId: completed.originalVersionId,
  });
  const audit = vi.fn(async () => {});
  const http = createUploadHttpHandlers({
    service,
    reader,
    trustedOrigin: 'https://app.invalid',
    authenticate: async () => 'account',
    auditOriginalRead: audit,
  });
  const url = new URL(grant.url, 'https://app.invalid');
  return {
    ...f,
    reader,
    http,
    audit,
    url,
    token: url.searchParams.get('ticket')!,
  };
}
const failures = [
  {
    error: new KodoError('unauthorized', 400),
    status: 'unavailable',
    reason: 'original_storage_unauthorized',
    http: 503,
  },
  {
    error: new KodoError('unauthorized', 403),
    status: 'unavailable',
    reason: 'original_storage_unauthorized',
    http: 503,
  },
  {
    error: new KodoError('expired', 400),
    status: 'unavailable',
    reason: 'original_storage_expired',
    http: 503,
  },
  {
    error: new KodoError('invalid_input', 400),
    status: 'validation_error',
    reason: 'invalid_input',
    http: 400,
  },
  {
    error: new KodoError('invalid_range', 416),
    status: 'validation_error',
    reason: 'invalid_range',
    http: 400,
  },
  {
    error: new KodoError('not_found', 404),
    status: 'not_found',
    reason: 'original_not_found',
    http: 404,
  },
  {
    error: new KodoError('timeout'),
    status: 'unavailable',
    reason: 'original_storage_unavailable',
    http: 503,
  },
  {
    error: new KodoError('unavailable', 500),
    status: 'unavailable',
    reason: 'original_storage_unavailable',
    http: 503,
  },
  {
    error: new KodoError('rate_limited', 429),
    status: 'unavailable',
    reason: 'original_storage_unavailable',
    http: 503,
  },
  {
    error: new KodoError('integrity'),
    status: 'unavailable',
    reason: 'original_storage_unavailable',
    http: 503,
  },
] as const;
for (const stage of ['statObject', 'openObject'] as const)
  it.each(failures)(
    `${stage} consumes the unique client's $error.code semantic rather than HTTP status`,
    async ({ error, status, reason, http }) => {
      const f = await ready();
      const provider = vi
        .spyOn(f.options.storage, stage)
        .mockRejectedValue(error);
      await expect(f.reader.open('account', f.token)).rejects.toMatchObject({
        status,
        reason,
      });
      const response = await f.http.readOriginal(new Request(f.url));
      expect(response.status).toBe(http);
      const body = await response.text();
      expect(body).not.toContain(f.token);
      expect(body).not.toContain('Kodo');
      expect(body).not.toContain('X-Amz-');
      expect(provider).toHaveBeenCalledTimes(2);
      expect(f.audit).not.toHaveBeenCalled();
    },
  );

it('does not recover a revoked or expired app ticket when storage reports authentication errors', async () => {
  const f = await ready();
  const provider = vi
    .spyOn(f.options.storage, 'statObject')
    .mockRejectedValue(new KodoError('unauthorized', 400));
  f.deny();
  expect((await f.http.readOriginal(new Request(f.url))).status).toBe(404);
  f.allow();
  f.advance(60000);
  expect((await f.http.readOriginal(new Request(f.url))).status).toBe(404);
  expect(provider).not.toHaveBeenCalled();
  expect(f.audit).not.toHaveBeenCalled();
});
it('drops unknown upstream diagnostics and never returns a signing URL or cause', async () => {
  const f = await ready();
  const diagnostic =
    'https://s3.example.invalid/private?X-Amz-Signature=synthetic-secret';
  vi.spyOn(f.options.storage, 'openObject').mockRejectedValue(
    new Error(diagnostic),
  );
  const caught = await f.reader
    .open('account', f.token)
    .catch((error: unknown) => error);
  expect(caught).toMatchObject({
    status: 'unavailable',
    reason: 'original_storage_unavailable',
  });
  expect(String(caught)).not.toContain('X-Amz-');
  expect(caught).not.toHaveProperty('cause');
  const response = await f.http.readOriginal(new Request(f.url));
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain(diagnostic);
  expect(f.audit).not.toHaveBeenCalled();
});

it('preserves an explicit application denial raised by an injected storage boundary', async () => {
  const f = await ready();
  const denied = new UploadError('not_found', 'original_not_found');
  vi.spyOn(f.options.storage, 'openObject').mockRejectedValue(denied);
  await expect(f.reader.open('account', f.token)).rejects.toBe(denied);
  expect((await f.http.readOriginal(new Request(f.url))).status).toBe(404);
  expect(f.audit).not.toHaveBeenCalled();
});
