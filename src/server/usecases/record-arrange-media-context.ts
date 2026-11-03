import { isDeepStrictEqual } from 'node:util';
import { eq, inArray, isNull, and } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import { canReadTalent } from '../authz/talent';
import { accountBindings, grants, people } from '../modules/directory';
import {
  evaluationNodes,
  evaluationNodeSubjects,
  evaluationRelations,
  enrollments,
  assignments,
} from '../modules/programs';
import { readEvidenceForTalent, recordSaves } from '../modules/records';
import {
  readMediaReviewStateInTransaction,
  type MediaReviewState,
} from '../modules/records/material-review/read';
import { readMaterialParse } from '../modules/records/material-sources/store';
import { attachmentJobResultSchema } from '../modules/records/attachments/flow';
import { jobSnapshots } from '../jobs/schema';
import { materialParses } from '../modules/records/schema';
import {
  materialReviewCommandSchema,
  materialReviewItemSchema,
  materialReviewResolvedItemSchema,
  materialReviewResolutionReceiptSchema,
} from '../../contracts/material-review';
import { arrangeOperationFingerprint } from '../modules/records/arrange/input-state/bind';
import type { BatchSnapshot } from '../modules/records/arrange/batch';
import { loadArrangeActor } from './record-arrange-context';
import { canResolveAttachmentSubjects } from './parsed-attachment-authorization';
import { parseBatchMetadata } from './record-batch-arrange-state';
import {
  completeTalentSources,
  intakeMediaFacts,
  type IntakeTable,
} from './talent-source-projection';
import type { AttachmentArrangeMetadata } from './parsed-attachment-state';

/** Locks only local facts, never a provider call. Intake lock comes first;
 * model ports also lock the parent draft batch before entering source locks. */
async function lockAuthority(tx: Transaction, accountId: string) {
  await tx
    .select()
    .from(accountBindings)
    .where(eq(accountBindings.accountId, accountId))
    .for('share');
  await tx
    .select()
    .from(grants)
    .where(eq(grants.accountId, accountId))
    .orderBy(grants.id)
    .for('share');
  await tx.select().from(people).orderBy(people.id).for('share');
  await tx
    .select()
    .from(evaluationNodes)
    .orderBy(evaluationNodes.id)
    .for('share');
  await tx.select().from(evaluationNodeSubjects).for('share');
  await tx
    .select()
    .from(evaluationRelations)
    .orderBy(evaluationRelations.id)
    .for('share');
  await tx.select().from(enrollments).orderBy(enrollments.id).for('share');
  await tx.select().from(assignments).orderBy(assignments.id).for('share');
}

export async function loadAttachmentMaterial(
  tx: Transaction,
  materialId: string,
  at: string,
  intake: IntakeTable,
  requesterAccountId?: string,
) {
  const state = await readMediaReviewStateInTransaction(tx, materialId);
  if (
    !state ||
    state.availability !== 'current' ||
    !state.upload ||
    !state.input.batchId ||
    !state.input.evaluationNodeId ||
    !state.input.boundAt ||
    !state.input.occurredOn ||
    state.input.origin !== 'attachment' ||
    !('kind' in state.input.originalInput) ||
    state.input.originalInput.kind !== 'media' ||
    !state.input.originalInput.materialIds.includes(materialId) ||
    state.input.projectId !== null ||
    state.upload.accountId !== state.input.creatorAccountId
  )
    return null;
  const attribution = currentAttachmentAttribution(state);
  const accountId =
    requesterAccountId ??
    attribution?.operation?.actorAccountId ??
    state.input.creatorAccountId;
  await lockAuthority(tx, accountId);
  const actor = await loadArrangeActor(tx, accountId, at);
  const parent = parseBatchMetadata(state.job.result);
  if (
    !parent ||
    (accountId === state.input.creatorAccountId &&
      actor.context.account.personId !== parent.actorPersonId) ||
    (!requesterAccountId &&
      attribution?.operation &&
      actor.context.account.personId !== attribution.operation.actorPersonId) ||
    !canResolveAttachmentSubjects(actor, [], state.input.evaluationNodeId)
  )
    return null;
  const [parseJob] = await tx
    .select()
    .from(jobSnapshots)
    .where(eq(jobSnapshots.jobId, state.material.parseJobId));
  const result = attachmentJobResultSchema.safeParse(parseJob?.result);
  const parses = await tx
    .select()
    .from(materialParses)
    .where(eq(materialParses.jobId, state.material.parseJobId));
  let canonical: Awaited<ReturnType<typeof readMaterialParse>> = null;
  if (
    parseJob?.status === 'completed' &&
    result.success &&
    result.data.stage === 'parsed' &&
    parses.length === 1
  )
    canonical = await readMaterialParse(tx, parses[0]!.id);
  if (
    canonical &&
    (!result.success ||
      parseJob?.resourceId !== state.material.uploadId ||
      parseJob.inputVersion !== state.material.originalVersionId ||
      canonical.binding.originalVersionId !==
        state.material.originalVersionId ||
      canonical.jobId !== parseJob.jobId ||
      !isDeepStrictEqual(
        [...result.data.fragmentIds].sort(),
        canonical.fragments.map((source) => source.fragmentId).sort(),
      ))
  )
    return null;
  const proofs = intakeMediaFacts(intake).filter(
    (fact) =>
      fact.inputId === state.input.id &&
      fact.inputVersion === state.input.inputVersion &&
      fact.materialId === state.material.id,
  );
  const scopeKnown =
    canonical !== null &&
    proofs.length === canonical.fragments.length &&
    proofs.every(
      (proof) =>
        proof.parseVersionId === canonical!.binding.parseVersionId &&
        proof.occurredOn === state.input.occurredOn &&
        canonical!.fragments.some(
          (source) => source.fragmentId === proof.reference.fragmentId,
        ),
    );
  const scopeAllowed =
    scopeKnown &&
    proofs.every((proof) =>
      proof.subjects.every(
        (subject) =>
          canResolveAttachmentSubjects(
            actor,
            [subject.personId],
            subject.evaluationNodeId!,
          ) &&
          [proof.kind, ...proof.requiredKinds].every(
            (kind) =>
              canReadTalent(
                actor.context,
                { ...subject, kind },
                'source-read',
              ) &&
              canReadTalent(actor.context, { ...subject, kind }, 'model-input'),
          ),
      ),
    );
  return {
    state,
    actor,
    parseJob,
    canonical,
    proofs,
    scopeKnown,
    scopeAllowed,
  };
}
export type AttachmentMaterial = NonNullable<
  Awaited<ReturnType<typeof loadAttachmentMaterial>>
