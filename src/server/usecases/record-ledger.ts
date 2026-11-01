import { createHash } from 'node:crypto';
import { inArray, sql } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import {
  recordBatchDraftSchema,
  recordSaveReceiptSchema,
} from '../../contracts/record';
import {
  recordDraftBatches,
  recordDrafts,
  recordDraftEvents,
  recordSaves,
  recordOperations,
  events,
  eventParticipants,
  eventSources,
  statements,
  originals,
  originalVersions,
  fragments,
  historicalEvaluations,
  historicalParticipants,
  readEvidenceForTalent,
} from '../modules/records';
import { confirmations, scoreReviews } from '../modules/talent';
import { lockConfirmationIntakes } from './record-confirmation-sources';
import { talentSources, sourceKey } from './talent-source-projection';
import { loadEvaluationContext } from './evaluation-context';

const unavailable = <R extends string>(reason: R) =>
  ({ availability: 'unavailable', reason }) as const;
const available = <T>(fact: T) =>
  ({ availability: 'available', fact }) as const;

/** Stable fact digest, not an authorization token or a count-based readiness flag. */
function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}

/** Internal, transaction-bound native facts. Never return this object as a DTO.
 *
 * Call FIRST in a short READ COMMITTED command transaction, before event/review
 * row locks. Existing 846 writers acquire intake SHARE then batch FOR UPDATE;
 * batch EXCLUSIVE therefore waits for them and fences new saves/undos/revisions,
 * including previously absent events. Normal SELECTs remain permitted. The
 * subsequent SHARE fences also cover standalone review DML and source phantoms.
 * All fences survive until the CALLER commits/rolls back. This deliberately
 * serializes ledger consumers; do not hold it across model/network calls.
 *
 * This is not permission or all-judges readiness. Consumers must lock/recheck
 * their current actor/target/full-source authority in this same transaction,
 * after these waits, and use their trusted current clock. No client snapshot or
 * aggregate task/active count can replace that check. Re-read after any writes
 * made by the consuming transaction itself. No repeatable-read stale snapshot.
 */
