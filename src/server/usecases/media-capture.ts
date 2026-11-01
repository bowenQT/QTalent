import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Transaction } from '../db/client';
import { canReadTalent } from '../authz/talent';
import { jobSnapshots } from '../jobs/schema';
import { recordAudit } from '../platform/audit';
import { auditEvents } from '../platform/audit/schema';
import { arrangeInputs } from '../modules/records/arrange/input-state/schema';
import { mediaRecordOriginalInputSchema } from '../modules/records/arrange/input-state/original-input';
import { mediaMaterials } from '../modules/records/material-review/schema';
import { mediaIntakeScopeSchema } from '../modules/records/material-review/scope';
import { readUploadCollectionMembers } from '../modules/records/uploads/store';
import { validatedUploadFromFacts } from '../modules/records/uploads/handoff';
import { uploadObjects } from '../modules/records/uploads/schema';
import { originalVersions, fragments } from '../modules/records/schema';
import { lockMediaAuthorityFacts } from './media-authority-locks';
import { canWriteArrange, loadArrangeActor } from './record-arrange-context';
import { parseBatchMetadata } from './record-batch-arrange-state';

const id = z.string().min(1).max(200).regex(/\S/);
const captureSchema = z.strictObject({
  materialId: id,
  inputId: id,
  inputVersion: id,
  clientFileId: id,
  uploadId: id,
  recordCollectionId: id,
  originalVersionId: id,
  scope: mediaIntakeScopeSchema.nullable(),
});
export type MediaCaptureInput = z.infer<typeof captureSchema>;
export class MediaCaptureUnavailable extends Error {
  constructor() {
    super('media_capture_unavailable');
  }
}

/** Internal intake composition, never a client scope/permission endpoint.
 * The caller has collected the original's complete scope from a trusted source;
 * unknown scope MUST be null. Parsing does not establish completeness. Register
 * all files in the same outer RC transaction as the existing intake. No dispatch
 * occurs here. Capture facts are immutable, including an unknown initial scope.
 */
