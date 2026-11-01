import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { Database, Transaction } from '../db/client';
import {
  recordSaveReceiptSchema,
  recordUndoReceiptSchema,
  type RecordBatchDraft,
  type RecordSaveInput,
  type RecordUndoInput,
} from '../../contracts/record';
import { accountBindings, grants, people } from '../modules/directory';
import {
  evaluationRelations,
  evaluationNodeSubjects,
  evaluationNodes,
  enrollments,
  assignments,
  evaluationWorkItems,
  completeEvaluationWorkItem,
  undoEvaluationWorkCompletion,
  canWorkOnEvaluationItem,
  assignedEvaluationRelationIsCurrent,
  EvaluationReassignmentError,
} from '../modules/programs';
import { projects, members } from '../modules/staffing';
import {
  anchors,
  ruleVersions,
  ruleVersionApplicability,
} from '../modules/evaluation-system';
import {
  fragments,
  originals,
  originalVersions,
  events,
  eventSources,
  historicalEvaluations,
  readEvidenceForTalent,
  lockRecordCommand,
  readRecordConfirmationState,
  commitRecordSave,
  commitRecordUndo,
  RecordWriteError,
  type RecordCommand,
  type RecordSaveLock,
  type RecordConfirmationWorkFact,
} from '../modules/records';
import {
  confirmations,
  scoreReviews,
  writeRecordConfirmations,
  withdrawRecordConfirmations,
  resolveRecordSourceFacts,
} from '../modules/talent';
import {
  ConfirmationError,
  confirmationAuthorizationDraft,
  confirmationFingerprint,
  type ConfirmationState,
  type ConfirmationSourceFact,
} from '../modules/talent/record-confirmation';
import { createConfirmRecordDraftUsecase } from './confirm-record-draft';
import { loadEvaluationContext } from './evaluation-context';
import { talentSources } from './talent-source-projection';
import { ForbiddenError } from './project-context';
import { recordAudit } from '../platform/audit';

export { ConfirmationError as RecordSaveError };

export interface RecordSaveClock {
  businessNow(): string;
  wallNow(): string;
}

/** Missing upstream material/binding facts are not a successful empty result. */
export class RecordSaveUnavailableError extends Error {
  readonly status = 'unavailable';
}

async function loadCurrent(
  tx: Transaction,
  accountId: string,
  at: string,
  originalPersonId?: string,
  retainedSave?: RecordSaveLock['retainedSave'],
) {
  const loaded = await loadEvaluationContext(tx, accountId, at);
  if (originalPersonId && loaded.context.account.personId !== originalPersonId)
    throw new ConfirmationError('forbidden', 'account_binding_changed');
  if (
    retainedSave &&
    (retainedSave.actorAccountId !== accountId ||
      retainedSave.actorPersonId !== loaded.context.account.personId)
  )
    throw new ConfirmationError('forbidden', 'original_save_binding_required');
  return loaded;
}

/** FK-backed graph locks: locking each fragment stops new source attachments;
 * locking its existing event/history parents stops new shared participants.
 * Reloading after these waits is essential: a pre-lock snapshot is not proof. */
async function lockSourceGraph(
  tx: Transaction,
  draft: RecordBatchDraft,
  mappedEventIds: string[],
) {
  const ids = [
    ...new Set(draft.sourceReferences.map((ref) => ref.fragmentId)),
  ].sort();
  await tx
    .select()
    .from(fragments)
    .where(inArray(fragments.id, ids))
    .orderBy(fragments.id)
    .for('update');
  const links = await tx
    .select()
    .from(eventSources)
    .where(inArray(eventSources.fragmentId, ids));
  const eventIds = [
    ...new Set([...mappedEventIds, ...links.map((row) => row.eventId)]),
  ].sort();
  if (eventIds.length)
    await tx
      .select()
      .from(events)
      .where(inArray(events.id, eventIds))
      .orderBy(events.id)
      .for('update');
  await tx
    .select()
    .from(historicalEvaluations)
    .where(inArray(historicalEvaluations.fragmentId, ids))
    .orderBy(historicalEvaluations.id)
    .for('update');
  const versionIds = [
    ...new Set(draft.sourceReferences.map((ref) => ref.originalVersionId)),
  ].sort();
  const versions = await tx
    .select()
    .from(originalVersions)
    .where(inArray(originalVersions.id, versionIds))
    .orderBy(originalVersions.id)
    .for('share');
  const originalIds = [
    ...new Set(versions.map((row) => row.originalId)),
  ].sort();
  if (originalIds.length)
    await tx
      .select()
      .from(originals)
      .where(inArray(originals.id, originalIds))
      .orderBy(originals.id)
      .for('share');
}