export async function readLockedRecordLedger(
  tx: Transaction,
  target: { evaluationNodeId: string; personId: string },
  actor: { accountId: string; now: () => string },
) {
  const isolation = await tx.execute<{ transaction_isolation: string }>(
    sql`show transaction_isolation`,
  );
  if (isolation.rows[0]?.transaction_isolation !== 'read committed')
    throw new Error('Native record ledger requires READ COMMITTED');
  const intakeInputs = await lockConfirmationIntakes(tx);
  await tx.execute(sql`lock table ${recordDraftBatches} in exclusive mode`);
  await tx.execute(sql`lock table
    ${recordDrafts}, ${recordDraftEvents}, ${recordSaves}, ${recordOperations},
    ${events}, ${eventParticipants}, ${eventSources}, ${statements},
    ${originals}, ${originalVersions}, ${fragments},
    ${historicalEvaluations}, ${historicalParticipants},
    ${confirmations}, ${scoreReviews} in share mode`);

  // Intake rows are fixed by the first table fence. All other facts are read
  // after the final wait. Sources are never narrowed by target, active status,
  // creator, or the AI attribution list.
  const evidence = await readEvidenceForTalent(tx);
  const current = await loadEvaluationContext(tx, actor.accountId, actor.now());
  const sourceFacts = talentSources({
    ...evidence,
    intakeInputs,
    context: current.context,
    staffing: current.staffing,
  });
  const targetEvents = evidence.events
    .filter(
      (event) =>
        event.evaluationNodeId === target.evaluationNodeId &&
        event.personId === target.personId,
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const ids = targetEvents.map((event) => event.id);
  const mappings = ids.length
    ? await tx
        .select()
        .from(recordDraftEvents)
        .where(inArray(recordDraftEvents.eventId, ids))
    : [];
  // Saves/operations include withdrawn history. Their immutable receipts, not
  // the current mapping alone, identify earlier generations of an event.
  const saves = await tx.select().from(recordSaves).orderBy(recordSaves.saveId);
  const operations = await tx
    .select()
    .from(recordOperations)
    .orderBy(
      recordOperations.actorAccountId,
      recordOperations.action,
      recordOperations.operationId,
    );
  const human = ids.length
    ? await tx
        .select()
        .from(confirmations)
        .where(inArray(confirmations.eventId, ids))
        .orderBy(confirmations.id)
    : [];
  const reviews = ids.length
    ? await tx
        .select()
        .from(scoreReviews)
        .where(inArray(scoreReviews.eventId, ids))
        .orderBy(scoreReviews.id)
    : [];
  const ledgerEvents = targetEvents.map((event) => {
    const mapped = mappings.find((mapping) => mapping.eventId === event.id);
    const history = saves.filter((save) => {
      const receipt = recordSaveReceiptSchema.safeParse(save.receipt);
      return (
        (receipt.success &&
          receipt.data.events.some((item) => item.eventId === event.id)) ||
        save.createdEventIds.includes(event.id) ||
        (mapped?.batchId === save.batchId && mapped.draftId === save.draftId)
      );
    });
    const saveFacts = history.map((save) => {
      const receipt = recordSaveReceiptSchema.safeParse(save.receipt);
      const draft = recordBatchDraftSchema.safeParse(save.draftSnapshot);
      const accepted = operations.filter(
        (op) => op.saveId === save.saveId && op.action === 'save',
      );
      const undone = operations.filter(
        (op) => op.saveId === save.saveId && op.action === 'undo',
      );
      const op = accepted[0];
      const proof =
        receipt.success &&
        draft.success &&
        accepted.length === 1 &&
        !!op &&
        receipt.data.saveId === save.saveId &&
        receipt.data.savedBy === save.actorAccountId &&
        receipt.data.savedAt === save.savedAt.toISOString() &&
        receipt.data.events.some(
          (item) =>
            item.eventId === event.id && item.personId === event.personId,
        ) &&
        draft.data.batchId === save.batchId &&
        draft.data.draftId === save.draftId &&
        draft.data.evaluationNodeId === event.evaluationNodeId &&
        draft.data.personIds.includes(event.personId) &&
        op.actorAccountId === save.actorAccountId &&
        op.operationId === save.input.operation_id &&
        canonical(op.receipt) === canonical(save.receipt) &&
        canonical(op.draftSnapshot) === canonical(save.draftSnapshot) &&
        op.createdAt.getTime() === save.savedAt.getTime() &&
        (save.withdrawnAt === null
          ? undone.length === 0
          : undone.length === 1 &&
            undone[0]!.actorAccountId === save.actorAccountId &&
            undone[0]!.createdAt.getTime() === save.withdrawnAt.getTime());
      return {
        saveId: save.saveId,
        proof: proof
          ? available({
              batchId: save.batchId,
              draftId: save.draftId,
              acceptedRevision: save.draftSnapshot.revision,
              actorAccountId: save.actorAccountId,
              actorPersonId: save.actorPersonId,
              operationId: op.operationId,
              savedAt: save.savedAt,
              withdrawnAt: save.withdrawnAt,
              undoOperationId: undone[0]?.operationId ?? null,
              confirmationIds: save.receipt.confirmationIds,
              reviewItemIds: save.receipt.reviewItemIds,
            })
          : unavailable('save_operation_mismatch'),
      };
    });
    const links = evidence.eventSources.filter(
      (link) => link.eventId === event.id,
    );
    const linked = links.map((link) =>
      sourceFacts.find((source) => sourceKey(source) === sourceKey(link)),
    );
    const sourceAvailability =
      links.length > 0 &&
      linked.every((source) => source && source.subjects.length > 0)
        ? available(linked.filter((source) => source !== undefined))
        : unavailable('incomplete_source_provenance');
    const natureRows = evidence.statements
      .filter((row) => row.eventId === event.id)
      .sort((a, b) => a.id.localeCompare(b.id));
    return {
      event,
      mapping: mapped ?? null,
      saves: saveFacts,
      provenance:
        saveFacts.length > 0 &&
        saveFacts.every((save) => save.proof.availability === 'available') &&
        (event.withdrawnAt !== null || !!mapped) &&
        (!mapped ||
          (mapped.personId === event.personId &&
            saveFacts.some(
              (save) =>
                save.proof.availability === 'available' &&
                save.proof.fact.batchId === mapped.batchId &&
                save.proof.fact.draftId === mapped.draftId,
            )))
          ? available('native_save_ledger' as const)
          : unavailable('missing_or_inconsistent_native_ledger'),
      sources: sourceAvailability,
      // Original source category and a saved score do not prove event nature.
      nature: natureRows.length
        ? available(natureRows)
        : unavailable('nature_not_recorded'),
      confirmations: human
        .filter((row) => row.eventId === event.id)
        .map((row) => {
          const owners = saveFacts.filter(
            (save) =>
              save.proof.availability === 'available' &&
              save.proof.fact.confirmationIds.includes(row.id),
          );
          const owner = owners[0]?.proof;
          const owned =
            owners.length === 1 &&
            owner?.availability === 'available' &&
            row.sourceCategory === 'original' &&
            row.evaluatorId === owner.fact.actorPersonId &&
            row.modifiedBy === owner.fact.actorPersonId &&
            row.confirmedAt?.getTime() === owner.fact.savedAt.getTime() &&
            !(row.active && (owner.fact.withdrawnAt || event.withdrawnAt)) &&
            links.some((link) => sourceKey(link) === sourceKey(row));
          return {
            row,
            ownership: owned
              ? available(owners[0]!.saveId)
              : unavailable('confirmation_ownership_unverified'),
          };
        }),
      reviews: reviews
        .filter((row) => row.eventId === event.id)
        .map((row) => {
          const owner = saveFacts.find(
            (save) => save.saveId === row.saveId,
          )?.proof;
          const owned =
            owner?.availability === 'available' &&
            owner.fact.reviewItemIds.includes(row.id) &&
            !!row.confirmationId &&
            owner.fact.confirmationIds.includes(row.confirmationId) &&
            human.some(
              (item) =>
                item.id === row.confirmationId && item.eventId === event.id,
            );
          return {
            row,
            ownership: owned
              ? available(row.saveId!)
              : unavailable('review_ownership_unverified'),
          };
        }),
    };
  });
  return {
    target,
    revision: createHash('sha256')
      .update(canonical({ target, events: ledgerEvents }))
      .digest('hex'),
    events: ledgerEvents,
    // Consumers reuse the very same complete source projection, then apply
    // current authority. This internal context is not a persisted capability.
    context: current.context,
  };
}
export type NativeRecordLedger = Awaited<
  ReturnType<typeof readLockedRecordLedger>
>;
