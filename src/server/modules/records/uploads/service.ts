import { createHash, randomUUID } from 'node:crypto';
import {
  completeUploadSchema,
  MAX_ATTACHMENTS,
  uploadGrantSchema,
  uploadRequestSchema,
} from '../../../../contracts/media';
import { verifyUploadObject } from './content';
import {
  UploadError,
  type RequestGrant,
  type UploadCompletion,
  type UploadIntent,
  type UploadOptions,
  type UploadTransaction,
} from './types';

const TOKEN_TTL = 5 * 60 * 1000;
const INTENT_TTL = 24 * 60 * 60 * 1000;
const fingerprint = (input: unknown) =>
  createHash('sha256').update(JSON.stringify(input)).digest('hex');
export async function safeUpload<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof UploadError) throw error;
    throw new UploadError('unavailable', 'upload_unavailable');
  }
}
export function requireUploadAccount(
  accountId: string | null,
): asserts accountId is string {
  if (!accountId)
    throw new UploadError('unauthenticated', 'authentication_required');
}
export function createUploadService(options: UploadOptions) {
  const now = options.now ?? Date.now;
  async function authorize(
    accountId: string,
    intent: Pick<UploadIntent, 'request' | 'quotaScope'>,
    tx?: UploadTransaction,
  ) {
    const target = await options.policy.resolveWriteTarget(
      accountId,
      intent.request.target,
      tx,
    );
    if (!target) throw new UploadError('forbidden', 'record_write_required');
    if (target.quotaScope !== intent.quotaScope)
      throw new UploadError('conflict', 'record_collection_changed');
    if (
      !Number.isSafeInteger(target.externalAttachmentCount) ||
      target.externalAttachmentCount < 0
    )
      throw new UploadError(
        'unavailable',
        'record_attachment_count_unresolved',
      );
    return target;
  }
  return {
    request(accountId: string | null, input: unknown): Promise<RequestGrant> {
      return safeUpload(async () => {
        requireUploadAccount(accountId);
        const parsed = uploadRequestSchema.safeParse(input);
        if (!parsed.success)
          throw new UploadError('validation_error', 'invalid_input');
        const request = {
          ...parsed.data,
          declaredMediaType: parsed.data.declaredMediaType.toLowerCase(),
          target:
            parsed.data.target.kind === 'people'
              ? {
                  kind: 'people' as const,
                  personIds: [...parsed.data.target.personIds].sort(),
                }
              : parsed.data.target,
        };
        const target = await options.policy.resolveWriteTarget(
          accountId,
          request.target,
        );
        if (!target)
          throw new UploadError('forbidden', 'record_write_required');
        if (!target.quotaScope.trim())
          throw new UploadError('unavailable', 'record_collection_unresolved');
        if (request.declaredBytes > (options.adapterMaxBytes ?? 1024 ** 3))
          throw new UploadError('unavailable', 'adapter_limit');
        return options.store.transaction(
          [
            `operation:${accountId}:${request.operationId}`,
            `quota:${target.quotaScope}`,
          ],
          async (tx) => {
            const currentTarget = await authorize(
              accountId,
              { request, quotaScope: target.quotaScope },
              tx,
            );
            const digest = fingerprint(request);
            let intent = await tx.findOperation(accountId, request.operationId);
            if (
              intent &&
              (intent.fingerprint !== digest ||
                intent.quotaScope !== target.quotaScope)
            )
              throw new UploadError('conflict', 'operation_payload_changed');
            if (intent && (intent.completed || intent.expiresAt <= now()))
              throw new UploadError('conflict', 'upload_closed');
            if (!intent) {
              if (
                currentTarget.externalAttachmentCount +
                  (await tx.activeCount(target.quotaScope, now())) >=
                MAX_ATTACHMENTS
              )
                throw new UploadError('validation_error', 'attachment_limit');
              const id = randomUUID();
              intent = {
                id,
                accountId,
                request,
                operationId: request.operationId,
                fingerprint: digest,
                quotaScope: target.quotaScope,
                objectKey: `uploads/${id}/original`,
                expiresAt: now() + INTENT_TTL,
                revision: 1,
                completionOperationId: null,
                completionFingerprint: null,
                completed: null,
              };
              await tx.insertIntent(intent);
            }
            const expiry = Math.min(now() + TOKEN_TTL, intent.expiresAt);
            const grant = options.storage.issueUploadGrant({
              objectKey: intent.objectKey,
              byteLimit: request.declaredBytes,
              contentType: request.declaredMediaType,
              expiresAt: expiry,
            });
            if (
              grant.objectKey !== intent.objectKey ||
              grant.expiresAt <= now() ||
              grant.expiresAt > expiry
            )
              throw new UploadError('unavailable', 'invalid_storage_grant');
            return uploadGrantSchema.parse({
              uploadId: intent.id,
              revision: intent.revision,
              expiresAt: new Date(grant.expiresAt).toISOString(),
              method: 'resumable_v2',
              uploadEndpoint: grant.uploadEndpoint,
              uploadToken: grant.token,
              objectKey: intent.objectKey,
              maxBytes: request.declaredBytes,
            });
          },
        );
      });
    },
    complete(
      accountId: string | null,
      input: unknown,
    ): Promise<UploadCompletion> {
      return safeUpload(async () => {
        requireUploadAccount(accountId);
        const parsed = completeUploadSchema.safeParse(input);
        if (!parsed.success)
          throw new UploadError('validation_error', 'invalid_input');
        const command = parsed.data;
        const digest = fingerprint(command);
        const locks = [`upload:${command.uploadId}`];
        async function current(tx: UploadTransaction) {
          const intent = await tx.findIntent(command.uploadId);
          if (!intent || intent.accountId !== accountId)
            throw new UploadError('not_found', 'upload_not_found');
          await authorize(accountId!, intent, tx);
          if (intent.completed) {
            if (
              intent.completionOperationId !== command.operationId ||
              intent.completionFingerprint !== digest
            )
              throw new UploadError('conflict', 'completion_payload_changed');
          } else if (
            intent.expiresAt <= now() ||
            intent.revision !== command.expectedRevision
          )
            throw new UploadError('conflict', 'upload_expired_or_changed');
          return intent;
        }
        const intent = await options.store.transaction(locks, current);
        if (intent.completed) return intent.completed;
        const object = await verifyUploadObject(
          options.storage,
          intent.objectKey,
          intent.request,
        );
        return options.store.transaction(locks, async (tx) => {
          const latest = await current(tx);
          if (latest.completed) return latest.completed;
          const ids = {
            originalId: randomUUID(),
            originalVersionId: randomUUID(),
          };
          const jobId = await tx.archiveAndDispatch(latest, object, ids);
          const completed: UploadCompletion = {
            uploadId: latest.id,
            ...ids,
            jobId,
            revision: latest.revision + 1,
            source: null,
          };
          await tx.saveCompletion({
            ...latest,
            revision: completed.revision,
            completed,
            completionOperationId: command.operationId,
            completionFingerprint: digest,
          });
          return completed;
        });
      });
    },
  };
}
