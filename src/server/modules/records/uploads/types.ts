import type {
  UploadRequest,
  UploadGrant,
  ReadOriginalInput,
} from '../../../../contracts/media';
import type { createKodoClient } from '../../../integrations/kodo';
import type { DbExecutor } from '../../../db/client';

export type UploadStorage = Pick<
  ReturnType<typeof createKodoClient>,
  'issueUploadGrant' | 'statObject' | 'openObject'
>;
export type UploadCompletion = {
  uploadId: string;
  recordCollectionId: string;
  originalId: string;
  originalVersionId: string;
  jobId: string;
  revision: number;
  /** Parsing/transcription owns real fragments. Uploading cannot invent one. */
  source: null;
};
export type UploadIntent = {
  id: string;
  /** Stored collection FK; quota labels and request JSON cannot supply identity. */
  recordCollectionId: string;
  accountId: string;
  operationId: string;
  fingerprint: string;
  quotaScope: string;
  request: UploadRequest;
  objectKey: string;
  expiresAt: number;
  revision: number;
  completionOperationId: string | null;
  completionFingerprint: string | null;
  completed: UploadCompletion | null;
  releasedAt: number | null;
  releaseOperationId: string | null;
  releaseFingerprint: string | null;
};
export type UploadCollection = {
  id: string;
  creatorAccountId: string;
  operationId: string;
  target: UploadRequest['target'];
  targetFingerprint: string;
  createdAt: number;
  expiresAt: number;
  revision: number;
};
export type VerifiedObject = {
  objectKey: string;
  byteLength: number;
  mediaType: string;
  sha256: string;
  etag: string;
};
export type UploadedObject = VerifiedObject & {
  uploadId: string;
  originalVersionId: string;
};
/** Historical membership facts, including expired and released intents. These
 * facts grant no record-write, processing, or original-read permission.
 */
export type UploadCollectionMembers = {
  recordCollectionId: string;
  collection: UploadCollection;
  members: { intent: UploadIntent; object: UploadedObject | null }[];
};
export type ReadTicket = {
  digest: string;
  accountId: string;
  originalId: string;
  originalVersionId: string;
  fragmentId: string | null;
  requestedRange: NonNullable<ReadOriginalInput['range']> | null;
  expiresAt: number;
};
/** The implementation must atomically roll back all these writes and dispatch. */
export interface UploadTransaction {
  readonly executor?: DbExecutor;
  findCollection(id: string): Promise<UploadCollection | null>;
  findCollectionOperation(
    accountId: string,
    operationId: string,
  ): Promise<UploadCollection | null>;
  insertCollection(collection: UploadCollection): Promise<void>;
  findOperation(
    accountId: string,
    operationId: string,
  ): Promise<UploadIntent | null>;
  findIntent(id: string): Promise<UploadIntent | null>;
  activeCount(quotaScope: string, now: number): Promise<number>;
  insertIntent(intent: UploadIntent): Promise<void>;
  archiveAndDispatch(
    intent: UploadIntent,
    object: VerifiedObject,
    ids: { originalId: string; originalVersionId: string },
  ): Promise<string>;
  saveCompletion(intent: UploadIntent): Promise<void>;
  saveRelease(intent: UploadIntent): Promise<void>;
  findObject(originalVersionId: string): Promise<UploadedObject | null>;
  insertTicket(ticket: ReadTicket): Promise<void>;
  findTicket(digest: string): Promise<ReadTicket | null>;
}
export interface UploadStore {
  /** Locks are global to a record collection, including across different accounts. */
  transaction<T>(
    locks: string[],
    work: (tx: UploadTransaction) => Promise<T>,
  ): Promise<T>;
}
export interface UploadPolicy {
  /** Reload current record-WRITE permission and a trusted stable record collection.
   * A people set/event ID is not a record collection. Never substitute read access.
   */
  resolveWriteTarget(
    accountId: string,
    input: Pick<UploadRequest, 'recordCollectionId' | 'target'>,
    transaction?: UploadTransaction,
  ): Promise<{
    recordCollectionId: string;
    collectionExpiresAt?: number;
    quotaScope: string;
    /** Existing attachments in this record collection not represented by these
     * upload intents. Resolved from authoritative storage in the same transaction.
     */
    externalAttachmentCount: number;
  } | null>;
  /** Must resolve the requested fragment/version and the complete classified
   * original's subjects and sensitive kinds via 837 + authz, on EVERY call.
   * Partial classification or authorization of just one quote must return false.
   */
  canReadOriginal(
    accountId: string,
    reference: ReadOriginalInput,
    transaction?: UploadTransaction,
  ): Promise<boolean>;
}
export type UploadOptions = {
  store: UploadStore;
  storage: UploadStorage;
  policy: UploadPolicy;
  now?: () => number;
  /** Explicit adapter capacity, not a replacement for the 2 GiB product contract. */
  adapterMaxBytes?: number;
};
export type RequestGrant = UploadGrant;
export class UploadError extends Error {
  constructor(
    readonly status:
      | 'unauthenticated'
      | 'forbidden'
      | 'not_found'
      | 'conflict'
      | 'unavailable'
      | 'validation_error',
    readonly reason: string,
  ) {
    super(reason);
    this.name = 'UploadError';
  }
}
