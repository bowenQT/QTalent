import type { UploadIntent } from './types';

/** Validate the explicit stored FK. Never recover it from a quota label, target,
 * request JSON, or an archived completion claiming another collection.
 */
export function hasExplicitCollectionIdentity(
  intent: Pick<UploadIntent, 'recordCollectionId' | 'quotaScope' | 'request'> &
    Partial<Pick<UploadIntent, 'completed'>>,
): boolean {
  return (
    typeof intent.recordCollectionId === 'string' &&
    intent.recordCollectionId.trim().length > 0 &&
    intent.quotaScope === intent.recordCollectionId &&
    intent.request.recordCollectionId === intent.recordCollectionId &&
    (!intent.completed ||
      intent.completed.recordCollectionId === intent.recordCollectionId)
  );
}
