import { createDatabase } from '../db/client';
import type { RecordingWork } from '../modules/records/recordings/types';
import { describe, expect, it, vi } from 'vitest';
import type { UploadDispatch } from '../modules/records/uploads/store';
import {
  createRecordingDispatch,
  createRecordingHandler,
  RECORDING_QUEUE,
  recordingWorkSchema,
} from './recordings';

describe('recording job factories without worker registration', () => {
  it('validates process and canonical resume envelopes before invoking the processor', async () => {
    const process = vi.fn<(work: RecordingWork) => Promise<string>>(
      async () => 'handled',
    );
    const handle = createRecordingHandler(process);
    const work = {
      action: 'process',
      recordingId: 'demo-recording',
      jobId: 'demo-job',
      attempt: 1,
      pollSequence: 0,
    };
    expect(await handle(work)).toBe('handled');
    const resume = {
      action: 'resume',
      recordingId: 'demo-recording',
      jobId: 'demo-resume-job',
      attempt: 1,
      transcriptVersionId: 'demo-transcript',
      bindingRevision: 2,
      operationId: 'demo-bind-op',
    };
    await handle(resume);
    expect(process.mock.calls.map((c) => c[0])).toEqual([work, resume]);
  });
  it.each([
    { action: 'live' },
    {
      action: 'process',
      recordingId: 'demo',
      jobId: 'job',
      attempt: 0,
      pollSequence: 0,
    },
    {
      action: 'process',
      recordingId: 'demo',
      jobId: 'job',
      attempt: 1,
      pollSequence: -1,
    },
    {
      action: 'process',
      recordingId: 'demo',
      jobId: 'job',
      attempt: 1,
      pollSequence: 0,
      objectKey: 'private',
    },
    {
      action: 'resume',
      recordingId: 'demo',
      jobId: 'job',
      attempt: 1,
      transcriptVersionId: 't',
      bindingRevision: 1,
      operationId: 'op',
      allResolved: true,
    },
    {
      action: 'resume',
      recordingId: 'demo',
      jobId: 'job',
      attempt: 1,
      transcriptVersionId: 't',
      bindingRevision: 0,
      operationId: 'op',
    },
  ])('rejects untrusted job shape %j without processing', async (payload) => {
    const process = vi.fn();
    await expect(createRecordingHandler(process)(payload)).rejects.toThrow();
    expect(process).not.toHaveBeenCalled();
    expect(recordingWorkSchema.safeParse(payload).success).toBe(false);
  });
  it('delegates the identical executor with stable upload identity to the one producer adapter', async () => {
    // A real lazy executor object; no query, connection or transaction is executed.
    const { db: tx, pool } = createDatabase(
      'postgres://synthetic:synthetic@127.0.0.1:1/demo',
    );
    const input: Parameters<UploadDispatch>[1] = {
      purpose: 'audio',
      uploadId: 'demo-upload',
      originalId: 'demo-original',
      originalVersionId: 'demo-version',
      accountId: 'demo-account',
      quotaScope: 'opaque',
      target: { kind: 'people', personIds: ['demo-person'] },
    };
    const persist = vi.fn<Parameters<typeof createRecordingDispatch>[0]>(
      async () => ({ jobId: 'demo-job' }),
    );
    const dispatch = createRecordingDispatch(persist);
    expect(await dispatch(tx, input)).toEqual({ jobId: 'demo-job' });
    await dispatch(tx, input);
    expect(persist.mock.calls[0][0]).toBe(tx);
    expect(persist.mock.calls[0][1]).toMatchObject({
      ...input,
      queue: RECORDING_QUEUE,
    });
    expect(persist.mock.calls[1][1]).toEqual(persist.mock.calls[0][1]);
    // This proves delegation, not native PG/outbox atomicity.
    await pool.end();
  });
  it('does not dispatch attachments or accept a missing producer job ID', async () => {
    const { db: tx, pool } = createDatabase(
      'postgres://synthetic:synthetic@127.0.0.1:1/demo',
    );
    const input: Parameters<UploadDispatch>[1] = {
      purpose: 'attachment',
      uploadId: 'demo-upload',
      originalId: 'demo-original',
      originalVersionId: 'demo-version',
      accountId: 'demo-account',
      quotaScope: 'opaque',
      target: { kind: 'event', eventId: 'demo-event' },
    };
    const persist = vi.fn<Parameters<typeof createRecordingDispatch>[0]>(
      async () => ({ jobId: 'demo-job' }),
    );
    await expect(createRecordingDispatch(persist)(tx, input)).rejects.toThrow(
      'unsupported_recording_dispatch',
    );
    expect(persist).not.toHaveBeenCalled();
    await expect(
      createRecordingDispatch(async () => ({ jobId: '' }))(tx, {
        ...input,
        purpose: 'audio',
      }),
    ).rejects.toThrow('missing_recording_job');
    await pool.end();
  });
});
