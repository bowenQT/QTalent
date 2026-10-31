import { expect, it } from 'vitest';
import { fixture } from '../../../../../tests/fixtures/upload-fake';
import { createUploadService } from './service';
import { readValidatedUpload } from './handoff';
import {
  createRecordCollectionService,
  type CollectionBinding,
} from './collections';
function setup() {
  const f = fixture();
  let writable = true;
  let binding: CollectionBinding = {
    state: 'draft',
    externalAttachmentCount: 0,
  };
  let canonical: string | null = null;
  const service = createRecordCollectionService({
    store: f.options.store,
    now: f.options.now,
    async canWriteTarget() {
      return writable;
    },
    async loadBinding() {
      return binding;
    },
    async collectionForEvent() {
      return canonical;
    },
  });
  return {
    ...f,
    service,
    deny() {
      writable = false;
    },
    bind(id: string) {
      canonical = id;
      binding = {
        state: 'saved',
        eventIds: ['event-1', 'event-2'],
        externalAttachmentCount: 2,
      };
    },
  };
}
it('issues a server identity idempotently and rejects changed target under one creation operation', async () => {
  const f = setup();
  const input = { operationId: 'create', target: f.request.target };
  const [a, b] = await Promise.all([
    f.service.create('account', input),
    f.service.create('account', input),
  ]);
  expect(a).toEqual(b);
  expect(a.id).toMatch(/^[a-f0-9-]{36}$/);
  expect(f.snapshot().collections).toHaveLength(1);
  await expect(
    f.service.create('account', {
      ...input,
      target: { kind: 'people', personIds: ['different'] },
    }),
  ).rejects.toMatchObject({ status: 'conflict' });
  f.deny();
  await expect(f.service.create('account', input)).rejects.toMatchObject({
    status: 'forbidden',
  });
});
it('denies anonymous creation and never creates a second quota bucket from an event alias', async () => {
  const f = setup();
  await expect(
    f.service.create(null, { operationId: 'create', target: f.request.target }),
  ).rejects.toMatchObject({ status: 'unauthenticated' });
  await expect(
    f.service.create('account', {
      operationId: 'create',
      target: { kind: 'event', eventId: 'event-1' },
    }),
  ).rejects.toMatchObject({ status: 'conflict' });
  expect(f.snapshot().collections).toHaveLength(0);
});
it('checks draft ownership, immutable target and unknown collection IDs', async () => {
  const f = setup();
  const collection = await f.service.create('account', {
    operationId: 'create',
    target: f.request.target,
  });
  const input = { recordCollectionId: collection.id, target: f.request.target };
  expect(await f.service.resolveWriteTarget('account', input)).toMatchObject({
    recordCollectionId: collection.id,
    quotaScope: collection.id,
    externalAttachmentCount: 0,
  });
  expect(await f.service.resolveWriteTarget('other', input)).toBeNull();
  expect(
    await f.service.resolveWriteTarget('account', {
      ...input,
      recordCollectionId: 'unknown',
    }),
  ).toBeNull();
  expect(
    await f.service.resolveWriteTarget('account', {
      ...input,
      target: { kind: 'people', personIds: ['different'] },
    }),
  ).toBeNull();
});
it('uses the saved ledger for multiple event aliases and current permission, without inferring an event relation', async () => {
  const f = setup();
  const collection = await f.service.create('account', {
    operationId: 'create',
    target: f.request.target,
  });
  const input = {
    recordCollectionId: collection.id,
    target: { kind: 'event' as const, eventId: 'event-1' },
  };
  expect(await f.service.resolveWriteTarget('account', input)).toBeNull();
  f.bind(collection.id);
  expect(
    await f.service.resolveWriteTarget('collaborator', input),
  ).toMatchObject({ quotaScope: collection.id, externalAttachmentCount: 2 });
  expect(
    await f.service.resolveWriteTarget('collaborator', {
      ...input,
      target: { kind: 'event', eventId: 'event-2' },
    }),
  ).not.toBeNull();
  expect(
    await f.service.resolveWriteTarget('collaborator', {
      ...input,
      target: { kind: 'event', eventId: 'unlinked' },
    }),
  ).toBeNull();
  f.deny();
  expect(await f.service.resolveWriteTarget('account', input)).toBeNull();
});
it('releases a draft membership idempotently without deleting a verified original, and restores the quota slot', async () => {
  const f = setup();
  const collection = await f.service.create('account', {
    operationId: 'create',
    target: f.request.target,
  });
  const upload = createUploadService({
    ...f.options,
    policy: {
      ...f.options.policy,
      resolveWriteTarget: f.service.resolveWriteTarget,
    },
  });
  const request = { ...f.request, recordCollectionId: collection.id };
  const grants = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      upload.request('account', { ...request, operationId: `request-${i}` }),
    ),
  );
  await f.put(grants[0].objectKey);
  const command = {
    uploadId: grants[0].uploadId,
    receiptRef: 'notice',
    operationId: 'complete',
    expectedRevision: 1,
  };
  const completed = await upload.complete('account', command);
  const release = {
    uploadId: grants[0].uploadId,
    operationId: 'remove',
    expectedRevision: 2,
  };
  const removed = await f.service.release('account', release);
  await expect(f.service.release('account', release)).resolves.toEqual(removed);
  await expect(
    upload.request('account', { ...request, operationId: 'replacement' }),
  ).resolves.toHaveProperty('uploadId');
  expect(f.snapshot().objects).toHaveLength(1);
  expect(await readValidatedUpload(f.options.store, completed)).not.toBeNull();
  await expect(upload.complete('account', command)).rejects.toMatchObject({
    status: 'conflict',
    reason: 'upload_removed',
  });
  await expect(
    f.service.release('account', { ...release, expectedRevision: 3 }),
  ).rejects.toMatchObject({ status: 'conflict' });
});
it('denies release by another account or after the save ledger has bound the collection', async () => {
  const f = setup();
  const collection = await f.service.create('account', {
    operationId: 'create',
    target: f.request.target,
  });
  const upload = createUploadService({
    ...f.options,
    policy: {
      ...f.options.policy,
      resolveWriteTarget: f.service.resolveWriteTarget,
    },
  });
  const grant = await upload.request('account', {
    ...f.request,
    recordCollectionId: collection.id,
  });
  const input = {
    uploadId: grant.uploadId,
    operationId: 'remove',
    expectedRevision: 1,
  };
  await expect(f.service.release('other', input)).rejects.toMatchObject({
    status: 'not_found',
  });
  f.bind(collection.id);
  await expect(f.service.release('account', input)).rejects.toMatchObject({
    status: 'conflict',
    reason: 'collection_saved',
  });
  expect(f.snapshot().intents[0].releasedAt).toBeNull();
});

