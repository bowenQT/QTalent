import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  uploadRequestSchema,
  completeUploadSchema,
} from '../../../../contracts/media';
import type { UploadRequest } from '../../../../contracts/media';
import {
  UploadError,
  type UploadCollection,
  type UploadStore,
  type UploadTransaction,
} from './types';
import { requireUploadAccount, safeUpload } from './service';
export type CollectionBinding =
  | { state: 'draft'; externalAttachmentCount: number }
  | { state: 'saved'; eventIds: string[]; externalAttachmentCount: number };
export type CollectionDependencies = {
  store: UploadStore;
  now?: () => number;
  /** Reuse 835/846's CURRENT write policy, never talent-read permission. */
  canWriteTarget(
    accountId: string,
    target: UploadRequest['target'],
    tx: UploadTransaction,
  ): Promise<boolean>;
  /** Trusted 846 save ledger. Throws on unavailable storage; no inferred saved state. */
  loadBinding(
    collectionId: string,
    tx: UploadTransaction,
  ): Promise<CollectionBinding>;
  collectionForEvent(
    eventId: string,
    tx: UploadTransaction,
  ): Promise<string | null>;
};
export function createRecordCollectionService(deps: CollectionDependencies) {
  const now = deps.now ?? Date.now;
  const inputSchema = z.strictObject({
    target: uploadRequestSchema.shape.target,
    operationId: uploadRequestSchema.shape.operationId,
  });
  const normalized = (target: UploadRequest['target']) =>
    target.kind === 'people'
      ? { kind: 'people' as const, personIds: [...target.personIds].sort() }
      : target;
  const fingerprint = (target: UploadRequest['target']) =>
    createHash('sha256')
      .update(JSON.stringify(normalized(target)))
      .digest('hex');
  async function savedBindingWritable(
    accountId: string,
    collection: UploadCollection,
    binding: CollectionBinding,
    tx: UploadTransaction,
  ): Promise<boolean> {
    if (binding.state === 'draft') return true;
    if (
      !binding.eventIds.length ||
      new Set(binding.eventIds).size !== binding.eventIds.length
    )
      return false;
    for (const eventId of binding.eventIds) {
      if (
        !eventId.trim() ||
        (await deps.collectionForEvent(eventId, tx)) !== collection.id ||
        !(await deps.canWriteTarget(accountId, { kind: 'event', eventId }, tx))
      )
        return false;
    }
    return true;
  }
  return {
    release(
      accountId: string | null,
      input: unknown,
    ): Promise<{
      uploadId: string;
      recordCollectionId: string;
      revision: number;
      releasedAt: number;
    }> {
      return safeUpload(async () => {
        requireUploadAccount(accountId);
        const parsed = z
          .strictObject({
            uploadId: completeUploadSchema.shape.uploadId,
            operationId: completeUploadSchema.shape.operationId,
            expectedRevision: completeUploadSchema.shape.expectedRevision,
          })
          .safeParse(input);
        if (!parsed.success)
          throw new UploadError('validation_error', 'invalid_input');
        const command = parsed.data;
        const initial = await deps.store.transaction([], (tx) =>
          tx.findIntent(command.uploadId),
        );
        if (!initial) throw new UploadError('not_found', 'upload_not_found');
        const recordCollectionId = initial.request.recordCollectionId;
        return deps.store.transaction(
          [`quota:${recordCollectionId}`, `upload:${command.uploadId}`],
          async (tx) => {
            const intent = await tx.findIntent(command.uploadId);
            const collection = await tx.findCollection(recordCollectionId);
            if (
              !intent ||
              !collection ||
              collection.creatorAccountId !== accountId ||
              !(await deps.canWriteTarget(accountId, collection.target, tx))
            )
              throw new UploadError('not_found', 'upload_not_found');
            if (intent.request.recordCollectionId !== recordCollectionId)
              throw new UploadError('conflict', 'record_collection_changed');
            const binding = await deps.loadBinding(recordCollectionId, tx);
            if (
              !(await savedBindingWritable(accountId, collection, binding, tx))
            )
              throw new UploadError('not_found', 'upload_not_found');
            const digest = createHash('sha256')
              .update(JSON.stringify(command))
              .digest('hex');
            if (intent.releasedAt !== null) {
              if (
                intent.releaseOperationId !== command.operationId ||
                intent.releaseFingerprint !== digest
              )
                throw new UploadError('conflict', 'release_payload_changed');
              return {
                uploadId: intent.id,
                recordCollectionId,
                revision: intent.revision,
                releasedAt: intent.releasedAt,
              };
            }
            if (binding.state !== 'draft')
              throw new UploadError('conflict', 'collection_saved');
            if (intent.revision !== command.expectedRevision)
              throw new UploadError('conflict', 'upload_changed');
            const releasedAt = now();
            const revision = intent.revision + 1;
            await tx.saveRelease({
              ...intent,
              releasedAt,
              revision,
              releaseOperationId: command.operationId,
              releaseFingerprint: digest,
            });
            return {
              uploadId: intent.id,
              recordCollectionId,
              revision,
              releasedAt,
            };
          },
        );
      });
    },
    create(
      accountId: string | null,
      input: unknown,
    ): Promise<Pick<UploadCollection, 'id' | 'revision' | 'expiresAt'>> {
      return safeUpload(async () => {
        requireUploadAccount(accountId);
        const parsed = inputSchema.safeParse(input);
        if (!parsed.success)
          throw new UploadError('validation_error', 'invalid_input');
        const { target, operationId } = parsed.data;
        // Existing events must resolve through 846's canonical save ledger. They
        // cannot create an alternate bucket for the same record's ten-file cap.
        if (target.kind === 'event')
          throw new UploadError(
            'conflict',
            'record_collection_requires_binding',
          );
        return deps.store.transaction(
          [`collection-operation:${accountId}:${operationId}`],
          async (tx) => {
            if (!(await deps.canWriteTarget(accountId, target, tx)))
              throw new UploadError('forbidden', 'record_write_required');
            let collection = await tx.findCollectionOperation(
              accountId,
              operationId,
            );
            if (
              collection &&
              collection.targetFingerprint !== fingerprint(target)
            )
              throw new UploadError('conflict', 'operation_payload_changed');
            if (!collection) {
              const createdAt = now();
              collection = {
                id: randomUUID(),
                creatorAccountId: accountId,
                operationId,
                target: normalized(target),
                targetFingerprint: fingerprint(target),
                createdAt,
                expiresAt: createdAt + 24 * 60 * 60 * 1000,
                revision: 1,
              };
              await tx.insertCollection(collection);
            }
            return {
              id: collection.id,
              revision: collection.revision,
              expiresAt: collection.expiresAt,
            };
          },
        );
      });
    },
    resolveWriteTarget(
      accountId: string,
      input: Pick<UploadRequest, 'recordCollectionId' | 'target'>,
      tx?: UploadTransaction,
    ): Promise<{
      recordCollectionId: string;
      quotaScope: string;
      collectionExpiresAt: number;
      externalAttachmentCount: number;
    } | null> {
      return safeUpload(async () => {
        const run = async (transaction: UploadTransaction) => {
          const collection = await transaction.findCollection(
            input.recordCollectionId,
          );
          if (!collection) return null;
          const binding = await deps.loadBinding(collection.id, transaction);
          if (
            !Number.isSafeInteger(binding.externalAttachmentCount) ||
            binding.externalAttachmentCount < 0
          )
            throw new UploadError(
              'unavailable',
              'record_attachment_count_unresolved',
            );
          if (
            binding.state === 'draft' &&
            collection.creatorAccountId !== accountId
          )
            return null;
          if (input.target.kind === 'event') {
            if (
              binding.state !== 'saved' ||
              !binding.eventIds.includes(input.target.eventId) ||
              (await deps.collectionForEvent(
                input.target.eventId,
                transaction,
              )) !== collection.id
            )
              return null;
          } else if (fingerprint(input.target) !== collection.targetFingerprint)
            return null;
          // Saved identity comes from the ledger, never the caller's weaker
          // people alias. Every linked event must still map here and be writable.
          if (
            !(await savedBindingWritable(
              accountId,
              collection,
              binding,
              transaction,
            ))
          )
            return null;
          if (
            !(await deps.canWriteTarget(accountId, input.target, transaction))
          )
            return null;
          if (
            input.target.kind === 'event' &&
            !(await deps.canWriteTarget(
              accountId,
              collection.target,
              transaction,
            ))
          )
            return null;
          return {
            recordCollectionId: collection.id,
            quotaScope: collection.id,
            collectionExpiresAt: collection.expiresAt,
            externalAttachmentCount: binding.externalAttachmentCount,
          };
        };
        return tx ? run(tx) : deps.store.transaction([], run);
      });
    },
  };
}