async function lockAuthority(
  tx: Transaction,
  accountId: string,
  actorPersonId: string,
  draft: RecordBatchDraft,
) {
  await tx
    .select()
    .from(grants)
    .where(eq(grants.accountId, accountId))
    .orderBy(grants.id)
    .for('share');
  // NoReview, source-wide HR enrollment and project membership can revoke a
  // capability too. These small existing directory/program snapshots stay
  // fixed until the source transaction commits; time is reloaded afterwards.
  await tx.select().from(people).orderBy(people.id).for('share');
  await tx
    .select()
    .from(evaluationRelations)
    .where(eq(evaluationRelations.evaluatorId, actorPersonId))
    .orderBy(evaluationRelations.id)
    .for('share');
  await tx
    .select()
    .from(evaluationNodes)
    .orderBy(evaluationNodes.id)
    .for('share');
  await tx
    .select()
    .from(evaluationNodeSubjects)
    .orderBy(
      evaluationNodeSubjects.evaluationNodeId,
      evaluationNodeSubjects.personId,
    )
    .for('share');
  await tx.select().from(enrollments).orderBy(enrollments.id).for('share');
  await tx.select().from(assignments).orderBy(assignments.id).for('share');
  if (draft.projectId !== null) {
    await tx
      .select()
      .from(projects)
      .where(eq(projects.id, draft.projectId))
      .for('share');
    await tx
      .select()
      .from(members)
      .where(eq(members.projectId, draft.projectId))
      .orderBy(members.id)
      .for('share');
  }
}

async function scoringState(tx: Transaction, eventIds: string[]) {
  if (!eventIds.length)
    return {
      confirmations: [],
      reviews: [],
      unknownHandledReviewEventIds: [] as string[],
    };
  const eventRows = await tx
    .select()
    .from(events)
    .where(inArray(events.id, eventIds));
  const scored = await tx
    .select()
    .from(confirmations)
    .where(inArray(confirmations.eventId, eventIds))
    .orderBy(confirmations.id)
    .for('update');
  const reviews = await tx
    .select()
    .from(scoreReviews)
    .where(inArray(scoreReviews.eventId, eventIds))
    .orderBy(scoreReviews.id)
    .for('update');
  return {
    confirmations: scored.map((row) => {
      const event = eventRows.find((event) => event.id === row.eventId);
      if (!event?.evaluationNodeId || row.evaluatorId === null)
        throw new ConfirmationError(
          'unavailable',
          'confirmation_identity_invalid',
        );
      return {
        id: row.id,
        eventId: row.eventId,
        dimensionId: row.dimensionId,
        evaluatorId: row.evaluatorId,
        personId: event.personId,
        evaluationNodeId: event.evaluationNodeId,
        revision: row.revision,
        active: row.active,
        value: row.value,
      };
    }),
    unknownHandledReviewEventIds: reviews
      .filter(
        (row) =>
          row.status === 'resolved' &&
          row.withdrawnAt === null &&
          row.confirmationId === null,
      )
      .map((row) => row.eventId),
    reviews: reviews.map((row) => ({
      id: row.id,
      confirmationIds: [
        row.confirmationId,
        row.counterpartConfirmationId,
      ].filter((id): id is string => id !== null),
      handled: row.status === 'resolved',
      withdrawn: row.withdrawnAt !== null,
    })),
  };
}

async function readFrozenRules(
  tx: Transaction,
  versions: { dimensionVersionId: string; anchorVersionId: string },
) {
  const ids = [...new Set(Object.values(versions))];
  const found = await tx
    .select()
    .from(ruleVersions)
    .where(inArray(ruleVersions.id, ids));
  const categories = await tx
    .select()
    .from(ruleVersionApplicability)
    .where(
      and(
        inArray(ruleVersionApplicability.versionId, ids),
        eq(ruleVersionApplicability.category, 'dimension_anchors'),
      ),
    );
  if (
    found.length !== ids.length ||
    ids.some((id) => !categories.some((row) => row.versionId === id))
  )
    return null;
  const rows = await tx
    .select()
    .from(anchors)
    .where(eq(anchors.ruleVersionId, versions.anchorVersionId))
    .orderBy(anchors.id)
    .for('share');
  return {
    ...versions,
    anchors: rows.map((row) => ({
      id: row.id,
      dimensionId: row.dimensionId,
      value: row.value,
      text: row.text,
      ruleVersion: row.ruleVersionId,
    })),
  };
}

