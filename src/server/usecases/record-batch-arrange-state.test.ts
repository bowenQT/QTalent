import { describe, expect, it } from 'vitest';
import { newJob } from '../jobs/state';
import {
  initialBatchMetadata,
  parseBatchMetadata,
  batchOperationFromJob,
  updateBatchJob,
} from './record-batch-arrange-state';
const now = '2026-09-04T00:00:00.000Z';
const input = {
  batchId: 'demo-batch',
  creatorAccountId: 'demo-account',
  inputVersion: 'demo-input-v1',
};
const metadata = () => initialBatchMetadata('demo-actor', 'demo-operation', []);
const job = () => ({
  ...newJob(
    {
      jobId: 'demo-job',
      kind: 'record_organize',
      resourceId: 'demo-input',
      inputVersion: input.inputVersion,
    },
    now,
  ),
  result: metadata(),
});
describe('845 bridge uses only the real job status and immutable result metadata', () => {
  it('requires explicit native metadata rather than accepting old or client-shaped results', () => {
    expect(parseBatchMetadata(null)).toBeNull();
    expect(parseBatchMetadata({ phase: 'done' })).toBeNull();
    expect(parseBatchMetadata({ ...metadata(), phase: 'done' })).toBeNull();
    expect(parseBatchMetadata(metadata())).toEqual(metadata());
  });
  it('derives operation phase and cancellation from the unique job row', () => {
    const current = job();
    const op = batchOperationFromJob(current, input, metadata(), null);
    expect(op).toMatchObject({
      phase: 'queued',
      accountId: 'demo-account',
      batchId: 'demo-batch',
      operationId: 'demo-operation',
      cancelRequested: false,
    });
    current.status = 'running';
    current.cancelRequestedAt = now;
    expect(
      batchOperationFromJob(current, input, metadata(), null),
    ).toMatchObject({ phase: 'running', cancelRequested: true });
    expect(metadata()).not.toHaveProperty('phase');
    expect(metadata()).not.toHaveProperty('draftSet');
  });
  it('advances through the actual queued/running/awaiting_manual state machine for a review', () => {
    const current = job();
    const next = updateBatchJob(current, 'needs_review', metadata(), now);
    expect(next).toMatchObject({ status: 'awaiting_manual', revision: 3 });
    expect(next.result).not.toHaveProperty('phase');
    expect(next.result).not.toHaveProperty('draftSet');
  });
  it('does not turn cancellation into a successful business commit', () => {
    const next = updateBatchJob(job(), 'cancelled', metadata(), now);
    expect(next).toMatchObject({ status: 'cancelled', cancelRequestedAt: now });
    expect(updateBatchJob(next, 'cancelled', metadata(), now)).toEqual(next);
  });
  it('rejects missing batch identity and mismatched input versions instead of deriving another operation', () => {
    expect(() =>
      batchOperationFromJob(
        job(),
        { ...input, batchId: null },
        metadata(),
        null,
      ),
    ).toThrow('native_batch_input_required');
    expect(() =>
      batchOperationFromJob(
        job(),
        { ...input, inputVersion: 'different' },
        metadata(),
        null,
      ),
    ).toThrow('native_batch_input_required');
  });
  it('cannot overwrite a terminal native job with a new running claim', () => {
    const current = job();
    current.status = 'completed';
    expect(() => updateBatchJob(current, 'running', metadata(), now)).toThrow();
  });
});
