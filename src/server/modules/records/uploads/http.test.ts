import { expect, it, vi } from 'vitest';
import {
  requestUploadResultSchema,
  completeUploadResultSchema,
} from '../../../../contracts/media';
import { fixture } from '../../../../../tests/fixtures/upload-fake';
import { createUploadService } from './service';
import { createOriginalReader } from './read';
import { createUploadHttpHandlers } from './http';
const origin = 'https://app.invalid';
function setup() {
  const f = fixture();
  const service = createUploadService(f.options);
  const reader = createOriginalReader(f.options);
  const authenticate = vi.fn<(headers: Headers) => Promise<string | null>>(
    async () => 'account',
  );
  const auditOriginalRead = vi.fn<
    (input: { accountId: string; ticketDigest: string }) => Promise<void>
  >(async () => {});
  return {
    ...f,
    service,
    reader,
    authenticate,
    auditOriginalRead,
    http: createUploadHttpHandlers({
      service,
      reader,
      authenticate,
      auditOriginalRead,
      trustedOrigin: origin,
    }),
  };
}
function post(path: string, input: unknown, requestOrigin = origin) {
  return new Request(`${origin}${path}`, {
    method: 'POST',
    headers: { origin: requestOrigin, 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}
it('rejects opaque origins in trusted server configuration', () => {
  const f = setup();
  expect(() =>
    createUploadHttpHandlers({
      service: f.service,
      reader: f.reader,
      authenticate: f.authenticate,
      auditOriginalRead: f.auditOriginalRead,
      trustedOrigin: 'data:text/plain,opaque',
    }),
  ).toThrow();
});
it('returns the actual safe reason when a completion notification has no stored object', async () => {
  const f = setup();
  const grant = await f.service.request('account', f.request);
  const response = await f.http.completeUpload(
    post('/uploads/complete', {
      uploadId: grant.uploadId,
      receiptRef: 'forged',
      operationId: 'complete',
      expectedRevision: 1,
    }),
  );
  expect(response.status).toBe(400);
  const body = await response.json();
  expect(body.fieldErrors.form).toContain(
    '尚未找到完整上传的文件，请完成上传后再重试',
  );
});
it('runs the real grant/completion schemas through authenticated request boundaries', async () => {
  const f = setup();
  const response = await f.http.requestUpload(post('/uploads', f.request));
  const body = requestUploadResultSchema.parse(await response.json());
  expect(response.status).toBe(200);
  expect(body.status).toBe('success');
  if (body.status !== 'success') throw new Error('Expected successful fixture');
  await f.put(body.upload.objectKey);
  const completed = await f.http.completeUpload(
    post('/uploads/complete', {
      uploadId: body.upload.uploadId,
      receiptRef: 'notice',
      operationId: 'complete',
      expectedRevision: 1,
    }),
  );
  expect(
    completeUploadResultSchema.parse(await completed.json()),
  ).toMatchObject({
    status: 'success',
    result: { source: null, recordCollectionId: f.request.recordCollectionId },
  });
});
it('denies anonymous and cross-origin commands before storage access', async () => {
  const f = setup();
  f.authenticate.mockResolvedValue(null);
  expect((await f.http.requestUpload(post('/uploads', f.request))).status).toBe(
    401,
  );
  f.authenticate.mockResolvedValue('account');
  f.authenticate.mockClear();
  expect(
    (
      await f.http.requestUpload(
        post('/uploads', f.request, 'https://other.invalid'),
      )
    ).status,
  ).toBe(403);
  expect(f.authenticate).not.toHaveBeenCalled();
  expect(f.snapshot().intents).toHaveLength(0);
});
it('does not accept a client account override and preserves invalid input', async () => {
  const f = setup();
  const input = { ...f.request, accountId: 'forged' };
  const response = await f.http.requestUpload(post('/uploads', input));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    status: 'validation_error',
    input,
  });
  expect(f.snapshot().intents).toHaveLength(0);
});
it('maps authentication dependency failures to unavailable without leaking diagnostics', async () => {
  const f = setup();
  f.authenticate.mockRejectedValue(
    new Error('JWKS https://private.invalid?key=secret'),
  );
  const response = await f.http.requestUpload(post('/uploads', f.request));
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('private.invalid');
});
it('rejects malformed or oversized metadata JSON and unsupported methods', async () => {
  const f = setup();
  const malformed = new Request(`${origin}/uploads`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: '{',
  });
  expect((await f.http.requestUpload(malformed)).status).toBe(400);
  expect(
    (await f.http.requestUpload(post('/uploads', 'x'.repeat(1024 * 1024 + 1))))
      .status,
  ).toBe(400);
  const wrongMethod = await f.http.requestUpload(
    new Request(`${origin}/uploads`),
  );
  expect(wrongMethod.status).toBe(405);
  expect(wrongMethod.headers.get('allow')).toBe('POST');
});
it('proxies a range through the session boundary and audits only the ticket digest', async () => {
  const f = setup();
  const grant = await f.service.request('account', f.request);
  await f.put(grant.objectKey);
  const done = await f.service.complete('account', {
    uploadId: grant.uploadId,
    receiptRef: 'notice',
    operationId: 'c',
    expectedRevision: 1,
  });
  const link = await f.reader.grant('account', {
    fragmentId: 'classified-fragment',
    originalVersionId: done.originalVersionId,
  });
  const response = await f.http.readOriginal(
    new Request(new URL(link.url, origin), { headers: { range: 'bytes=0-2' } }),
  );
  expect(response.status).toBe(206);
  expect(await response.text()).toBe('演');
  expect(f.auditOriginalRead).toHaveBeenCalledWith({
    accountId: 'account',
    ticketDigest: f.snapshot().tickets[0].digest,
  });
  expect(JSON.stringify(f.auditOriginalRead.mock.calls)).not.toContain(
    new URL(link.url, origin).searchParams.get('ticket')!,
  );
});
it('fails closed if required read auditing is unavailable', async () => {
  const f = setup();
  const grant = await f.service.request('account', f.request);
  await f.put(grant.objectKey);
  const done = await f.service.complete('account', {
    uploadId: grant.uploadId,
    receiptRef: 'notice',
    operationId: 'c',
    expectedRevision: 1,
  });
  const link = await f.reader.grant('account', {
    fragmentId: 'classified-fragment',
    originalVersionId: done.originalVersionId,
  });
  f.auditOriginalRead.mockRejectedValue(
    new Error('audit dependency unavailable'),
  );
  const response = await f.http.readOriginal(
    new Request(new URL(link.url, origin)),
  );
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('演示');
});
