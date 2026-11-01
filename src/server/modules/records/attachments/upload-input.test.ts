import { describe, expect, it, vi } from 'vitest';
import { newJob } from '../../../jobs/state';
import { createValidatedAttachmentInput } from './upload-input';

function fixture() {
  const upload = {
    uploadId: 'upload',
    recordCollectionId: 'record',
    originalId: 'original',
    originalVersionId: 'version',
    jobId: 'job',
    purpose: 'attachment',
    filename: 'demo.txt',
    accountId: 'uploader',
    quotaScope: 'record',
    target: { kind: 'people', personIds: ['demo-person'] },
    object: {
      objectKey: 'private/worker-only-object',
      byteLength: 3,
      mediaType: 'text/plain',
      sha256: 'a'.repeat(64),
      etag: 'provider-etag',
    },
  };
  const job = newJob(
    {
      jobId: 'job',
      kind: 'media',
      resourceId: 'upload',
      inputVersion: 'version',
    },
    '2026-10-25T16:00:00.000Z',
  );
  const options = {
    readValidatedUploadInContext: vi.fn(
      async () => structuredClone(upload) as unknown,
    ),
    readValidatedUpload: vi.fn(async () => structuredClone(upload) as unknown),
    canProcess: vi.fn(async () => true),
    openObject: vi.fn(async () =>
      (async function* () {
        yield Buffer.from('abc');
      })(),
    ),
  };
  return {
    upload,
    job,
    options,
    input: createValidatedAttachmentInput(options),
  };
}
describe('873 validated-upload port adapter', () => {
  it('loads by persisted upload/version and checks current write permission without a fabricated fragment', async () => {
    const f = fixture();
    const context = { transaction: 'current' };
    const binding = await f.input.loadAuthorizedAttachment(context, f.job);
    expect(f.options.readValidatedUploadInContext).toHaveBeenCalledWith(
      context,
      {
        uploadId: 'upload',
        originalVersionId: 'version',
      },
    );
    expect(f.options.readValidatedUpload).not.toHaveBeenCalled();
    expect(f.options.canProcess).toHaveBeenCalledWith(context, binding);
    expect(binding).toEqual({
      purpose: 'attachment',
      completedJobId: 'job',
      recordCollectionId: 'record',
      accountId: 'uploader',
      quotaScope: 'record',
      target: f.upload.target,
      version: {
        mediaId: 'upload',
        originalVersionId: 'version',
        filename: 'demo.txt',
        mediaType: 'text/plain',
        byteLength: 3,
        sha256: 'a'.repeat(64),
      },
    });
    expect(JSON.stringify(binding)).not.toContain('private/');
    expect(JSON.stringify(binding)).not.toContain('fragment');
    if (!binding) throw new Error('binding absent');
    const bytes = await f.input.open(binding);
    const chunks = [];
    for await (const chunk of bytes) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString()).toBe('abc');
    expect(f.options.openObject).toHaveBeenCalledWith(
      'private/worker-only-object',
      undefined,
    );
  });
  it.each([
    null,
    { purpose: 'audio' },
    { jobId: 'other' },
    { originalVersionId: 'other' },
    { uploadId: 'other' },
    { recordCollectionId: undefined },
    { recordCollectionId: 'another-collection' },
  ])('rejects missing or mismatched873 facts %#', async (patch) => {
    const f = fixture();
    f.options.readValidatedUploadInContext.mockResolvedValue(
      patch === null ? null : { ...f.upload, ...patch },
    );
    expect(await f.input.loadAuthorizedAttachment({}, f.job)).toBeNull();
    expect(f.options.canProcess).not.toHaveBeenCalled();
    expect(f.options.openObject).not.toHaveBeenCalled();
  });
  it('does not open bytes when current write permission is denied', async () => {
    const f = fixture();
    f.options.canProcess.mockResolvedValue(false);
    expect(await f.input.loadAuthorizedAttachment({}, f.job)).toBeNull();
    expect(f.options.openObject).not.toHaveBeenCalled();
  });
  it('rechecks immutable metadata before opening a private object', async () => {
    const f = fixture();
    const binding = await f.input.loadAuthorizedAttachment({}, f.job);
    if (!binding) throw new Error('binding absent');
    f.options.readValidatedUpload.mockResolvedValue({
      ...f.upload,
      object: { ...f.upload.object, sha256: 'b'.repeat(64) },
    });
    await expect(f.input.open(binding)).rejects.toThrow(
      'Attachment input changed',
    );
    expect(f.options.openObject).not.toHaveBeenCalled();
  });
});

it('rejects a changed collection before opening bytes even when the other immutable fields match', async () => {
  const f = fixture();
  const binding = await f.input.loadAuthorizedAttachment({}, f.job);
  if (!binding) throw new Error('binding required');
  f.options.readValidatedUpload.mockResolvedValue({
    ...f.upload,
    recordCollectionId: 'new-collection',
    quotaScope: 'new-collection',
  });
  await expect(f.input.open(binding)).rejects.toThrow(
    'Attachment input changed',
  );
  expect(f.options.openObject).not.toHaveBeenCalled();
});
