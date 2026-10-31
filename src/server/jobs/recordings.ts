import { z } from 'zod';
import { resumeRecordingProcessingSchema } from '../../contracts/media';
import type { UploadDispatch } from '../modules/records/uploads/store';
import { recordingKey } from '../modules/records/recordings/policy';
import type { RecordingWork } from '../modules/records/recordings/types';

export const RECORDING_QUEUE = 'recording-offline';
const envelope = {
  jobId: z.string().min(1).max(200).regex(/\S/),
  attempt: z.number().int().positive(),
};
export const recordingWorkSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('process'),
    recordingId: z.string().min(1).max(200).regex(/\S/),
    pollSequence: z.number().int().nonnegative(),
    ...envelope,
  }),
  resumeRecordingProcessingSchema.extend({
    action: z.literal('resume'),
    ...envelope,
  }),
]);
export function createRecordingHandler(
  process: (work: RecordingWork) => Promise<unknown>,
) {
  return async (payload: unknown) =>
    process(recordingWorkSchema.parse(payload));
}
/** Adapter must atomically create recording/run + app job/outbox with the supplied native tx.
 * Reuse getAppJobProducer/fromDrizzle; this factory neither creates a producer nor registers a worker.
 */
export function createRecordingDispatch(
  persistAndEnqueue: (
    tx: Parameters<UploadDispatch>[0],
    input: Parameters<UploadDispatch>[1] & {
      queue: typeof RECORDING_QUEUE;
      operationKey: string;
    },
  ) => Promise<{ jobId: string }>,
): UploadDispatch {
  return async (tx, input) => {
    if (input.purpose !== 'audio')
      throw new Error('unsupported_recording_dispatch');
    const result = await persistAndEnqueue(tx, {
      ...input,
      queue: RECORDING_QUEUE,
      operationKey: recordingKey(
        'recording-upload',
        input.uploadId,
        input.originalVersionId,
      ),
    });
    if (!result.jobId.trim()) throw new Error('missing_recording_job');
    return result;
  };
}