>;

/** Exact current attribution; this is deliberately separate from full scope. */
export function currentAttachmentAttribution(state: MediaReviewState) {
  const items = state.items.filter((item) => item.kind === 'unknown_person');
  if (!items.length) {
    const target = state.upload?.target;
    return target?.kind === 'people'
      ? { personIds: [...target.personIds], operation: null, item: null }
      : null;
  }
  if (items.length !== 1) return null;
  const item = items[0]!;
  const operation = state.operations.find(
    (row) => row.id === item.currentOperationId,
  );
  const command = materialReviewCommandSchema.safeParse(operation?.command);
  const receipt = materialReviewResolutionReceiptSchema.safeParse(
    operation?.receipt,
  );
  if (
    item.state !== 'resolved' ||
    !operation ||
    operation.action !== 'resolve' ||
    operation.sourceOperationId !== null ||
    operation.itemId !== item.id ||
    operation.materialId !== state.material.id ||
    operation.fingerprint !== arrangeOperationFingerprint(operation.command) ||
    !command.success ||
    command.data.kind !== 'unknown_person' ||
    command.data.resolution.action !== 'bind_people' ||
    command.data.batchId !== state.input.batchId ||
    command.data.itemId !== item.id ||
    command.data.expectedRevision + 1 !== item.revision ||
    command.data.operationId !== operation.operationId ||
    !receipt.success ||
    receipt.data.kind !== 'unknown_person' ||
    receipt.data.batchId !== state.input.batchId ||
    receipt.data.materialId !== state.material.id ||
    receipt.data.itemId !== item.id ||
    receipt.data.revision !== item.revision ||
    !isDeepStrictEqual(receipt.data.resolution, command.data.resolution) ||
    !isDeepStrictEqual(operation.changes, [
      {
        itemId: item.id,
        previousRevision: command.data.expectedRevision,
        revision: item.revision,
      },
    ]) ||
    !state.audits.some(
      (audit) =>
        audit.id === operation.auditId &&
        audit.action === 'material.review' &&
        audit.resourceId === state.material.id &&
        audit.actorId === operation.actorAccountId,
    )
  )
    return null;
  return { personIds: command.data.resolution.personIds, operation, item };
}

