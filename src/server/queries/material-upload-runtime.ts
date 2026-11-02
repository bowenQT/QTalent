import 'server-only';
import type { Database } from '../db/client';
import { getDatabase } from '../db/client';
import { getEnv } from '../env';
import { jobAccount } from '../jobs/request';
import { createClock } from '../../lib/clock';
import { createMaterialUploadHttpHandlers } from '../modules/records/uploads/material-http';
import type { UploadDispatch } from '../modules/records/uploads/store';
import { resolveDefaultIntakeNode } from '../modules/records/uploads/default-node';
import { UploadError } from '../modules/records/uploads/types';
import type { UploadStorage } from '../modules/records/uploads/types';
import {
  canWriteArrange,
  loadArrangeActor,
} from '../usecases/record-arrange-context';
import { ForbiddenError } from '../usecases/project-context';
import { kodoUploadStorageFromEnv } from './kodo-upload-storage';
import { testKodoForServer } from './test-kodo';
import { createUploadRuntime } from './upload-runtime';

/** Unassigned staging uploads are processed only after a material batch takes
 * them in, so the store archives them without dispatching. Reaching dispatch
 * here means a non-staging target slipped past the collection policy.
 */
export const refuseMaterialDispatch: UploadDispatch = async () => {
  throw new Error('Material staging never dispatches a job');
};

/** Material intake composition. Only unassigned staging collections are
 * writable here, by an account that can write arrangement records for at least
 * one subject of the chosen evaluation node (HR and mentors of that node). No
 * original is readable through this runtime.
 */
export function createMaterialUploadRuntime(input: {
  db: Database;
  storage: UploadStorage;
  trustedOrigin: string;
  businessNow: () => string;
  securityNow?: () => number;
  adapterMaxBytes?: number;
}) {
  const runtime = createUploadRuntime({
    db: input.db,
    storage: input.storage,
    dispatch: refuseMaterialDispatch,
    trustedOrigin: input.trustedOrigin,
    securityNow: input.securityNow,
    adapterMaxBytes: input.adapterMaxBytes,
    collectionPolicy: {
      async canWriteTarget(accountId, target, tx) {
        if (target.kind !== 'unassigned' || !tx.executor) return false;
        try {
          const actor = await loadArrangeActor(
            tx.executor,
            accountId,
            input.businessNow(),
          );
          return canWriteArrange(actor, [], null, target.evaluationNodeId);
        } catch (error) {
          if (error instanceof ForbiddenError) return false;
          throw error;
        }
      },
      // Staging collections never enter an 846 record save ledger.
      async loadBinding(collectionId, tx) {
        const collection = await tx.findCollection(collectionId);
        if (collection?.target.kind !== 'unassigned')
          throw new Error('Only staging collections have a known binding');
        return { state: 'draft', externalAttachmentCount: 0 };
      },
      async collectionForEvent() {
        return null;
      },
    },
    canReadOriginal: async () => false,
  });
  return {
    ...runtime,
    materialHttp: createMaterialUploadHttpHandlers({
      collections: runtime.collections,
      service: runtime.service,
      trustedOrigin: input.trustedOrigin,
      authenticate: jobAccount,
      async defaultNode(accountId) {
        let actor;
        try {
          actor = await loadArrangeActor(
            input.db,
            accountId,
            input.businessNow(),
          );
        } catch (error) {
          if (error instanceof ForbiddenError)
            throw new UploadError('forbidden', 'target_not_writable');
          throw error;
        }
        return resolveDefaultIntakeNode(actor.context, (nodeId) =>
          canWriteArrange(actor, [], null, nodeId),
        );
      },
    }),
  };
}

const unavailable = () =>
  Response.json(
    { status: 'unavailable', message: '上传服务暂时不可用，请稍后重试' },
    {
      status: 503,
      headers: {
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    },
  );

/** Request-local handlers for the material upload routes. */
export function materialUploadHandlersForServer(): Record<
  'createCollection' | 'requestUpload' | 'completeUpload',
  (request: Request) => Promise<Response>
> {
  let storage: UploadStorage | null;
  try {
    storage =
      kodoUploadStorageFromEnv() ?? testKodoForServer()?.storage ?? null;
  } catch {
    // A malformed deployment value is a dependency failure, never echoed back.
    storage = null;
  }
  if (!storage)
    return {
      createCollection: async () => unavailable(),
      requestUpload: async () => unavailable(),
      completeUpload: async () => unavailable(),
    };
  const env = getEnv();
  const clock = createClock(env.APP_ENV);
  return createMaterialUploadRuntime({
    db: getDatabase(),
    storage,
    trustedOrigin: env.BETTER_AUTH_URL,
    businessNow: () => clock.now().toISOString(),
  }).materialHttp;
}
