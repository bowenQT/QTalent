import type { UploadRequest } from '../../../../contracts/media';
import type {
  UploadStore,
  UploadIntent,
  UploadedObject,
  VerifiedObject,
} from './types';
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
/** Shared fact validation only; neither standalone nor transaction readers grant
 * processing or original-read permission. Do not export this as an entry port.
 */
export function validatedUploadFromFacts(
  intent: UploadIntent | null,
  object: UploadedObject | null,
  reference: { uploadId: string; originalVersionId: string },
): ValidatedUpload | null {
  if (
    !object ||
    object.uploadId !== reference.uploadId ||
    object.originalVersionId !== reference.originalVersionId
  )
    return null;
  const completed = intent?.completed;
  if (
    !intent ||
    !hasExplicitCollectionIdentity(intent) ||
    !completed ||
    intent.id !== reference.uploadId ||
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
}
export async function readValidatedUpload(
  store: UploadStore,
  reference: { uploadId: string; originalVersionId: string },
): Promise<ValidatedUpload | null> {
  return safeUpload(() =>
    store.transaction([], async (tx) => {
      const object = await tx.findObject(reference.originalVersionId);
      if (!object || object.uploadId !== reference.uploadId) return null;
      return validatedUploadFromFacts(
        await tx.findIntent(reference.uploadId),
        object,
        reference,
      );
    }),
  );
}