export async function currentAttachmentReviewItems(
  tx: Transaction,
  material: AttachmentMaterial,
) {
  const { state, actor } = material;
  const pending = state.items
    .filter((row) => row.state !== 'resolved')
    .map((row) =>
      materialReviewItemSchema.parse({
        ...row.question,
        revision: row.revision,
        state: row.state,
        ...(row.kind === 'unknown_person'
          ? {
              candidates: actor.directory.people
                .filter((person) =>
                  canResolveAttachmentSubjects(
                    actor,
                    [person.id],
                    state.input.evaluationNodeId!,
                  ),
                )
                .map((person) => ({
                  personId: person.id,
                  displayName: person.name,
                })),
            }
          : {}),
      }),
    );
  const resolved = [];
  for (const item of state.items.filter(
    (row) => row.state === 'resolved' && row.kind === 'unknown_person',
  )) {
    const question = materialReviewItemSchema.safeParse(item.question);
    if (!question.success || question.data.kind !== 'unknown_person') continue;
    const operation = state.operations.find(
      (row) => row.id === item.currentOperationId,
    );
    const command = materialReviewCommandSchema.safeParse(operation?.command);
    if (
      !operation ||
      !command.success ||
      command.data.kind !== 'unknown_person' ||
      !['bind_people', 'keep_original_only'].includes(
        command.data.resolution.action,
      )
    )
      continue;
    const deps = state.dependencies
      .filter((row) => row.operationId === operation.id)
      .map((row) => row.draftId);
    const saved = deps.length
      ? await tx
          .select({ id: recordSaves.saveId })
          .from(recordSaves)
          .where(
            and(
              inArray(recordSaves.draftId, deps),
              isNull(recordSaves.withdrawnAt),
            ),
          )
          .limit(1)
      : [];
    const { candidates: _candidates, ...resolvedQuestion } = question.data;
    void _candidates;
    resolved.push(
      materialReviewResolvedItemSchema.parse({
        ...resolvedQuestion,
        revision: item.revision,
        state: 'resolved',
        resolution: command.data.resolution,
        resolvedAt: operation.createdAt.toISOString(),
        auditId: operation.auditId,
        undo: saved.length
          ? { status: 'blocked', reason: 'dependent_draft_confirmed' }
          : { status: 'available' },
      }),
    );
  }
  return { pending, resolved };
}

export async function loadAttachmentBatchSnapshot(
  tx: Transaction,
  material: AttachmentMaterial,
  metadata: AttachmentArrangeMetadata,
  intake: IntakeTable,
): Promise<BatchSnapshot | null> {
  const { state, actor, canonical, proofs, scopeAllowed } = material;
  const generation = metadata.generation;
  const attribution = currentAttachmentAttribution(state);
  if (
    !canonical ||
    !scopeAllowed ||
    !attribution ||
    !attribution.personIds.length ||
    actor.context.account.id !== generation.accountId ||
    actor.context.account.personId !== metadata.arrange.actorPersonId ||
    generation.parentInputId !== state.input.id ||
    generation.parentInputVersion !== state.input.inputVersion ||
    generation.materialId !== state.material.id ||
    generation.parseVersionId !== canonical.binding.parseVersionId ||
    generation.captureAuditId !== state.material.scopeAuditId ||
    generation.materialRevision !== state.material.revision ||
    generation.reviewItemId !== (attribution.item?.id ?? null) ||
    generation.reviewOperationId !== (attribution.operation?.id ?? null) ||
    generation.itemRevision !== (attribution.item?.revision ?? null) ||
    !canResolveAttachmentSubjects(
      actor,
      attribution.personIds,
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
  const evidence = await readEvidenceForTalent(tx);
  const complete = completeTalentSources({ ...actor, ...evidence, intake });
  const sources = canonical.fragments.map((source) => {
    const graph = complete.find(
      (row) =>
        row.fragmentId === source.fragmentId &&
        row.originalVersionId === source.originalVersionId,
    );
    const context = state.input.sourceContexts.find(
      (row) =>
        row.fragmentId === source.fragmentId &&
        row.originalVersionId === source.originalVersionId,
    );
    if (
      !graph ||
      !graph.subjects.length ||
      !context ||
      !isDeepStrictEqual(
        [...context.attributedPersonIds].sort(),
        [...attribution.personIds].sort(),
      )
    )
      return null;
    return {
      reference: {
        fragmentId: source.fragmentId,
        originalVersionId: source.originalVersionId,
        location: source.location,
      },
      text: source.excerpt,
      complete: true,
      scope: 'resolved' as const,
      category: 'original' as const,
      kind: graph.kind,
      requiredKinds: graph.requiredKinds ?? [],
      subjects: graph.subjects,
      attributedPersonIds: attribution.personIds,
      reviewItemIds: attribution.item ? [attribution.item.id] : [],
      acquisition: {
        kind: 'parsed_attachment' as const,
        parseVersionId: canonical.binding.parseVersionId,
      },
    };
  });
  if (sources.some((source) => source === null)) return null;
  const available = sources.filter((source) => source !== null);
  const reviews = await currentAttachmentReviewItems(tx, material);
  return {
    batchId: state.input.batchId!,
    accountId: generation.accountId,
    evaluationNodeId: state.input.evaluationNodeId!,
    batchRevision: metadata.generationRevision,
    inputVersion: generationInputVersion(metadata),
    boundAt: state.input.boundAt!.toISOString(),
    occurredOn: state.input.occurredOn!,
    project: { state: 'none' },
    reviewItems: reviews.pending,
    resolvedItems: reviews.resolved,
    writeAllowed: true,
    identities: 'resolved',
    personIds: attribution.personIds,
    context: actor.context,
    requestedSources: available.map((source) => source.reference),
    availableSources: available,
    generation: { kind: 'initial' },
  };
}

import { attachmentGenerationIdentity } from './parsed-attachment-state';
const generationInputVersion = (metadata: AttachmentArrangeMetadata) =>
  attachmentGenerationIdentity(metadata.generation).inputVersion;
