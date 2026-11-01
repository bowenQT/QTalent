import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Database, Transaction } from '../db/client';
import { canReadTalent } from '../authz/talent';
import { accountBindings, grants, people } from '../modules/directory';
import {
  evaluationNodes,
  evaluationNodeSubjects,
  evaluationRelations,
  enrollments,
} from '../modules/programs';
import {
  readMediaReviewStateInTransaction,
  currentImageDecision,
} from '../modules/records';
import { canWriteArrange, loadArrangeActor } from './record-arrange-context';
import { parseBatchMetadata } from './record-batch-arrange-state';
import { ForbiddenError } from './project-context';
import { mediaRecordOriginalInputSchema } from '../modules/records/arrange/input-state/original-input';

const kind = z.enum([
  'person',
  'evaluation',
  'restricted-evaluation',
  'confirmed-score',
  'quadrant',
  'management-observation',
  'change',
  'performance',
  'ai-inference',
]);
const scopeSchema = z.strictObject({
  subjects: z
    .array(
      z.strictObject({
        personId: z.string().min(1),
        evaluationNodeId: z.string().min(1),
        cohortId: z.string().nullable(),
      }),
    )
    .min(1),
  kind,
  requiredKinds: z.array(kind),
  occurredOn: z.iso.date(),
});

/** First image extraction only. A canonical parsed source must use the complete
 * existing source loader instead. No URL, object key or original text is exposed.
 * Unknown capture scope stays unavailable; this does not create a capture UI or
 * turn the creating account into a processing permission.
 */
