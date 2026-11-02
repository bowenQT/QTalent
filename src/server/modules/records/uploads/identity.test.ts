import { describe, expect, it, vi } from 'vitest';
import { fixture } from '../../../../../tests/fixtures/upload-fake';
import { createUploadService } from './service';
import { readValidatedUpload } from './handoff';
import { createRecordCollectionService } from './collections';

async function completed() {
  const f = fixture();
  const service = createUploadService(f.options);
  const grant = await service.request('account', f.request);
  await f.put(grant.objectKey);
  const result = await service.complete('account', {
    uploadId: grant.uploadId,
    receiptRef: 'synthetic notice',
    operationId: 'complete',
    expectedRevision: grant.revision,
  });
  return { f, service, grant, result };
}

describe('explicit upload collection identity', () => {
  it('carries the stored collection identity into the worker fact without deriving it from quota', async () => {
    const { f, result } = await completed();
    expect(f.snapshot().intents[0]).toHaveProperty(
      'recordCollectionId',
      f.request.recordCollectionId,
    );
    expect(await readValidatedUpload(f.options.store, result)).toMatchObject({
      recordCollectionId: f.request.recordCollectionId,
    });
  });

  it('refuses an arbitrary quota alias before creating an intent or signing a grant', async () => {
    const f = fixture();
    vi.spyOn(f.options.policy, 'resolveWriteTarget').mockResolvedValue({
      recordCollectionId: f.request.recordCollectionId,
      quotaScope: 'not-a-collection-identity',
      externalAttachmentCount: 0,
    });
    const sign = vi.spyOn(f.options.storage, 'issueUploadGrant');
    await expect(
      createUploadService(f.options).request('account', f.request),
    ).rejects.toMatchObject({
      status: 'unavailable',
      reason: 'record_collection_unresolved',
    });
    expect(sign).not.toHaveBeenCalled();
    expect(f.snapshot().intents).toHaveLength(0);
  });

  it.each(['missing', 'different'])(
    'does not recover a %s explicit identity from quota or request JSON on completion',
    async (mode) => {
      const f = fixture();
      const service = createUploadService(f.options);
      const grant = await service.request('account', f.request);
      await f.put(grant.objectKey);
      await f.options.store.transaction([], async (tx) => {
        const intent = await tx.findIntent(grant.uploadId);
        if (mode === 'missing')
          Reflect.deleteProperty(intent!, 'recordCollectionId');
        else
          Object.assign(intent!, {
            recordCollectionId: 'different-collection',
          });
      });
      const stat = vi.spyOn(f.options.storage, 'statObject');
      await expect(
        service.complete('account', {
          uploadId: grant.uploadId,
          receiptRef: 'notice',
          operationId: 'complete',
          expectedRevision: 1,
        }),
      ).rejects.toMatchObject({
        status: 'conflict',
        reason: 'record_collection_changed',
      });
      expect(stat).not.toHaveBeenCalled();
    },
  );

  it('refuses a completion that claims a different collection even when the object/version matches', async () => {
    const { f, result } = await completed();
    await f.options.store.transaction([], async (tx) => {
      const intent = await tx.findIntent(result.uploadId);
      intent!.completed!.recordCollectionId = 'different-collection';
    });
    expect(await readValidatedUpload(f.options.store, result)).toBeNull();
  });
});

it('rejects renewal if the stored identity disappeared rather than signing from request JSON', async () => {
  const f = fixture();
  const service = createUploadService(f.options);
  const grant = await service.request('account', f.request);
  await f.options.store.transaction([], async (tx) => {
    Reflect.deleteProperty(
      (await tx.findIntent(grant.uploadId))!,
      'recordCollectionId',
    );
  });
  const sign = vi.spyOn(f.options.storage, 'issueUploadGrant');
  await expect(service.request('account', f.request)).rejects.toMatchObject({
    status: 'conflict',
    reason: 'operation_payload_changed',
  });
  expect(sign).not.toHaveBeenCalled();
});
it('rejects release before consulting bindings when the stored collection identity is absent', async () => {
  const f = fixture();
  const grant = await createUploadService(f.options).request(
    'account',
    f.request,
  );
  await f.options.store.transaction([], async (tx) => {
    Reflect.deleteProperty(
      (await tx.findIntent(grant.uploadId))!,
      'recordCollectionId',
    );
  });
  const loadBinding = vi.fn(async () => ({
    state: 'draft' as const,
    externalAttachmentCount: 0,
  }));
  const collections = createRecordCollectionService({
    store: f.options.store,
    loadBinding,
    canWriteTarget: async () => true,
    collectionForEvent: async () => null,
  });
  await expect(
    collections.release('account', {
      uploadId: grant.uploadId,
      operationId: 'release',
      expectedRevision: 1,
    }),
  ).rejects.toMatchObject({
    status: 'conflict',
    reason: 'record_collection_changed',
  });
  expect(loadBinding).not.toHaveBeenCalled();
});
