import { describe, expect, it, vi } from 'vitest';
import { createUploadService } from './service';
import { fixture } from '../../../../../tests/fixtures/upload-fake';

describe('authorized immutable upload lifecycle', () => {
  it('never signs beyond the collection window but still replays an already completed fact after expiry', async () => {
    const f = fixture();
    const deadline = f.now() + 60000;
    vi.spyOn(f.options.policy, 'resolveWriteTarget').mockResolvedValue({
      recordCollectionId: f.request.recordCollectionId,
      quotaScope: f.request.recordCollectionId,
      externalAttachmentCount: 0,
      collectionExpiresAt: deadline,
    });
    const s = createUploadService(f.options);
    const grant = await s.request('account', f.request);
    expect(Date.parse(grant.expiresAt)).toBe(deadline);
    await f.put(grant.objectKey);
    const command = {
      uploadId: grant.uploadId,
      receiptRef: 'notice',
      operationId: 'complete',
      expectedRevision: 1,
    };
    const done = await s.complete('account', command);
    f.advance(60001);
    await expect(s.complete('account', command)).resolves.toEqual(done);
    await expect(
      s.request('account', { ...f.request, operationId: 'new' }),
    ).rejects.toMatchObject({
      status: 'conflict',
      reason: 'record_collection_expired',
    });
  });
  it('resolves the supplied collection on the server and preserves its identity in grant and completion', async () => {
    const f = fixture();
    const lookup = vi.spyOn(f.options.policy, 'resolveWriteTarget');
    const service = createUploadService(f.options);
    const grant = await service.request('account', f.request);
    expect(lookup).toHaveBeenCalledWith('account', {
      recordCollectionId: f.request.recordCollectionId,
      target: f.request.target,
    });
    expect(grant.recordCollectionId).toBe(f.request.recordCollectionId);
    await f.put(grant.objectKey);
    const result = await service.complete('account', {
      uploadId: grant.uploadId,
      receiptRef: 'notice',
      operationId: 'complete',
      expectedRevision: 1,
    });
    expect(result).toMatchObject({
      recordCollectionId: f.request.recordCollectionId,
      source: null,
    });
    await expect(
      service.request('account', {
        ...f.request,
        recordCollectionId: 'unowned-collection',
        operationId: 'forged-collection',
      }),
    ).rejects.toMatchObject({ status: 'forbidden' });
  });
  it('includes authoritative pre-existing attachments and fails closed when the count is unknown', async () => {
    const f = fixture();
    const policy = vi
      .spyOn(f.options.policy, 'resolveWriteTarget')
      .mockResolvedValue({
        recordCollectionId: f.request.recordCollectionId,
        quotaScope: 'trusted-record-collection-1',
        externalAttachmentCount: 9,
      });
    const s = createUploadService(f.options);
    await s.request('account', f.request);
    await expect(
      s.request('other', { ...f.request, operationId: 'eleventh' }),
    ).rejects.toMatchObject({
      status: 'validation_error',
      reason: 'attachment_limit',
    });
    policy.mockResolvedValue({
      recordCollectionId: f.request.recordCollectionId,
      quotaScope: 'trusted-record-collection-1',
      externalAttachmentCount: NaN,
    });
    await expect(
      s.request('account', { ...f.request, operationId: 'unknown-count' }),
    ).rejects.toMatchObject({ status: 'unavailable' });
  });
  it('rejects anonymous/forbidden before issuing any credential or reservation', async () => {
    const f = fixture();
    const s = createUploadService(f.options);
    await expect(s.request(null, f.request)).rejects.toMatchObject({
      status: 'unauthenticated',
    });
    f.deny();
    await expect(s.request('hr-outside', f.request)).rejects.toMatchObject({
      status: 'forbidden',
    });
    expect(f.snapshot().intents).toHaveLength(0);
  });
  it('validates the contract and honestly rejects unsupported adapter capacity', async () => {
    const f = fixture();
    const s = createUploadService(f.options);
    await expect(
      s.request('account', { ...f.request, objectKey: 'chosen-by-client' }),
    ).rejects.toMatchObject({ status: 'validation_error' });
    await expect(
      s.request('account', { ...f.request, declaredBytes: 1024 ** 3 + 1 }),
    ).rejects.toMatchObject({ status: 'unavailable', reason: 'adapter_limit' });
  });
  it('reserves a server key and renews only the same immutable request within a bounded intent', async () => {
    const f = fixture();
    const s = createUploadService(f.options);
    const first = await s.request('account', f.request);
    expect(first.objectKey).toMatch(/^uploads\/[a-f0-9-]+\/original$/);
    expect(Date.parse(first.expiresAt) - f.now()).toBeLessThanOrEqual(300000);
    f.advance(301000);
    const renewed = await s.request('account', f.request);
    expect(renewed.objectKey).toBe(first.objectKey);
    expect(Date.parse(renewed.expiresAt)).toBeGreaterThan(
      Date.parse(first.expiresAt),
    );
    expect(f.snapshot().intents).toHaveLength(1);
    await expect(
      s.request('account', { ...f.request, filename: 'other.txt' }),
    ).rejects.toMatchObject({ status: 'conflict' });
    f.deny();
    await expect(s.request('account', f.request)).rejects.toMatchObject({
      status: 'forbidden',
    });
  });
  it('enforces ten reservations across accounts for the trusted record collection', async () => {
    const f = fixture();
    const s = createUploadService(f.options);
    const results = await Promise.allSettled(
      Array.from({ length: 11 }, (_, i) =>
        s.request(`account-${i}`, { ...f.request, operationId: `r-${i}` }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
    expect(f.snapshot().intents).toHaveLength(10);
    f.advance(24 * 60 * 60 * 1000 + 1);
    await expect(
      s.request('account', { ...f.request, operationId: 'after-expiry' }),
    ).resolves.toHaveProperty('uploadId');
  });
  it('does not trust a receipt or another account and rechecks current write permission', async () => {
    const f = fixture();
    const s = createUploadService(f.options);
    const g = await s.request('account', f.request);
    const command = {
      uploadId: g.uploadId,
      receiptRef: 'forged-success',
      operationId: 'complete-1',
      expectedRevision: 1,
    };
    await expect(s.complete('other', command)).rejects.toMatchObject({
      status: 'not_found',
    });
    await expect(s.complete('account', command)).rejects.toMatchObject({
      status: 'validation_error',
      reason: 'object_missing',
    });
    f.deny();
    await expect(s.complete('account', command)).rejects.toMatchObject({
      status: 'forbidden',
    });
    expect(f.snapshot().objects).toHaveLength(0);
  });
  it.each(['size', 'mime', 'content'])(
    'rejects %s spoofing without records or dispatch',
    async (kind) => {
      const f = fixture();
      const s = createUploadService(f.options);
      const g = await s.request('account', f.request);
      await f.put(
        g.objectKey,
        kind === 'size'
          ? new Uint8Array([1])
          : kind === 'content'
            ? new Uint8Array(7)
            : undefined,
        kind === 'mime' ? 'application/pdf' : undefined,
      );
      await expect(
        s.complete('account', {
          uploadId: g.uploadId,
          receiptRef: 'receipt',
          operationId: 'c',
          expectedRevision: 1,
        }),
      ).rejects.toMatchObject({ status: 'validation_error' });
      expect(f.snapshot().objects).toHaveLength(0);
      expect(f.snapshot().jobs).toHaveLength(0);
    },
  );
  it('completes after token expiry without inventing a source and dispatches exactly once', async () => {
    const f = fixture();
    const s = createUploadService(f.options);
    const g = await s.request('account', f.request);
    await f.put(g.objectKey);
    f.advance(301000);
    const command = {
      uploadId: g.uploadId,
      receiptRef: 'receipt',
      operationId: 'complete',
      expectedRevision: 1,
    };
    const [a, b] = await Promise.all([
      s.complete('account', command),
      s.complete('account', command),
    ]);
    expect(a).toEqual(b);
    expect(a.source).toBeNull();
    expect(a.revision).toBe(2);
    expect(f.snapshot().objects[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(f.snapshot().jobs).toHaveLength(1);
    await expect(
      s.complete('account', { ...command, receiptRef: 'other' }),
    ).rejects.toMatchObject({ status: 'conflict' });
    f.deny();
    await expect(s.complete('account', command)).rejects.toMatchObject({
      status: 'forbidden',
    });
  });
  it('checks revision and rolls back all archive writes when dispatch fails', async () => {
    const f = fixture();
    const s = createUploadService(f.options);
    const g = await s.request('account', f.request);
    await f.put(g.objectKey);
    const command = {
      uploadId: g.uploadId,
      receiptRef: 'receipt',
      operationId: 'complete',
      expectedRevision: 1,
    };
    await expect(
      s.complete('account', { ...command, expectedRevision: 2 }),
    ).rejects.toMatchObject({ status: 'conflict' });
    f.failDispatch(true);
    await expect(s.complete('account', command)).rejects.toMatchObject({
      status: 'unavailable',
    });
    expect(f.snapshot().objects).toHaveLength(0);
    expect(f.snapshot().intents[0].completed).toBeNull();
    f.failDispatch(false);
    await expect(s.complete('account', command)).resolves.toHaveProperty(
      'jobId',
    );
  });
  it('rechecks authorization after external content reads and before the transaction commits', async () => {
    const f = fixture();
    const s = createUploadService(f.options);
    const g = await s.request('account', f.request);
    await f.put(g.objectKey);
    const original = f.options.storage.openObject;
    vi.spyOn(f.options.storage, 'openObject').mockImplementation(
      async (input) => {
        const result = await original(input);
        f.deny();
        return result;
      },
    );
    await expect(
      s.complete('account', {
        uploadId: g.uploadId,
        receiptRef: 'receipt',
        operationId: 'c',
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ status: 'forbidden' });
    expect(f.snapshot().objects).toHaveLength(0);
  });
});
