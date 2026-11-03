import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { ModelinkMaasClient } from '../integrations/maas';
import { MODELINK_MODEL } from '../integrations/maas';
import { jobSnapshots } from '../jobs/schema';
import { readJobInTransaction } from '../jobs/repository';
import { recordDraftBatches, recordDrafts } from '../modules/records';
import { appendTrustedRecordDraftBatch } from '../modules/records/save-state/append-drafts';
import { mediaReviewDraftDependencies } from '../modules/records/material-review/schema';
import { arrangeInputs } from '../modules/records/arrange/input-state/schema';
import { readBatchArrangeRules } from '../modules/records/arrange/batch-rules';
import {
  createRecordBatchArrange,
  type BatchArrangeCommit,
  type BatchArrangePorts,
} from './record-batch-arrange';
import {
  batchOperationFromJob,
  updateBatchJob,
} from './record-batch-arrange-state';
import type { NativeBatchDependencies } from './record-batch-arrange-store';
import { lockIntakeTable, readIntakeTable } from './talent-source-projection';
import {
  loadAttachmentBatchSnapshot,
  loadAttachmentMaterial,
} from './record-arrange-media-context';
import {
  readAttachmentArrangeMetadata,
  attachmentArrangeMetadataSchema,
} from './parsed-attachment-state';

function reservedId(jobId: string, kind: string, key: string) {
  return (
    'attachment-' +
    kind +
    '-' +
    createHash('sha256')
      .update(JSON.stringify([jobId, kind, key]))
      .digest('hex')
  );
}

/** The native845 algorithm, one independently fenced file generation at a time.
 * Parent ledger revisions are deliberately NOT the generation revision. */