it('requires current write permission and canonical mapping for EVERY saved event even through the original people target', async () => {
  const f = fixture();
  let binding: CollectionBinding = {
    state: 'draft',
    externalAttachmentCount: 0,
  };
  const allowed = new Set(['event-1']);
  let collectionId = '';
  let secondCanonical = '';
  const service = createRecordCollectionService({
    store: f.options.store,
    now: f.options.now,
    async canWriteTarget(_accountId, target) {
      return target.kind === 'people' || allowed.has(target.eventId);
    },
    async loadBinding() {
      return binding;
    },
    async collectionForEvent(eventId) {
      return eventId === 'event-2' ? secondCanonical : collectionId;
    },
  });
  collectionId = (
    await service.create('account', {
      operationId: 'create',
      target: f.request.target,
    })
  ).id;
  secondCanonical = collectionId;
  binding = {
    state: 'saved',
    eventIds: ['event-1', 'event-2'],
    externalAttachmentCount: 0,
  };
  for (const target of [
    f.request.target,
    { kind: 'event' as const, eventId: 'event-1' },
  ]) {
    expect(
      await service.resolveWriteTarget('account', {
        recordCollectionId: collectionId,
        target,
      }),
    ).toBeNull();
  }
  allowed.add('event-2');
  secondCanonical = 'different-collection';
  expect(
    await service.resolveWriteTarget('account', {
      recordCollectionId: collectionId,
      target: f.request.target,
    }),
  ).toBeNull();
  secondCanonical = collectionId;
  expect(
    await service.resolveWriteTarget('account', {
      recordCollectionId: collectionId,
      target: f.request.target,
    }),
  ).toMatchObject({ recordCollectionId: collectionId });
});