export async function readInitialImageDisclosureInTransaction(
  tx: Transaction,
  accountId: string,
  materialId: string,
  businessNow: string,
) {
  if (!z.iso.datetime().safeParse(businessNow).success) return null;
  const state = await readMediaReviewStateInTransaction(tx, materialId);
  if (
    !state ||
    state.availability !== 'current' ||
    state.job.status === 'completed' ||
    state.job.status === 'failed' ||
    !state.upload ||
    !state.version ||
    state.canonicalFragments.length ||
    !state.input.batchId ||
    !state.input.evaluationNodeId ||
    !state.input.boundAt ||
    !state.input.occurredOn ||
    state.input.projectMode !== 'none' ||
    state.input.creatorAccountId !== accountId ||
    state.collection.collection.creatorAccountId !== accountId ||
    state.version.originalId !== state.upload.originalId ||
    state.version.contentDigest !== state.upload.object.sha256
  )
    return null;
  const mediaType = z
    .enum(['image/png', 'image/jpeg', 'image/webp'])
    .safeParse(state.upload.object.mediaType);
  if (!mediaType.success) return null;
  const originalInput = mediaRecordOriginalInputSchema.safeParse(
    state.input.originalInput,
  );
  if (
    !originalInput.success ||
    state.input.origin !== 'attachment' ||
    !originalInput.data.materialIds.includes(materialId) ||
    JSON.stringify([...originalInput.data.materialIds].sort()) !==
      JSON.stringify(state.batchMaterials.map((row) => row.id).sort()) ||
    state.batchMaterials.some(
      (row) =>
        row.inputVersion !== state.input.inputVersion ||
        row.recordCollectionId !== state.material.recordCollectionId,
    )
  )
    return null;
  const decision = currentImageDecision(state);
  if (decision.state === 'unavailable') return null;
  // All persisted captures of this original remain restrictions, regardless of
  // creator, current assignment, released status or input supersession.
  const scopes = [];
  for (const material of state.originalMaterials) {
    const scope = scopeSchema.safeParse(material.intakeScope);
    if (
      !material.scopeAuditId ||
      !scope.success ||
      material.recordCollectionId !== state.material.recordCollectionId
    )
      return null;
    if (
      !state.audits.some(
        (audit) =>
          audit.id === material.scopeAuditId &&
          audit.resourceId === material.id &&
          audit.action === 'material.capture',
      )
    )
      return null;
    scopes.push(scope.data);
  }
  if (!scopes.length) return null;
  const subjects = scopes.flatMap((scope) => scope.subjects);
  const ids = [...new Set(subjects.map((subject) => subject.personId))].sort();
  const nodes = [
    ...new Set(subjects.map((subject) => subject.evaluationNodeId)),
  ].sort();
  const target = state.collection.collection.target;
  if (
    target.kind !== 'people' ||
    state.upload.target.kind !== 'people' ||
    target.personIds.some((id) => !ids.includes(id)) ||
    JSON.stringify([...target.personIds].sort()) !==
      JSON.stringify([...state.upload.target.personIds].sort())
  )
    return null;
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
  await tx
    .select()
    .from(people)
    .where(inArray(people.id, ids))
    .orderBy(people.id)
    .for('share');
  await tx
    .select()
    .from(evaluationNodes)
    .where(inArray(evaluationNodes.id, nodes))
    .orderBy(evaluationNodes.id)
    .for('share');
  await tx
    .select()
    .from(evaluationNodeSubjects)
    .where(inArray(evaluationNodeSubjects.personId, ids))
    .for('share');
  await tx
    .select()
    .from(evaluationRelations)
    .where(inArray(evaluationRelations.personId, ids))
    .orderBy(evaluationRelations.id)
    .for('share');
  await tx
    .select()
    .from(enrollments)
    .where(inArray(enrollments.personId, ids))
    .orderBy(enrollments.id)
    .for('share');
  let actor;
  try {
    actor = await loadArrangeActor(tx, accountId, businessNow);
  } catch (error) {
    if (error instanceof ForbiddenError) return null;
    throw error;
  }
  const metadata = parseBatchMetadata(state.job.result);
  if (
    !metadata ||
    metadata.operationId !== originalInput.data.operationId ||
    metadata.actorPersonId !== actor.context.account.personId
  )
    return null;
  const kinds = [
    ...new Set(scopes.flatMap((scope) => [scope.kind, ...scope.requiredKinds])),
  ];
  if (
    subjects.some(
      (subject) =>
        !canWriteArrange(
          actor,
          [subject.personId],
          null,
          subject.evaluationNodeId,
        ) ||
        kinds.some(
          (kind) =>
            !canReadTalent(
              actor.context,
              { ...subject, kind },
              'source-read',
            ) ||
            (decision.state === 'verified' &&
              !canReadTalent(
                actor.context,
                { ...subject, kind },
                'model-input',
              )),
        ),
    )
  )
    return null;
  if (
    subjects.some(
      (subject) => subject.evaluationNodeId !== state.input.evaluationNodeId,
    )
  )
    return null;
  if (
    decision.state === 'verified' &&
    decision.personIds.some((id) => !ids.includes(id))
  )
    return null;
  const uniqueSubjects = subjects
    .filter(
      (subject, index) =>
        subjects.findIndex(
          (other) =>
            other.personId === subject.personId &&
            other.evaluationNodeId === subject.evaluationNodeId,
        ) === index,
    )
    .map(({ personId, evaluationNodeId }) => ({ personId, evaluationNodeId }));
  const binding = {
    originalVersionId: state.material.originalVersionId,
    sha256: state.upload.object.sha256,
    revision: state.material.revision,
  };
  const scope =
    decision.state === 'attachment_only'
      ? { state: 'attachment_only' as const, ...binding }
      : {
          state: 'verified' as const,
          ...binding,
          region: decision.region,
          subjects: uniqueSubjects,
        };
  return {
    facts: {
      materialId,
      batchId: state.input.batchId,
      evaluationNodeId: state.input.evaluationNodeId,
      revision: state.material.revision,
      batchRevision: state.job.revision,
      recordCollectionId: state.material.recordCollectionId,
      memberRevision: state.member.intent.revision,
      // 905 members are the complete people set, not upload IDs or AI attribution.
      members: ids,
      originalId: state.upload.originalId,
      originalVersionId: state.material.originalVersionId,
      source: null,
      sha256: state.upload.object.sha256,
      byteLength: state.upload.object.byteLength,
      mediaType: mediaType.data,
      kind: scopes[0].kind,
      requiredKinds: kinds,
      cancelRequested: false,
      scope,
    },
    authority: {
      context: actor.context,
      processing: {
        accountId,
        recordCollectionId: state.material.recordCollectionId,
        memberRevision: state.member.intent.revision,
        allowed: true,
      },
    },
  };
}

/** Pass to 905 loadCurrent. Each call re-reads current facts; no lock crosses
 * byte retrieval/cropping/model dispatch. 905 retains its before/after fences.
 */
export function createInitialImageDisclosureReader(db: Database) {
  return (accountId: string, materialId: string, businessNow: string) =>
    db.transaction(
      (tx) =>
        readInitialImageDisclosureInTransaction(
          tx,
          accountId,
          materialId,
          businessNow,
        ),
      { isolationLevel: 'read committed' },
    );
}
