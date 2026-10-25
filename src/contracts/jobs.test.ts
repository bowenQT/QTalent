import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createJobSnapshotSchema, jobCommandSchema } from './jobs';
const schema = createJobSnapshotSchema(
  'test-job',
  z.object({ units: z.array(z.object({ id: z.string() }).strict()) }).strict(),
);
const snapshot = {
  schemaVersion: 1,
  jobId: 'job-1',
  kind: 'test-job',
  status: 'queued',
  attempt: 1,
  revision: 1,
  updatedAt: '2026-10-25T00:00:00.000Z',
  progress: null,
  result: null,
  error: null,
  canRetry: false,
  canCancel: true,
  cancelRequestedAt: null,
};
describe('job snapshot contract', () => {
  it('accepts complete validated snapshots and consumer results', () => {
    expect(schema.parse(snapshot)).toEqual(snapshot);
    expect(
      schema.parse({ ...snapshot, result: { units: [{ id: 'unit' }] } }).result,
    ).toEqual({ units: [{ id: 'unit' }] });
  });
  it.each([
    { status: 'cancelling' },
    { attempt: 0 },
    { revision: -1 },
    { confidence: 0.9 },
    { result: { units: [], prompt: 'secret' } },
    { result: { units: [{ id: 'x', objectKey: 'secret' }] } },
    { progress: { completed: 3, total: 2 } },
    { error: { code: 'provider', message: 'stack' } },
  ])('rejects malformed or unapproved fields %j', (change) => {
    expect(schema.safeParse({ ...snapshot, ...change }).success).toBe(false);
  });
  it('validates explicit optimistic commands, rejecting extra payload', () => {
    expect(
      jobCommandSchema.parse({
        jobId: 'job',
        action: 'retry',
        operationId: 'op',
        expectedRevision: 2,
      }),
    ).toBeTruthy();
    expect(
      jobCommandSchema.safeParse({
        jobId: 'job',
        action: 'resume',
        operationId: '',
        expectedRevision: 0,
      }).success,
    ).toBe(false);
  });
});
