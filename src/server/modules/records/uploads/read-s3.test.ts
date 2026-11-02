import { expect, it, vi } from 'vitest';
import { createKodoClient } from '../../../integrations/kodo';
import { fixture } from '../../../../../tests/fixtures/upload-fake';
import { createUploadService } from './service';
import { createOriginalReader } from './read';
import { createUploadHttpHandlers } from './http';

// Synthetic envelopes only. Code/status reproduce the reviewed #48 evidence;
// no provider object, credential file, real signed URL or network request.
async function ready(
  reply: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const f = fixture();
  const service = createUploadService(f.options);
  const upload = await service.request('account', f.request);
  await f.put(upload.objectKey);
  const archived = await service.complete('account', {
    uploadId: upload.uploadId,
    operationId: 'demo-s3-complete',
    receiptRef: 'demo-notification',
    expectedRevision: 1,
  });
  const transport = vi.fn<typeof fetch>(async (input, init) =>
    reply(String(input), init),
  );
  const storage = createKodoClient(
    {
      endpoint: 'https://demo.s3.cn-east-1.qiniucs.com',
      uploadEndpoint: 'https://upload.invalid',
      managementEndpoint: 'https://manage.invalid',
      bucket: 'demo-bucket',
      accessKey: 'demo-access-key',
      secretKey: 'demo-secret-key',
    },
    { fetch: transport, now: f.now },
  );
  vi.spyOn(f.options.storage, 'openObject').mockImplementation((input) =>
    storage.openObject(input),
  );
  const reader = createOriginalReader(f.options);
  const grant = await reader.grant('account', {
    originalId: archived.originalId,
    originalVersionId: archived.originalVersionId,
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
    transport,
    url,
    token: url.searchParams.get('ticket')!,
  };
}
const xml = (code: string) =>
  `<Error><Code>${code}</Code><Message>演示：读取失败</Message></Error>`;
const failed = (body: string, status = 400) =>
  new Response(body, {
    status,
    headers: { 'content-type': 'application/xml' },
  });
const noProviderSecrets = (value: string) => {
  expect(value).not.toContain('X-Amz-');
  expect(value).not.toContain('demo-access-key');
  expect(value).not.toContain('demo-secret-key');
  expect(value).not.toContain('qiniucs.com');
};
it.each([
  ['ExpiredToken', 'original_storage_expired'],
  ['NotSupportAnonymous', 'original_storage_unauthorized'],
] as const)(
  'actual client maps reviewed S3 400/%s through the private 873 boundary',
  async (code, reason) => {
    const f = await ready(() => failed(xml(code)));
    const caught = await f.reader
      .open('account', f.token)
      .catch((error: unknown) => error);
    expect(caught).toMatchObject({ status: 'unavailable', reason });
    expect(caught).not.toHaveProperty('cause');
    noProviderSecrets(String(caught));
    const response = await f.http.readOriginal(new Request(f.url));
    expect(response.status).toBe(503);
    const body = await response.text();
    noProviderSecrets(body);
    expect(body).not.toContain(code);
    expect(body).not.toContain(f.token);
    expect(f.audit).not.toHaveBeenCalled();
    expect(f.transport).toHaveBeenCalledTimes(2);
    for (const [input] of f.transport.mock.calls)
      expect(new URL(String(input)).searchParams.get('X-Amz-Algorithm')).toBe(
        'AWS4-HMAC-SHA256',
      );
  },
);
it.each([
  xml('InvalidArgument'),
  xml('UnknownError'),
  xml('SignatureDoesNotMatch'),
  '<Error><Message>ExpiredToken</Message></Error>',
  '<Error><Code>ExpiredToken',
])(
  'does not reinterpret arbitrary S3 400 body %s as authentication',
  async (body) => {
    const f = await ready(() => failed(body));
    const response = await f.http.readOriginal(new Request(f.url));
    expect(response.status).toBe(400);
    const value = await response.json();
    expect(value.status).toBe('validation_error');
    noProviderSecrets(JSON.stringify(value));
    expect(f.transport).toHaveBeenCalledOnce();
    expect(f.audit).not.toHaveBeenCalled();
  },
);
it.each([
  [401, 503],
  [403, 503],
  [404, 404],
  [500, 503],
] as const)(
  'keeps HTTP %i on the existing provider classification',
  async (status, expected) => {
    const f = await ready(() => failed(xml('ExpiredToken'), status));
    const response = await f.http.readOriginal(new Request(f.url));
    expect(response.status).toBe(expected);
    noProviderSecrets(await response.text());
    expect(f.transport).toHaveBeenCalledOnce();
    expect(f.audit).not.toHaveBeenCalled();
  },
);
it.each([false, true])(
  'returns exact authorized S3 bytes and range=%s with no provider capability',
  async (range) => {
    const f = await ready((_url, init) => {
      expect(new Headers(init?.headers).get('range')).toBe(
        range ? 'bytes=0-2' : null,
      );
      return new Response(range ? '演' : '演示x', {
        status: range ? 206 : 200,
        headers: {
          'content-type': 'text/plain',
          'content-length': range ? '3' : '7',
          ...(range ? { 'content-range': 'bytes 0-2/7' } : {}),
          'x-provider-private': 'synthetic-diagnostic',
        },
      });
    });
    const response = await f.http.readOriginal(
      new Request(f.url, {
        headers: range ? { range: 'bytes=0-2' } : {},
      }),
    );
    expect(response.status).toBe(range ? 206 : 200);
    expect(await response.text()).toBe(range ? '演' : '演示x');
    expect(response.headers.get('x-provider-private')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    noProviderSecrets(JSON.stringify(Object.fromEntries(response.headers)));
    expect(f.audit).toHaveBeenCalledOnce();
    expect(JSON.stringify(f.audit.mock.calls)).not.toContain(f.token);
  },
);
it('checks current revocation and app-ticket expiry before the actual client transport', async () => {
  const f = await ready(() => failed(xml('ExpiredToken')));
  f.deny();
  expect((await f.http.readOriginal(new Request(f.url))).status).toBe(404);
  f.allow();
  f.advance(60000);
  expect((await f.http.readOriginal(new Request(f.url))).status).toBe(404);
  expect(f.transport).not.toHaveBeenCalled();
});
it('drops an actual transport error containing its synthetic presigned URL', async () => {
  const f = await ready((url) => {
    throw new Error(url);
  });
  const response = await f.http.readOriginal(new Request(f.url));
  expect(response.status).toBe(503);
  noProviderSecrets(await response.text());
  expect(f.audit).not.toHaveBeenCalled();
  expect(f.transport).toHaveBeenCalledOnce();
});
