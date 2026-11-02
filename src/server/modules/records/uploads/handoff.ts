import type { UploadRequest } from '../../../../contracts/media';
import type { UploadStore, VerifiedObject } from './types';
import { safeUpload } from './service';
import { hasExplicitCollectionIdentity } from './collection-identity';

export type ValidatedUpload = {
  uploadId: string;
  recordCollectionId: string;
  originalId: string;
  originalVersionId: string;
  jobId: string;
  purpose: UploadRequest['purpose'];
  filename: string;
  target: UploadRequest['target'];
  accountId: string;
  quotaScope: string;
  /** Server-worker metadata only; never serialize the private object key to UI. */
  object: VerifiedObject;
};
export async function readValidatedUpload(
  store: UploadStore,
  reference: { uploadId: string; originalVersionId: string },
): Promise<ValidatedUpload | null> {
  return safeUpload(() =>
    store.transaction([], async (tx) => {
      const object = await tx.findObject(reference.originalVersionId);
      if (!object || object.uploadId !== reference.uploadId) return null;
      const intent = await tx.findIntent(reference.uploadId);
      const completed = intent?.completed;
      if (
        !intent ||
        !hasExplicitCollectionIdentity(intent) ||
        !completed ||
        completed.uploadId !== reference.uploadId ||
        completed.originalVersionId !== reference.originalVersionId ||
        intent.objectKey !== object.objectKey ||
        intent.request.declaredBytes !== object.byteLength
      )
        return null;
      return {
        uploadId: intent.id,
        recordCollectionId: intent.recordCollectionId,
        originalId: completed.originalId,
        originalVersionId: completed.originalVersionId,
        jobId: completed.jobId,
        purpose: intent.request.purpose,
        filename: intent.request.filename,
        accountId: intent.accountId,
        quotaScope: intent.quotaScope,
        target: intent.request.target,
        object: {
          objectKey: object.objectKey,
          byteLength: object.byteLength,
          mediaType: object.mediaType,
          sha256: object.sha256,
          etag: object.etag,
        },
      };
    }),
  );
}
