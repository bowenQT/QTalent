import 'server-only';
import {
  createUploadTargetAuthorizer,
  type UploadTargetAuthorization,
  type UploadWriteContext,
} from '../modules/records/uploads/target-authorization';
import {
  createNodeOriginalAuthorizer,
  type NodeOriginalAuthorization,
  type NodeOriginalSnapshot,
} from '../modules/records/uploads/access';
import type { Database } from '../db/client';
import { jobAccount } from '../jobs/request';
import { recordAudit } from '../platform/audit';
import {
  createPostgresUploadStore,
  type UploadDispatch,
} from '../modules/records/uploads/store';
import { createUploadService } from '../modules/records/uploads/service';
import { createOriginalReader } from '../modules/records/uploads/read';
import { createUploadHttpHandlers } from '../modules/records/uploads/http';
import {
  createRecordCollectionService,
  type CollectionDependencies,
} from '../modules/records/uploads/collections';
import type {
  UploadPolicy,
  UploadStorage,
} from '../modules/records/uploads/types';

/** Per-request application composition. Shared Kodo config, current record/source
 * policies and the one app producer are supplied by their owners, with no fake
 * defaults, environment access, queue startup or second singleton here.
 */
export function createUploadRuntime(input: {
  db: Database;
  storage: UploadStorage;
  collectionPolicy: Pick<
    CollectionDependencies,
    'canWriteTarget' | 'loadBinding' | 'collectionForEvent'
  >;
  canReadOriginal: UploadPolicy['canReadOriginal'];
  dispatch: UploadDispatch;
  trustedOrigin: string;
  securityNow?: () => number;
  adapterMaxBytes?: number;
}) {
  const store = createPostgresUploadStore(input.db, input.dispatch);
  const collections = createRecordCollectionService({
    ...input.collectionPolicy,
    store,
    now: input.securityNow,
  });
  const options = {
    store,
    storage: input.storage,
    policy: {
      resolveWriteTarget: collections.resolveWriteTarget,
      canReadOriginal: input.canReadOriginal,
    },
    now: input.securityNow,
    adapterMaxBytes: input.adapterMaxBytes,
  };
  const service = createUploadService(options);
  const reader = createOriginalReader(options);
  return {
    collections,
    service,
    reader,
    http: createUploadHttpHandlers({
      service,
      reader,
      trustedOrigin: input.trustedOrigin,
      authenticate: jobAccount,
      auditOriginalRead: ({ accountId, ticketDigest }) =>
        recordAudit(input.db, {
          actorId: accountId,
          action: 'records.original.read',
          resourceId: `upload-ticket:${ticketDigest}`,
        }),
    }),
  };
}

/** Register this factory for node-aware intake only after 899/846/source
 * projection owners provide the real policies; no legacy policy is selected.
 */
export function createNodeAuthorizedUploadRuntime<
  C extends UploadWriteContext,
  S extends NodeOriginalSnapshot,
>(
  input: Omit<
    Parameters<typeof createUploadRuntime>[0],
    'collectionPolicy' | 'canReadOriginal'
  > & {
    collectionPolicy: Pick<
      CollectionDependencies,
      'loadBinding' | 'collectionForEvent'
    >;
    targetAuthorization: UploadTargetAuthorization<C>;
    originalAuthorization: NodeOriginalAuthorization<S>;
  },
) {
  const {
    targetAuthorization,
    originalAuthorization,
    collectionPolicy,
    ...base
  } = input;
  return createUploadRuntime({
    ...base,
    collectionPolicy: {
      ...collectionPolicy,
      canWriteTarget: createUploadTargetAuthorizer(targetAuthorization),
    },
    canReadOriginal: createNodeOriginalAuthorizer(originalAuthorization),
  });
}
