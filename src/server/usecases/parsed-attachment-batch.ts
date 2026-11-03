import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import {
  materialReviewCommandSchema,
  materialReviewItemSchema,
  materialReviewResolutionReceiptSchema,
  type MaterialReviewCommandResult,
  type MaterialReviewUndoResult,
} from '../../contracts/material-review';
import type { Transaction } from '../db/client';
import { insertJob, readJobInTransaction } from '../jobs/repository';
import { jobSnapshots } from '../jobs/schema';
import { arrangeInputs } from '../modules/records/arrange/input-state/schema';
import { arrangeOperationFingerprint } from '../modules/records/arrange/input-state/bind';
import {
  mediaMaterials,
  mediaReviewItems,
  mediaReviewOperations,
} from '../modules/records/material-review/schema';
import { recordAudit } from '../platform/audit';
import type { NativeBatchDependencies } from './record-batch-arrange-store';
import { readIntakeTable } from './talent-source-projection';
import { canWriteArrange } from './record-arrange-context';
import {
  parseBatchMetadata,
  updateBatchJob,
} from './record-batch-arrange-state';
import {
  currentAttachmentAttribution,
  loadAttachmentMaterial,
  type AttachmentMaterial,
} from './record-arrange-media-context';
import {
  newAttachmentArrangeJob,
  readAttachmentArrangeMetadata,
} from './parsed-attachment-state';
import {
  undoAttachmentPersonReviewInTransaction,
  AttachmentReviewConflict,
} from './attachment-person-review-undo';

function reviewId(materialId: string, version: string) {
  return (
    'attachment-review-' +
    createHash('sha256')
      .update(JSON.stringify([materialId, version]))
      .digest('hex')
  );
}

/** Parse completion is not scope capture. This producer consumes only already
 * persisted complete captures; unclassified staged uploads stay pending and
 * never enqueue a model. Each material's generation is independently durable. */
