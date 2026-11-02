import { describe, expect, it } from 'vitest';
import { fixture } from '../../../../../tests/fixtures/upload-fake';
import { createRecordCollectionService } from './collections';
import { createMaterialUploadHttpHandlers } from './material-http';
import { createUploadService } from './service';

const origin = 'https://app.test';
function handlers(account: string | null = 'account', writable = true) {
  const f = fixture();
  const collections = createRecordCollectionService({
    store: f.options.store,
    now: f.options.now,
    async canWriteTarget(_accountId, target) {
      return writable && target.kind === 'unassigned';
    },
    async loadBinding() {
      return { state: 'draft', externalAttachmentCount: 0 };
    },
    async collectionForEvent() {
      return null;
    },
  });
  return {
    f,
    http: createMaterialUploadHttpHandlers({
      collections,
      service: createUploadService(f.options),
      trustedOrigin: `${origin}/`,
      authenticate: async () => account,
    }),
  };
}
const post = (body: unknown, from = origin, method = 'POST') =>
  new Request(`${origin}/api/record/uploads`, {
    method,
    headers: { origin: from, 'content-type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });

describe('material upload HTTP boundary', () => {
  it('creates a staging collection for the chosen node and replays it', async () => {
    const { f, http } = handlers();
    const body = { operationId: 'stage-1', evaluationNodeId: 'demo-node' };
    const first = await http.createCollection(post(body));
    expect(first.status).toBe(200);
    const created = await first.json();
    expect(created).toMatchObject({ status: 'success' });
    expect(await (await http.createCollection(post(body))).json()).toEqual(
      created,
    );
    expect(f.snapshot().collections).toEqual([
      expect.objectContaining({
        target: { kind: 'unassigned', evaluationNodeId: 'demo-node' },
      }),
    ]);
  });

  it('keeps method, origin, session and permission checks on the server', async () => {
    const body = { operationId: 'stage-1', evaluationNodeId: 'demo-node' };
    expect(
      (await handlers().http.createCollection(post(body, origin, 'GET')))
        .status,
    ).toBe(405);
    expect(
      (
        await handlers().http.createCollection(
          post(body, 'https://elsewhere.invalid'),
        )
      ).status,
    ).toBe(403);
    expect(
      (await handlers(null).http.createCollection(post(body))).status,
    ).toBe(401);
    expect(
      (await handlers('account', false).http.createCollection(post(body)))
        .status,
    ).toBe(403);
    const invalid = await handlers().http.createCollection(
      post({ operationId: 'stage-1' }),
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      status: 'validation_error',
      input: { operationId: 'stage-1' },
    });
  });

  it('returns the grant and completion results under their contracts', async () => {
    const { f, http } = handlers();
    const requested = await http.requestUpload(
      post({
        ...f.request,
        target: { kind: 'unassigned', evaluationNodeId: 'demo-node' },
      }),
    );
    const grant = await requested.json();
    expect(grant).toMatchObject({ status: 'success' });
    await f.put(grant.upload.objectKey);
    const completed = await http.completeUpload(
      post({
        uploadId: grant.upload.uploadId,
        receiptRef: 'notice',
        operationId: 'complete-1',
        expectedRevision: grant.upload.revision,
      }),
    );
    expect(await completed.json()).toMatchObject({
      status: 'success',
      result: { uploadId: grant.upload.uploadId, source: null },
    });
    const unsupported = await http.requestUpload(
      post({
        ...f.request,
        filename: 'demo.gif',
        declaredMediaType: 'image/gif',
        purpose: 'image',
        operationId: 'gif',
        target: { kind: 'unassigned', evaluationNodeId: 'demo-node' },
      }),
    );
    expect(await unsupported.json()).toMatchObject({
      status: 'unsupported',
      reason: 'format',
    });
  });

  it('rejects an unsafe trusted origin at composition', () => {
    const f = fixture();
    expect(() =>
      createMaterialUploadHttpHandlers({
        collections: {} as never,
        service: createUploadService(f.options),
        trustedOrigin: 'ftp://app.test',
        authenticate: async () => 'account',
      }),
    ).toThrow();
  });
});
