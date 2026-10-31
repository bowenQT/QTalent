import { expect, it } from 'vitest';
import { fixture } from '../../../../../tests/fixtures/upload-fake';
import { createUploadService } from './service';
import { readValidatedUpload } from './handoff';

it('hands a committed verified original version to a worker with no fabricated fragment or parser output', async () => {
  const f = fixture();
  const service = createUploadService(f.options);
  const grant = await service.request('account', f.request);
  await expect(
    readValidatedUpload(f.options.store, {
      uploadId: grant.uploadId,
      originalVersionId: 'not-created',
    }),
  ).resolves.toBeNull();
  await f.put(grant.objectKey);
  const result = await service.complete('account', {
    uploadId: grant.uploadId,
    receiptRef: 'notice',
    operationId: 'complete',
    expectedRevision: 1,
  });
  const handoff = await readValidatedUpload(f.options.store, result);
  expect(handoff).toMatchObject({
    uploadId: result.uploadId,
    originalId: result.originalId,
    originalVersionId: result.originalVersionId,
    jobId: result.jobId,
    purpose: 'attachment',
    filename: 'demo.txt',
    accountId: 'account',
    object: {
      objectKey: grant.objectKey,
      byteLength: 7,
      mediaType: 'text/plain',
    },
  });
  expect(handoff!.object.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(handoff).not.toHaveProperty('fragmentId');
  expect(handoff).not.toHaveProperty('parseVersionId');
  await expect(
    readValidatedUpload(f.options.store, {
      uploadId: 'wrong-upload',
      originalVersionId: result.originalVersionId,
    }),
  ).resolves.toBeNull();
});

it('refuses an object mapping without the matching committed completion', async () => {
  const f = fixture();
  const service = createUploadService(f.options);
  const grant = await service.request('account', f.request);
  await f.options.store.transaction([], async (tx) => {
    const intent = await tx.findIntent(grant.uploadId);
    await tx.archiveAndDispatch(
      intent!,
      {
        objectKey: grant.objectKey,
        byteLength: 7,
        mediaType: 'text/plain',
        sha256: 'a'.repeat(64),
        etag: 'synthetic',
      },
      { originalId: 'partial-original', originalVersionId: 'partial-version' },
    );
  });
  await expect(
    readValidatedUpload(f.options.store, {
      uploadId: grant.uploadId,
      originalVersionId: 'partial-version',
    }),
  ).resolves.toBeNull();
});