export function createParsedAttachmentBatchRequests(
  deps: NativeBatchDependencies,
) {
  async function ensureGeneration(
    tx: Transaction,
    material: AttachmentMaterial,
  ) {
    const { state, canonical, proofs, actor, scopeAllowed } = material;
    const attribution = currentAttachmentAttribution(state);
    if (
      !scopeAllowed ||
      !canonical ||
      !attribution ||
      !attribution.personIds.length ||
      !canWriteArrange(
        actor,
        attribution.personIds,
        null,
        state.input.evaluationNodeId!,
      ) ||
      attribution.personIds.some(
        (id) =>
          !proofs.every((proof) =>
            proof.subjects.some((subject) => subject.personId === id),
          ),
      )
    )
      return null;
    const nextContexts = [...state.input.sourceContexts];
    for (const proof of proofs) {
      const index = nextContexts.findIndex(
        (row) =>
          row.fragmentId === proof.reference.fragmentId &&
          row.originalVersionId === proof.originalVersionId,
      );
      const previous = index < 0 ? null : nextContexts[index]!;
      const context = {
        fragmentId: proof.reference.fragmentId,
        originalVersionId: proof.originalVersionId,
        subjects: [
          ...new Map(
            [...(previous?.subjects ?? []), ...proof.subjects].map(
              (subject) => [JSON.stringify(subject), subject],
            ),
          ).values(),
        ],
        attributedPersonIds: [...attribution.personIds],
        kind: proof.kind,
        requiredKinds: [
          ...new Set([
            ...(previous?.requiredKinds ?? []),
            ...(previous && previous.kind !== proof.kind
              ? [previous.kind]
              : []),
            ...proof.requiredKinds,
          ]),
        ],
      };
      if (index < 0) nextContexts.push(context);
      else nextContexts[index] = context;
    }
    await tx
      .update(arrangeInputs)
      .set({
        sourceContexts: nextContexts,
        personIds: [
          ...new Set(
            nextContexts.flatMap((context) => context.attributedPersonIds),
          ),
        ].sort(),
      })
      .where(eq(arrangeInputs.id, state.input.id));
    const job = newAttachmentArrangeJob(
      {
        parentInputId: state.input.id,
        parentInputVersion: state.input.inputVersion,
        batchId: state.input.batchId!,
        materialId: state.material.id,
        originalVersionId: state.material.originalVersionId,
        parseVersionId: canonical.binding.parseVersionId,
        captureAuditId: state.material.scopeAuditId!,
        materialRevision: state.material.revision,
        reviewItemId: attribution.item?.id ?? null,
        reviewOperationId: attribution.operation?.id ?? null,
        itemRevision: attribution.item?.revision ?? null,
        accountId: actor.context.account.id,
      },
      actor.context.account.personId,
      deps.now().toISOString(),
    );
    const existing = await readJobInTransaction(tx, job.jobId, true);
    if (existing) {
      if (!readAttachmentArrangeMetadata(existing))
        throw new AttachmentReviewConflict('generation_conflict');
      return existing;
    }
    await insertJob(tx, job);
    await deps.enqueue(tx, job);
    return job;
  }

  async function refreshInTransaction(tx: Transaction, parseJobId: string) {
    const intake = await readIntakeTable(tx, 'locked-for-write');
    const [row] = await tx
      .select()
      .from(mediaMaterials)
      .where(eq(mediaMaterials.parseJobId, parseJobId));
    if (!row) return 'ignored';
    const material = await loadAttachmentMaterial(
      tx,
      row.id,
      deps.businessNow(),
      intake,
    );
    if (!material) return 'ignored';
    const { state } = material;
    const attribution = currentAttachmentAttribution(state);
    if (
      material.canonical &&
      (!material.scopeKnown || !attribution) &&
      !state.items.some((item) => item.kind === 'unknown_person')
    ) {
      const item = materialReviewItemSchema.parse({
        itemId: reviewId(row.id, row.originalVersionId),
        batchId: state.input.batchId,
        evaluationNodeId: state.input.evaluationNodeId,
        materialId: row.id,
        originalVersionId: row.originalVersionId,
        revision: 1,
        state: 'pending',
        source: null,
        kind: 'unknown_person',
        observedName: null,
        candidates: [],
      });
      await tx.insert(mediaReviewItems).values({
        id: item.itemId,
        materialId: row.id,
        kind: item.kind,
        revision: 1,
        state: 'pending',
        question: item,
        currentOperationId: null,
      });
    }
    // The parent's queue is not a second model job. Receipt derives current
    // per-file work; awaiting_manual is the settled intake/control state.
    if (
      state.job.status === 'queued' &&
      material.parseJob &&
      ['completed', 'failed', 'cancelled'].includes(material.parseJob.status)
    ) {
      const parent = await readJobInTransaction(tx, state.job.jobId, true);
      const metadata = parent && parseBatchMetadata(parent.result);
      if (parent && metadata)
        await tx
          .update(jobSnapshots)
          .set(
            updateBatchJob(
              parent,
              'needs_review',
              metadata,
              deps.now().toISOString(),
            ),
          )
          .where(eq(jobSnapshots.jobId, parent.jobId));
    }
    const job = await ensureGeneration(tx, material);
    return job ? 'queued' : material.canonical ? 'needs_review' : 'settled';
  }
  const refreshForParseJob = (parseJobId: string) =>
    deps.db.transaction((tx) => refreshInTransaction(tx, parseJobId), {
      isolationLevel: 'read committed',
    });

  async function visiblePendingItems(
    tx: Transaction,
    inputId: string,
    accountId: string,
  ) {
    const rows = await tx
      .select({ item: mediaReviewItems })
      .from(mediaReviewItems)
      .innerJoin(
        mediaMaterials,
        eq(mediaMaterials.id, mediaReviewItems.materialId),
      )
      .where(eq(mediaMaterials.inputId, inputId));
    const intake = await readIntakeTable(tx, 'locked-for-write');
    const visible = new Set<string>();
    for (const materialId of new Set(rows.map(({ item }) => item.materialId))) {
      const material = await loadAttachmentMaterial(
        tx,
        materialId,
        deps.businessNow(),
        intake,
        accountId,
      );
      if (
        material &&
        (material.scopeKnown
          ? material.scopeAllowed
          : material.state.input.creatorAccountId === accountId)
      )
        visible.add(materialId);
    }
    return rows
      .filter(
        ({ item }) => visible.has(item.materialId) && item.state !== 'resolved',
      )
      .map(({ item }) => item.id);
  }

  async function resolve(
    accountId: string,
    raw: unknown,
  ): Promise<MaterialReviewCommandResult> {
    const checked = materialReviewCommandSchema.safeParse(raw);
    if (!checked.success || checked.data.kind !== 'unknown_person')
      return {
        status: 'validation_error',
        fieldErrors: { input: ['请提供当前人员核对项及其版本'] },
        input: raw,
      };
    const command = checked.data;
    try {
      return await deps.db.transaction(
        async (tx): Promise<MaterialReviewCommandResult> => {
          const intake = await readIntakeTable(tx, 'locked-for-write');
          const [hint] = await tx
            .select()
            .from(mediaReviewItems)
            .where(eq(mediaReviewItems.id, command.itemId));
          const material =
            hint &&
            (await loadAttachmentMaterial(
              tx,
              hint.materialId,
              deps.businessNow(),
              intake,
              accountId,
            ));
          if (
            !material ||
            material.state.input.batchId !== command.batchId ||
            (material.scopeKnown && !material.scopeAllowed) ||
            (!material.scopeKnown &&
              material.state.input.creatorAccountId !== accountId)
          )
            return { status: 'not_found', message: '材料不存在或当前不可见' };
          const { state, actor } = material;
          if (
            command.resolution.action === 'bind_people' &&
            (!material.scopeAllowed ||
              !canWriteArrange(
                actor,
                command.resolution.personIds,
                null,
                state.input.evaluationNodeId!,
              ) ||
              command.resolution.personIds.some(
                (personId) =>
                  !material.proofs.every((proof) =>
                    proof.subjects.some(
                      (subject) => subject.personId === personId,
                    ),
                  ),
              ))
          )
            return {
              status: 'conflict',
              message: '材料的完整范围尚不可用或当前无权处理，核对输入已保留',
              input: command,
            };
          const fingerprint = arrangeOperationFingerprint(command);
          const [previous] = await tx
            .select()
            .from(mediaReviewOperations)
            .where(
              and(
                eq(mediaReviewOperations.actorAccountId, accountId),
                eq(mediaReviewOperations.operationId, command.operationId),
              ),
            );
          if (previous) {
            if (
              previous.fingerprint !== fingerprint ||
              previous.materialId !== state.material.id ||
              previous.actorPersonId !== actor.context.account.personId
            )
              return {
                status: 'conflict',
                message: '操作号已用于不同核对，请保留输入并刷新',
                input: command,
              };
            const receipt = materialReviewResolutionReceiptSchema.parse(
              previous.receipt,
            );
            const visible = await visiblePendingItems(
              tx,
              state.input.id,
              accountId,
            );
            return {
              status: 'success',
              replayed: true,
              result: {
                ...receipt,
                remainingReviewItemIds: receipt.remainingReviewItemIds.filter(
                  (id) => visible.includes(id),
                ),
                blockingReviewItemIds: receipt.blockingReviewItemIds.filter(
                  (id) => visible.includes(id),
                ),
              },
            };
          }
          const item = state.items.find((row) => row.id === command.itemId);
          if (
            !item ||
            item.kind !== 'unknown_person' ||
            item.revision !== command.expectedRevision ||
            item.state === 'resolved'
          )
            return {
              status: 'conflict',
              message: '核对项版本已变化，请保留输入并刷新',
              input: command,
            };
          const operationId = randomUUID();
          const nextRevision = item.revision + 1;
          const remaining = (
            await visiblePendingItems(tx, state.input.id, accountId)
          ).filter((id) => id !== item.id);
          if (command.resolution.action === 'defer') remaining.push(item.id);
          const generation =
            command.resolution.action === 'bind_people' && material.canonical
              ? newAttachmentArrangeJob(
                  {
                    parentInputId: state.input.id,
                    parentInputVersion: state.input.inputVersion,
                    batchId: state.input.batchId!,
                    materialId: state.material.id,
                    originalVersionId: state.material.originalVersionId,
                    parseVersionId: material.canonical.binding.parseVersionId,
                    captureAuditId: state.material.scopeAuditId!,
                    materialRevision: state.material.revision,
                    reviewItemId: item.id,
                    reviewOperationId: operationId,
                    itemRevision: nextRevision,
                    accountId,
                  },
                  actor.context.account.personId,
                  deps.now().toISOString(),
                )
              : null;
          const receipt = materialReviewResolutionReceiptSchema.parse({
            batchId: state.input.batchId,
            materialId: state.material.id,
            itemId: item.id,
            revision: nextRevision,
            kind: 'unknown_person',
            resolution: command.resolution,
            remainingReviewItemIds: remaining,
            blockingReviewItemIds:
              command.resolution.action === 'defer' ? [item.id] : [],
            invalidatedDraftIds: [],
            resume: generation
              ? { stage: 'organizing', jobId: generation.jobId }
              : null,
          });
          const auditId = await recordAudit(tx, {
            actorId: accountId,
            action: 'material.review',
            resourceId: state.material.id,
          });
          await tx.insert(mediaReviewOperations).values({
            id: operationId,
            actorAccountId: accountId,
            actorPersonId: actor.context.account.personId,
            operationId: command.operationId,
            fingerprint,
            itemId: item.id,
            materialId: state.material.id,
            action: 'resolve',
            sourceOperationId: null,
            command,
            receipt,
            changes: [
              {
                itemId: item.id,
                previousRevision: item.revision,
                revision: nextRevision,
              },
            ],
            auditId,
            createdAt: deps.now(),
          });
          await tx
            .update(mediaReviewItems)
            .set({
              revision: nextRevision,
              state:
                command.resolution.action === 'defer' ? 'deferred' : 'resolved',
              currentOperationId: operationId,
            })
            .where(
              and(
                eq(mediaReviewItems.id, item.id),
                eq(mediaReviewItems.revision, item.revision),
              ),
            );
          if (generation) {
            const current = await loadAttachmentMaterial(
              tx,
              state.material.id,
              deps.businessNow(),
              await readIntakeTable(tx, 'locked-for-write'),
              accountId,
            );
            const enqueued = current && (await ensureGeneration(tx, current));
            if (!enqueued || enqueued.jobId !== generation.jobId)
              throw new AttachmentReviewConflict('resume_not_committed');
          }
          return { status: 'success', replayed: false, result: receipt };
        },
        { isolationLevel: 'read committed' },
      );
    } catch (error) {
      if (error instanceof AttachmentReviewConflict)
        return {
          status: 'conflict',
          message: '核对项或整理状态已变化，请保留输入并刷新',
          input: command,
        };
      throw error;
    }
  }
  async function undo(
    accountId: string,
    raw: unknown,
  ): Promise<MaterialReviewUndoResult> {
    // The mutation adapter validates the strict897 command. Locate only by its
    // itemId; no caller source/scope/actor facts are accepted.
    const { materialReviewUndoCommandSchema } =
      await import('../../contracts/material-review');
    const checked = materialReviewUndoCommandSchema.safeParse(raw);
    if (!checked.success || checked.data.kind !== 'unknown_person')
      return {
        status: 'validation_error',
        fieldErrors: { input: ['请提供当前核对项版本'] },
        input: raw,
      };
    try {
      return await deps.db.transaction(
        async (tx): Promise<MaterialReviewUndoResult> => {
          const intake = await readIntakeTable(tx, 'locked-for-write');
          const [hint] = await tx
            .select()
            .from(mediaReviewItems)
            .where(eq(mediaReviewItems.id, checked.data.itemId));
          const material =
            hint &&
            (await loadAttachmentMaterial(
              tx,
              hint.materialId,
              deps.businessNow(),
              intake,
              accountId,
            ));
          if (
            !material ||
            (material.scopeKnown && !material.scopeAllowed) ||
            (!material.scopeKnown &&
              material.state.input.creatorAccountId !== accountId)
          )
            return { status: 'not_found', message: '材料不存在或当前不可见' };
          const result = await undoAttachmentPersonReviewInTransaction(
            tx,
            material.state,
            { accountId, personId: material.actor.context.account.personId },
            checked.data,
            deps.now(),
          );
          return {
            status: 'success',
            replayed: result.replayed,
            result: result.receipt,
          };
        },
        { isolationLevel: 'read committed' },
      );
    } catch (error) {
      if (error instanceof AttachmentReviewConflict)
        return {
          status: 'conflict',
          message: '核对项或依赖的人工确认已变化，请保留输入并刷新',
          input: checked.data,
        };
      throw error;
    }
  }
  return {
    refreshForParseJob,
    resolve,
    undo,
    async recover() {
      const rows = await deps.db
        .select({ parseJobId: mediaMaterials.parseJobId })
        .from(mediaMaterials)
        .innerJoin(
          jobSnapshots,
          eq(jobSnapshots.jobId, mediaMaterials.parseJobId),
        )
        .where(
          inArray(jobSnapshots.status, ['completed', 'failed', 'cancelled']),
        );
      for (const row of rows) await refreshForParseJob(row.parseJobId);
      return rows.length;
    },
  };
}