export function createParsedAttachmentArrange(
  deps: NativeBatchDependencies,
  client: ModelinkMaasClient,
) {
  function portsFor(jobId: string): BatchArrangePorts {
    return {
      locked: (request, callback) =>
        deps.db.transaction(
          async (tx) => {
            await lockIntakeTable(tx, 'locked');
            const hint = await readJobInTransaction(tx, jobId);
            const hinted = hint && readAttachmentArrangeMetadata(hint);
            if (!hinted) throw new Error('attachment_generation_missing');
            const [parentInput] = await tx
              .select({ jobId: arrangeInputs.jobId })
              .from(arrangeInputs)
              .where(eq(arrangeInputs.id, hinted.generation.parentInputId));
            if (!parentInput) throw new Error('attachment_input_missing');
            // Batch reads/cancel take the parent job before the ledger. Match that
            // order, then take source locks only after the846 ledger lock below.
            await readJobInTransaction(tx, parentInput.jobId, true);
            // Same parent ledger lock order as846, BEFORE original/source locks.
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['record-media-append', hinted.generation.batchId])}, 0))`,
            );
            await tx
              .select()
              .from(recordDraftBatches)
              .where(eq(recordDraftBatches.batchId, hinted.generation.batchId))
              .for('update');
            let job = await readJobInTransaction(tx, jobId, true);
            let metadata = job && readAttachmentArrangeMetadata(job);
            if (
              !job ||
              !metadata ||
              metadata.generation.batchId !== request.batchId ||
              metadata.generation.accountId !== request.accountId ||
              metadata.arrange.operationId !== request.operationId
            )
              throw new Error('attachment_generation_changed');
            const intake = await readIntakeTable(tx, 'locked');
            const material = await loadAttachmentMaterial(
              tx,
              metadata.generation.materialId,
              deps.businessNow(),
              intake,
              metadata.generation.accountId,
            );
            const oldIds = metadata.arrange.manifest.map(
              (event) => event.draftId,
            );
            const oldDrafts = oldIds.length
              ? await tx
                  .select()
                  .from(recordDrafts)
                  .where(inArray(recordDrafts.draftId, oldIds))
                  .orderBy(recordDrafts.draftId)
                  .for('update')
              : [];
            const draftSet =
              oldIds.length && oldDrafts.length === oldIds.length
                ? {
                    batchId: request.batchId,
                    revision: metadata.generationRevision + 1,
                    drafts: oldDrafts.map((row) => row.draft),
                    duplicateCandidates: [],
                  }
                : null;
            let committed: BatchArrangeCommit | null = null;
            return callback({
              operation: batchOperationFromJob(
                job,
                {
                  batchId: request.batchId,
                  creatorAccountId: request.accountId,
                  inputVersion: job.inputVersion,
                },
                metadata.arrange,
                draftSet,
              ),
              loadSnapshot: async () =>
                material
                  ? loadAttachmentBatchSnapshot(tx, material, metadata!, intake)
                  : null,
              readRules: (value) =>
                material &&
                value.category === 'dimension_anchors' &&
                typeof value.at === 'string' &&
                value.at === material.state.input.boundAt?.toISOString()
                  ? readBatchArrangeRules(tx, value.at)
                  : Promise.resolve(null),
              reserveIdentities: async (plan) => ({
                expectedBatchRevision: metadata!.generationRevision,
                drafts: plan.events.map((event) => ({
                  eventKey: event.eventKey,
                  draftId: reservedId(jobId, 'draft', event.eventKey),
                  previous: null,
                })),
                candidates: plan.groups.map((group) => ({
                  key: group.key,
                  candidateId: reservedId(jobId, 'candidate', group.key),
                })),
              }),
              persistDraftSet: async (value, trace) => {
                const { events, expectedJobRevision, ...producerTrace } = trace;
                if (
                  !material ||
                  expectedJobRevision !== job!.revision ||
                  job!.attempt !== request.attempt ||
                  !['running', 'partial'].includes(job!.status) ||
                  job!.cancelRequestedAt !== null ||
                  !isDeepStrictEqual(producerTrace, metadata!.arrange.trace) ||
                  trace.inputVersion !== job!.inputVersion ||
                  oldIds.length ||
                  events.length !== value.drafts.length
                )
                  throw new Error('attachment_commit_changed');
                const all = await appendTrustedRecordDraftBatch(tx, {
                  draftSet: value,
                  originalInput: material.state.input.originalInput,
                  occurredOn: material.state.input.occurredOn!,
                  modelVersion: MODELINK_MODEL,
                  createdByAccountId: material.state.input.creatorAccountId,
                  createdAt: deps.now(),
                });
                if (
                  value.drafts.some(
                    (draft) =>
                      !all.drafts.some((row) => isDeepStrictEqual(row, draft)),
                  )
                )
                  throw new Error('attachment_append_missing');
                const generation = metadata!.generation;
                if (
                  generation.reviewOperationId !== null &&
                  generation.reviewItemId !== null
                )
                  await tx.insert(mediaReviewDraftDependencies).values(
                    value.drafts.map((draft) => ({
                      operationId: generation.reviewOperationId!,
                      itemId: generation.reviewItemId!,
                      draftId: draft.draftId,
                      draftRevision: draft.revision,
                    })),
                  );
                committed = trace;
                //845's port contract returns this file's exact set. The merged parent
                // set/revision is for batch receipts only, not model-generation state.
                return value;
              },
              saveOperation: async (next) => {
                if (
                  next.revision !== job!.revision ||
                  next.attempt !== job!.attempt ||
                  next.inputVersion !== job!.inputVersion ||
                  next.batchId !== metadata!.generation.batchId ||
                  next.operationId !== metadata!.arrange.operationId
                )
                  throw new Error('attachment_operation_changed');
                const arrange = {
                  ...metadata!.arrange,
                  trace: next.trace,
                  failure: next.failure,
                  ...(committed ? { manifest: committed.events } : {}),
                };
                const nextJob = updateBatchJob(
                  job!,
                  next.phase,
                  arrange,
                  deps.now().toISOString(),
                );
                metadata = attachmentArrangeMetadataSchema.parse({
                  ...metadata,
                  arrange,
                });
                job = { ...nextJob, result: metadata };
                await tx
                  .update(jobSnapshots)
                  .set(job)
                  .where(eq(jobSnapshots.jobId, jobId));
                return job.revision;
              },
            });
          },
          { isolationLevel: 'read committed' },
        ),
    };
  }
  async function fail(jobId: string, attempt: number, inputChanged: boolean) {
    return deps.db.transaction(async (tx) => {
      await lockIntakeTable(tx, 'locked');
      const job = await readJobInTransaction(tx, jobId, true);
      const metadata = job && readAttachmentArrangeMetadata(job);
      if (
        !job ||
        !metadata ||
        job.attempt !== attempt ||
        !['queued', 'running', 'partial'].includes(job.status)
      )
        return job?.status ?? 'ignored';
      const arrange = {
        ...metadata.arrange,
        failure: {
          kind: inputChanged
            ? ('input_changed' as const)
            : ('outcome_unknown' as const),
          retryable: false,
        },
      };
      const next = updateBatchJob(
        job,
        job.cancelRequestedAt ? 'cancelled' : 'failed',
        arrange,
        deps.now().toISOString(),
      );
      await tx
        .update(jobSnapshots)
        .set({ ...next, result: { ...metadata, arrange } })
        .where(eq(jobSnapshots.jobId, jobId));
      return next.status;
    });
  }
  return {
    async run(jobId: string, attempt: number, signal?: AbortSignal) {
      const job = await deps.db.transaction((tx) =>
        readJobInTransaction(tx, jobId),
      );
      const metadata = job && readAttachmentArrangeMetadata(job);
      if (
        !job ||
        !metadata ||
        job.attempt !== attempt ||
        !['queued', 'running', 'partial'].includes(job.status)
      )
        return 'ignored';
      try {
        const result = await createRecordBatchArrange(portsFor(jobId), client)(
          {
            accountId: metadata.generation.accountId,
            batchId: metadata.generation.batchId,
            operationId: metadata.arrange.operationId,
            attempt,
          },
          signal,
        );
        if (result.status === 'not_found' || result.status === 'not_ready')
          return fail(jobId, attempt, true);
        return result.status;
      } catch {
        return fail(jobId, attempt, false);
      }
    },
    /** A lost runner cannot safely resend a model request: settle unknown. */
    async recover() {
      const stale = await deps.db
        .select()
        .from(jobSnapshots)
        .where(
          and(
            eq(jobSnapshots.kind, 'record_attachment_organize'),
            inArray(jobSnapshots.status, ['running', 'partial']),
            sql`${jobSnapshots.updatedAt} < ${new Date(deps.now().getTime() - 5 * 60_000).toISOString()}`,
          ),
        );
      for (const job of stale) await fail(job.jobId, job.attempt, false);
      return stale.length;
    },
  };
}
