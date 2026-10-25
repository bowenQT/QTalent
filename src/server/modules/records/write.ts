import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { DbExecutor, Transaction } from '../../db/client';
import type { RecordSaveInput } from '../../../contracts/record';
import { events, eventParticipants, eventSources, statements } from './schema';
import {
  recordDrafts, recordSaves, recordDraftEvents, recordOperations,
} from './save-state/schema';

export async function lockRecordDraft(tx: Transaction, draftId: string) {
  const [row] = await tx.select().from(recordDrafts)
    .where(eq(recordDrafts.id, draftId)).for('update');
  return row ?? null;
}
export async function readRecordOperation(
  db: DbExecutor, actorAccountId: string, action: 'save' | 'undo', operationId: string,
) {
  const [row] = await db.select().from(recordOperations).where(and(
    eq(recordOperations.actorAccountId, actorAccountId),
    eq(recordOperations.action, action),
    eq(recordOperations.operationId, operationId),
  ));
  return row ?? null;
}
export async function readRecordSave(db: DbExecutor, saveId: string) {
  const [row] = await db.select().from(recordSaves).where(eq(recordSaves.id, saveId));
  return row ?? null;
}
export async function readDraftEvents(db: DbExecutor, draftId: string) {
  return db.select().from(recordDraftEvents)
    .where(eq(recordDraftEvents.draftId, draftId));
}
export async function readWithdrawnRecordEventIds(db: DbExecutor): Promise<string[]> {
  const rows = await db.select({ id: recordDraftEvents.eventId })
    .from(recordDraftEvents).where(isNotNull(recordDraftEvents.withdrawnAt));
  return rows.map((row) => row.id);
}
export async function beginRecordSave(
  tx: Transaction,
  input: { draftId: string; accountId: string; personId: string; savedAt: Date; personIds: string[]; projectId: string | null },
) {
  const id = randomUUID();
  await tx.insert(recordSaves).values({
    id, draftId: input.draftId, actorAccountId: input.accountId,
    actorPersonId: input.personId, savedAt: input.savedAt,
    personIds: input.personIds, projectId: input.projectId,
    confirmationIds: [], reviewIds: [],
  });
  return id;
}
export async function appendRecordEvent(
  tx: Transaction,
  input: RecordSaveInput,
  details: {
    personId: string; recorderId: string; saveId: string; ruleVersionId: string;
    occurredOn: string; sources: { fragmentId: string; originalVersionId: string }[];
  },
) {
  const eventId = randomUUID();
  await tx.insert(events).values({
    id: eventId, personId: details.personId, recorderId: details.recorderId,
    projectId: input.projectId, occurredOn: details.occurredOn,
    ...input.sbi, ruleVersionId: details.ruleVersionId, demo: false,
  });
  await tx.insert(eventParticipants).values(
    input.personIds.map((personId) => ({ eventId, personId })),
  );
  if (details.sources.length) await tx.insert(eventSources).values(
    details.sources.map((source) => ({ eventId, fragmentId: source.fragmentId, originalVersionId: source.originalVersionId })),
  ).onConflictDoNothing();
  const source = details.sources[0];
  if (!source) throw new Error('A saved event must retain original evidence');
  await tx.insert(statements).values({
    id: randomUUID(), eventId, kind: 'human_conclusion',
    text: input.sbi.behavior, authorId: details.recorderId,
    fragmentId: source.fragmentId, originalVersionId: source.originalVersionId,
  });
  await tx.insert(recordDraftEvents).values({
    eventId, draftId: input.draftId, personId: details.personId,
    createdSaveId: details.saveId,
  });
  return eventId;
}
export async function finishRecordSave(
  tx: Transaction, saveId: string, draftId: string, revision: number,
  confirmationIds: string[], reviewIds: string[],
) {
  await tx.update(recordSaves).set({ confirmationIds, reviewIds })
    .where(eq(recordSaves.id, saveId));
  await tx.update(recordDrafts).set({ revision })
    .where(eq(recordDrafts.id, draftId));
}
export async function withdrawRecordSave(
  tx: Transaction, saveId: string, eventIds: string[], withdrawnAt: Date,
) {
  if (eventIds.length) await tx.update(recordDraftEvents).set({ withdrawnAt })
    .where(and(
      eq(recordDraftEvents.createdSaveId, saveId),
      inArray(recordDraftEvents.eventId, eventIds),
    ));
  await tx.update(recordSaves).set({ withdrawnAt })
    .where(eq(recordSaves.id, saveId));
}
export async function appendRecordOperation(
  tx: Transaction, row: Omit<typeof recordOperations.$inferInsert, 'id'>,
) {
  await tx.insert(recordOperations).values({ id: randomUUID(), ...row });
}
