import { describe, expect, it } from 'vitest';
import { fixture } from '../../../../../tests/fixtures/upload-fake';
import { createRecordCollectionService } from './collections';
import type { DefaultIntakeNode } from './default-node';
import { createMaterialUploadHttpHandlers } from './material-http';
import { createUploadService } from './service';

const origin = 'https://app.test';
function handlers(
  account: string | null = 'account',
  writable = true,
  defaults: { node: DefaultIntakeNode } = {
    node: { status: 'resolved', evaluationNodeId: 'demo-node' },
  },
) {
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
      defaultNode: async () => defaults.node,
      stagedNode: async (accountId, operationId) => {
        const target = f
          .snapshot()
          .collections.find(
            (c) =>
              c.creatorAccountId === accountId && c.operationId === operationId,
          )?.target;
        return target?.kind === 'unassigned' ? target.evaluationNodeId : null;
      },
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
    const body = { operationId: 'stage-1' };
    const first = await http.createCollection(post(body));
    expect(first.status).toBe(200);
    const created = await first.json();
    expect(created).toMatchObject({
      status: 'success',
      evaluationNodeId: 'demo-node',
    });
    expect(await (await http.createCollection(post(body))).json()).toEqual(
      created,
    );
    expect(f.snapshot().collections).toEqual([
      expect.objectContaining({
        target: { kind: 'unassigned', evaluationNodeId: 'demo-node' },
      }),
    ]);
  });

  it('replays a created collection on its own node after the default node changes', async () => {
    const defaults: { node: DefaultIntakeNode } = {
      node: { status: 'resolved', evaluationNodeId: 'demo-node' },
    };
    const { http } = handlers('account', true, defaults);
    const body = { operationId: 'stage-1' };
    const created = await (await http.createCollection(post(body))).json();
    defaults.node = { status: 'default_node_ambiguous' };
    const replayed = await http.createCollection(post(body));
    expect(replayed.status).toBe(200);
    expect(await replayed.json()).toEqual(created);
    defaults.node = { status: 'resolved', evaluationNodeId: 'demo-node-2' };
    expect(await (await http.createCollection(post(body))).json()).toEqual(
      created,
    );
  });

  it('keeps method, origin, session and permission checks on the server', async () => {
    const body = { operationId: 'stage-1' };
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
      post({ operationId: 'stage-1', evaluationNodeId: 'demo-node' }),
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      status: 'validation_error',
      input: { operationId: 'stage-1', evaluationNodeId: 'demo-node' },
    });
  });

  it('answers a missing or ambiguous default node without creating a collection', async () => {
    for (const status of [
      'default_node_missing',
      'default_node_ambiguous',
    ] as const) {
      const { f, http } = handlers('account', true, { node: { status } });
      const response = await http.createCollection(
        post({ operationId: 'stage-1' }),
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ status });
      expect(f.snapshot().collections).toEqual([]);
    }
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
      result: {
        status: 'staged',
        uploadId: grant.upload.uploadId,
        source: null,
      },
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
        defaultNode: async () => ({ status: 'default_node_missing' }),
        stagedNode: async () => null,
      }),
    ).toThrow();
  });
});