async function readSources(
  tx: Transaction,
  accountId: string,
  draft: RecordBatchDraft,
  clock: RecordSaveClock,
  actorPersonId: string,
): Promise<ConfirmationSourceFact[]> {
  const data = await readEvidenceForTalent(tx);
  const current = await loadCurrent(
    tx,
    accountId,
    clock.businessNow(),
    actorPersonId,
  );
  const projected = talentSources({ ...data, ...current });
  return resolveRecordSourceFacts(draft.sourceReferences, {
    ...data,
    sources: projected,
  });
}

async function execute(
  db: Database,
  accountId: string,
  command: RecordCommand,
  clock: RecordSaveClock,
) {
  try {
    return await db.transaction(
      async (tx) => {
        await tx
          .select()
          .from(accountBindings)
          .where(eq(accountBindings.accountId, accountId))
          .for('share');
        const initial = await loadCurrent(tx, accountId, clock.businessNow());
        const actorPersonId = initial.context.account.personId;
        const lock = await lockRecordCommand(tx, accountId, command);
        await loadCurrent(
          tx,
          accountId,
          clock.businessNow(),
          actorPersonId,
          lock.retainedSave,
        );
        const before = await readRecordConfirmationState(tx, lock);
        const draft = confirmationAuthorizationDraft(
          { ...before, confirmations: [], reviews: [] },
          accountId,
          command,
        );
        const workItems = await tx
          .select()
          .from(evaluationWorkItems)
          .where(
            and(
              eq(evaluationWorkItems.kind, 'confirmation'),
              eq(evaluationWorkItems.resourceId, draft.draftId),
              eq(evaluationWorkItems.evaluationNodeId, draft.evaluationNodeId),
              inArray(evaluationWorkItems.personId, draft.personIds),
            ),
          )
          .orderBy(evaluationWorkItems.id)
          .for('update');
        await lockSourceGraph(
          tx,
          draft,
          before.mappings.map((row) => row.eventId),
        );
        await lockAuthority(tx, accountId, actorPersonId, draft);
        let lastWall = '';
        const native = createConfirmRecordDraftUsecase({
          businessNow: () => clock.businessNow(),
          wallNow: () => (lastWall = clock.wallNow()),
          newId: randomUUID,
          readState: async () => {
            const rows = await readRecordConfirmationState(tx, lock);
            // Replays reauthorize their retained source and actor snapshot;
            // later scoring mutations are not fresh-command eligibility.
            const replaying = rows.operations.some(
              (row) =>
                row.actorAccountId === accountId &&
                row.action === command.action &&
                row.operationId === command.input.operation_id,
            );
            if (replaying) return { ...rows, confirmations: [], reviews: [] };
            const scored = await scoringState(
              tx,
              rows.mappings.map((row) => row.eventId),
            );
            if (
              command.action === 'undo' &&
              scored.unknownHandledReviewEventIds.some((id) =>
                lock.retainedSave?.receipt.events.some(
                  (event) => event.eventId === id,
                ),
              )
            )
              throw new ConfirmationError(
                'conflict',
                'later_review_without_provenance',
              );
            const state: ConfirmationState = { ...rows, ...scored };
            return state;
          },
          loadAuthorization: async (_account, at) =>
            (
              await loadCurrent(
                tx,
                accountId,
                at,
                actorPersonId,
                lock.retainedSave,
              )
            ).context,
          readRules: (versions) => readFrozenRules(tx, versions),
          readSources: (_account, retainedDraft) =>
            readSources(tx, accountId, retainedDraft, clock, actorPersonId),
        });
        const outcome =
          command.action === 'save'
            ? await native.save(accountId, command.input)
            : await native.undo(accountId, command.input);
        if (outcome.status !== 'planned') {
          if (outcome.status === 'validation_error')
            throw new ConfirmationError('conflict', 'input_changed');
          throw new ConfirmationError(outcome.status, outcome.reason);
        }
        const plan = outcome.plan;
        if (plan.replayed) return plan;
        const fingerprint = confirmationFingerprint(command);
        if (plan.action === 'save') {
          const confirmationWork: RecordConfirmationWorkFact[] = [];
          for (const item of workItems) {
            // A confirmation assignment does not order other evaluators' scores.
            if (item.assignedEvaluatorId !== actorPersonId) continue;
            if (item.state === 'cancelled')
              throw new ConfirmationError(
                'conflict',
                'confirmation_task_cancelled',
              );
            if (item.state === 'completed') continue;
            const current = await loadCurrent(
              tx,
              accountId,
              clock.businessNow(),
              actorPersonId,
              lock.retainedSave,
            );
            if (!canWorkOnEvaluationItem(current.context, item))
              throw new ConfirmationError(
                'forbidden',
                'confirmation_task_reassigned',
              );
            const completed = await completeEvaluationWorkItem(
              tx,
              item.id,
              item.revision,
              async () =>
                (
                  await loadCurrent(
                    tx,
                    accountId,
                    clock.businessNow(),
                    actorPersonId,
                  )
                ).context,
            );
            confirmationWork.push({
              id: completed.id,
              assignedRelationId: completed.assignedRelationId,
              assignedEvaluatorId: completed.assignedEvaluatorId,
              completedRevision: completed.revision,
            });
          }
          await commitRecordSave(
            tx,
            lock,
            plan,
            actorPersonId,
            fingerprint,
            confirmationWork,
          );
          await writeRecordConfirmations(
            tx,
            plan,
            actorPersonId,
            before.batch.modelVersion,
          );
        } else {
          const workFacts = lock.retainedSave?.confirmationWork;
          if (!Array.isArray(workFacts))
            throw new ConfirmationError(
              'unavailable',
              'confirmation_task_snapshot_missing',
            );
          const current = await loadCurrent(
            tx,
            accountId,
            clock.businessNow(),
            actorPersonId,
            lock.retainedSave,
          );
          for (const fact of workFacts) {
            const item = workItems.find((row) => row.id === fact.id);
            if (
              !item ||
              item.state !== 'completed' ||
              item.revision !== fact.completedRevision ||
              item.assignedRelationId !== fact.assignedRelationId ||
              item.assignedEvaluatorId !== fact.assignedEvaluatorId ||
              item.assignedEvaluatorId !== actorPersonId
            )
              throw new ConfirmationError(
                'conflict',
                'confirmation_task_changed',
              );
            if (!assignedEvaluationRelationIsCurrent(current.context, item))
              throw new ConfirmationError(
                'forbidden',
                'confirmation_task_permission_changed',
              );
            await undoEvaluationWorkCompletion(
              tx,
              {
                id: item.id,
                expectedRevision: fact.completedRevision,
                assignedRelationId: fact.assignedRelationId,
                assignedEvaluatorId: fact.assignedEvaluatorId,
                nextState: plan.receipt.withdrawnEvents.some(
                  (event) => event.personId === item.personId,
                )
                  ? 'cancelled'
                  : 'pending',
              },
              async () =>
                (
                  await loadCurrent(
                    tx,
                    accountId,
                    clock.businessNow(),
                    actorPersonId,
                    lock.retainedSave,
                  )
                ).context,
            );
          }
          await withdrawRecordConfirmations(
            tx,
            plan.receipt,
            actorPersonId,
            lastWall,
          );
          await commitRecordUndo(
            tx,
            lock,
            plan,
            command.input as RecordUndoInput,
            actorPersonId,
            fingerprint,
            lastWall,
          );
        }
        await recordAudit(tx, {
          actorId: accountId,
          action: 'record.' + plan.action,
          resourceId: plan.receipt.saveId,
        });
        return plan;
      },
      { isolationLevel: 'read committed' },
    );
  } catch (error) {
    if (error instanceof EvaluationReassignmentError)
      throw new ConfirmationError(error.status, error.message);
    if (error instanceof RecordWriteError)
      throw new ConfirmationError(error.status, error.reason);
    if (error instanceof ForbiddenError)
      throw new ConfirmationError(
        'forbidden',
        'current_authorization_required',
      );
    const cause = error instanceof Error && error.cause ? error.cause : error;
    if (
      typeof cause === 'object' &&
      cause !== null &&
      'code' in cause &&
      (cause.code === '23505' || cause.code === '40P01')
    )
      throw new ConfirmationError('conflict', 'concurrent_record_changed');
    throw error;
  }
}

export async function saveRecordDraft(
  db: Database,
  accountId: string,
  input: RecordSaveInput,
  clock: RecordSaveClock,
) {
  const plan = await execute(db, accountId, { action: 'save', input }, clock);
  if (plan.action !== 'save') throw new Error('Unexpected record action');
  return {
    replayed: plan.replayed,
    result: recordSaveReceiptSchema.parse(plan.receipt),
  };
}
export async function undoRecordSave(
  db: Database,
  accountId: string,
  input: RecordUndoInput,
  clock: RecordSaveClock,
) {
  const plan = await execute(db, accountId, { action: 'undo', input }, clock);
  if (plan.action !== 'undo') throw new Error('Unexpected record action');
  const result = recordUndoReceiptSchema.parse(plan.receipt);
  // Contract validation trims input text; the retained original is evidence.
  result.originalInput = structuredClone(
    (plan.receipt as typeof result).originalInput,
  );
  return { replayed: plan.replayed, result };
}
