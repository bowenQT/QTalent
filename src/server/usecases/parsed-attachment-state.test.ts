import { expect, it } from 'vitest';
import {
  attachmentGenerationIdentity,
  newAttachmentArrangeJob,
  readAttachmentArrangeMetadata,
  type AttachmentGeneration,
} from './parsed-attachment-state';

const generation: AttachmentGeneration = {
  parentInputId: 'demo-input',
  parentInputVersion: 'demo-input-v1',
  batchId: 'demo-batch',
  materialId: 'demo-material',
  originalVersionId: 'demo-original-v1',
  parseVersionId: 'demo-parse',
  captureAuditId: 'demo-capture',
  materialRevision: 1,
  reviewItemId: 'demo-review',
  reviewOperationId: 'demo-bind-operation',
  itemRevision: 2,
  accountId: 'demo-account',
};
it('gives repeated delivery the same durable identity without consulting parent revision', () => {
  const a = newAttachmentArrangeJob(
    generation,
    'demo-evaluator',
    '2026-11-03T00:00:00Z',
  );
  const b = newAttachmentArrangeJob(
    { ...generation },
    'demo-evaluator',
    '2026-11-03T01:00:00Z',
  );
  expect(a.jobId).toBe(b.jobId);
  expect(a.inputVersion).toBe(b.inputVersion);
  expect(readAttachmentArrangeMetadata(a)?.generationRevision).toBe(1);
});
it.each([
  { reviewOperationId: 'demo-rebind-operation', itemRevision: 4 },
  { parseVersionId: 'demo-next-parse' },
  { materialId: 'demo-second-file' },
  { parentInputVersion: 'demo-next-input' },
  { accountId: 'demo-other-account' },
])(
  'separates another generation %j instead of resurrecting an old terminal job',
  (change) => {
    expect(
      attachmentGenerationIdentity({ ...generation, ...change }).jobId,
    ).not.toBe(attachmentGenerationIdentity(generation).jobId);
  },
);
it('rejects an altered persisted key or a copied metadata body', () => {
  const job = newAttachmentArrangeJob(
    generation,
    'demo-evaluator',
    '2026-11-03T00:00:00Z',
  );
  for (const change of [
    { jobId: 'other' },
    { inputVersion: 'other' },
    { resourceId: 'other' },
    { kind: 'record_organize' },
    { result: null },
  ])
    expect(readAttachmentArrangeMetadata({ ...job, ...change })).toBeNull();
  const metadata = readAttachmentArrangeMetadata(job)!;
  expect(
    readAttachmentArrangeMetadata({
      ...job,
      result: {
        ...metadata,
        generation: { ...generation, itemRevision: 4 },
      },
    }),
  ).toBeNull();
});
