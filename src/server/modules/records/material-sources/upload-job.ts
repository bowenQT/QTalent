import type { Transaction } from '../../../db/client';
import { stagedParseJob } from '../material-review/read';
import type { ValidatedUpload } from '../uploads/handoff';

/** Whether `jobId` is the parse job this upload is bound to: the job recorded
 * at dispatch, or, for a staged upload that has none, the parse job its batch
 * created. Every attachment save checks this inside its own transaction. */
export async function isUploadBoundToJob(
  tx: Transaction,
  upload: ValidatedUpload,
  jobId: string,
): Promise<boolean> {
  if (upload.jobId !== null) return upload.jobId === jobId;
  if (upload.target.kind !== 'unassigned') return false;
  return (
    (await stagedParseJob(tx, {
      uploadId: upload.uploadId,
      originalVersionId: upload.originalVersionId,
    })) === jobId
  );
}