export async function captureMediaMaterialInTransaction(
  tx: Transaction,
  accountId: string,
  raw: MediaCaptureInput,
  now: string,
) {
  const command = captureSchema.parse(raw);
  z.iso.datetime().parse(now);
  function fail(): never {
    throw new MediaCaptureUnavailable();
  }
  // The collection reader checks RC and owns the same quota lock as release.
  if (!(await readUploadCollectionMembers(tx, command.recordCollectionId)))
    fail();
  const [hint] = await tx
    .select()
    .from(arrangeInputs)
    .where(eq(arrangeInputs.id, command.inputId));
  if (!hint) fail();
  const [job] = await tx
    .select()
    .from(jobSnapshots)
    .where(eq(jobSnapshots.jobId, hint.jobId))
    .for('update');
  const [input] = await tx
    .select()
    .from(arrangeInputs)
    .where(eq(arrangeInputs.id, command.inputId))
    .for('update');
  const [existing] = await tx
    .select()
    .from(mediaMaterials)
    .where(eq(mediaMaterials.id, command.materialId))
    .for('update');
  const collection = await readUploadCollectionMembers(
    tx,
    command.recordCollectionId,
  );
  if (!collection || !input || !job) fail();
  const member = collection.members.find(
    (row) => row.intent.id === command.uploadId,
  );
  if (
    !member ||
    member.intent.releasedAt !== null ||
    member.intent.accountId !== accountId
  )
    fail();
  const upload = validatedUploadFromFacts(
    member.intent,
    member.object,
    command,
  );
  const original = mediaRecordOriginalInputSchema.safeParse(
    input.originalInput,
  );
  const metadata = parseBatchMetadata(job.result);
  if (
    !upload ||
    !original.success ||
    !metadata ||
    collection.collection.creatorAccountId !== accountId ||
    input.creatorAccountId !== accountId ||
    input.origin !== 'attachment' ||
    input.inputVersion !== command.inputVersion ||
    input.supersededByInputId !== null ||
    input.jobId !== job.jobId ||
    job.resourceId !== input.id ||
    job.inputVersion !== input.inputVersion ||
    job.kind !== 'record_organize' ||
    job.status !== 'awaiting_manual' ||
    job.cancelRequestedAt !== null ||
    metadata.trace !== null ||
    metadata.manifest.length ||
    metadata.failure !== null ||
    metadata.operationId !== original.data.operationId ||
    !original.data.materialIds.includes(command.materialId) ||
    !input.batchId ||
    !input.evaluationNodeId ||
    !input.boundAt ||
    !input.occurredOn ||
    input.projectMode !== 'none' ||
    input.projectId !== null
  )
    fail();
  const target = collection.collection.target;
  if (
    target.kind !== 'people' ||
    upload.target.kind !== 'people' ||
    JSON.stringify([...target.personIds].sort()) !==
      JSON.stringify([...upload.target.personIds].sort())
  )
    fail();
  const [version] = await tx
    .select()
    .from(originalVersions)
    .where(eq(originalVersions.id, command.originalVersionId))
    .for('update');
  await tx
    .select()
    .from(uploadObjects)
    .where(eq(uploadObjects.originalVersionId, command.originalVersionId))
    .for('share');
  if (
    !version ||
    version.originalId !== upload.originalId ||
    version.contentDigest !== upload.object.sha256
  )
    fail();
  const batchMaterials = await tx
    .select()
    .from(mediaMaterials)
    .where(eq(mediaMaterials.inputId, input.id));
  if (
    batchMaterials.some(
      (row) =>
        row.recordCollectionId !== command.recordCollectionId ||
        row.inputVersion !== input.inputVersion ||
        !original.data.materialIds.includes(row.id) ||
        (row.id !== command.materialId &&
          (row.clientFileId === command.clientFileId ||
            row.uploadId === command.uploadId)),
    )
  )
    fail();
  const scope = command.scope;
  const ids = [
    ...new Set([
      ...input.personIds,
      ...target.personIds,
      ...(scope?.subjects.map((s) => s.personId) ?? []),
    ]),
  ].sort();
  if (
    !ids.length ||
    (scope &&
      (scope.occurredOn !== input.occurredOn ||
        scope.subjects.some(
          (s) => s.evaluationNodeId !== input.evaluationNodeId,
        ) ||
        ids.some(
          (personId) => !scope.subjects.some((s) => s.personId === personId),
        )))
  )
    fail();
  await lockMediaAuthorityFacts(tx, accountId, ids, [input.evaluationNodeId]);
  const actor = await loadArrangeActor(tx, accountId, now);
  if (
    metadata.actorPersonId !== actor.context.account.personId ||
    !canWriteArrange(actor, ids, null, input.evaluationNodeId)
  )
    fail();
  if (scope) {
    const node = actor.context.evaluationNodes.find(
      (n) => n.id === input.evaluationNodeId,
    );
    if (
      !node ||
      scope.subjects.some(
        (subject) =>
          subject.cohortId !== node.cohortId ||
          [scope.kind, ...scope.requiredKinds].some(
            (kind) =>
              !canReadTalent(
                actor.context,
                { ...subject, kind },
                'source-read',
              ),
          ),
      )
    )
      fail();
  }
  if (existing) {
    if (
      existing.inputId !== input.id ||
      existing.inputVersion !== input.inputVersion ||
      existing.clientFileId !== command.clientFileId ||
      existing.uploadId !== command.uploadId ||
      existing.recordCollectionId !== command.recordCollectionId ||
      existing.originalVersionId !== command.originalVersionId ||
      JSON.stringify(
        existing.intakeScope === null
          ? null
          : mediaIntakeScopeSchema.parse(existing.intakeScope),
      ) !== JSON.stringify(scope)
    )
      fail();
    if (scope !== null) {
      const [audit] = existing.scopeAuditId
        ? await tx
            .select()
            .from(auditEvents)
            .where(eq(auditEvents.id, existing.scopeAuditId))
        : [];
      if (
        !audit ||
        audit.actorId !== accountId ||
        audit.action !== 'material.capture' ||
        audit.resourceId !== existing.id
      )
        fail();
    }
    return { material: existing, replayed: true };
  }
  // Initial captures precede canonical publication. Later corrections belong to
  // explicit review, never an overwrite of the original capture provenance.
  if (
    (
      await tx
        .select({ id: fragments.id })
        .from(fragments)
        .where(eq(fragments.originalVersionId, version.id))
    ).length
  )
    fail();
  const scopeAuditId =
    scope === null
      ? null
      : await recordAudit(tx, {
          actorId: accountId,
          action: 'material.capture',
          resourceId: command.materialId,
        });
  const [material] = await tx
    .insert(mediaMaterials)
    .values({
      id: command.materialId,
      inputId: input.id,
      inputVersion: input.inputVersion,
      clientFileId: command.clientFileId,
      uploadId: command.uploadId,
      recordCollectionId: command.recordCollectionId,
      originalVersionId: version.id,
      revision: 1,
      intakeScope: scope,
      scopeAuditId,
      createdAt: new Date(now),
    })
    .returning();
  return { material: material!, replayed: false };
}
