import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { nativeDatabase } from '../../../tests/fixtures/bow-845/native';
import {
  seedRecordCase,
  seedRecordRules,
} from '../../../tests/fixtures/bow-846/native';
import {
  recordDrafts,
  recordDraftBatches,
  recordSaves,
  recordDraftEvents,
  events,
} from '../modules/records';
import { appendTrustedRecordDraftBatch } from '../modules/records/save-state/append-drafts';
import { saveRecordDraft } from './record-save';

let connection: Awaited<ReturnType<typeof nativeDatabase>>;
beforeAll(async () => {
  connection = await nativeDatabase();
  await seedRecordRules(connection.db);
}, 30000);
afterAll(async () => {
  await connection?.close();
});

// Exercises the native append/save ledger using authorized synthetic sources.
// It does not claim to test media scope capture or the attachment parser.
async function fixture() {
  const f = await seedRecordCase(connection.db);
  const batchId = randomUUID();
  const first = { ...structuredClone(f.draft), batchId, draftId: randomUUID() };
  const originalInput = {
    kind: 'media' as const,
    operationId: randomUUID(),
    materialIds: [randomUUID(), randomUUID()],
  };
  const facts = {
    originalInput,
    occurredOn: '2026-09-01',
    modelVersion: 'synthetic-model-846',
    createdByAccountId: f.account.one,
    createdAt: new Date('2026-11-01T12:00:00Z'),
  };
  await connection.db.transaction((tx) =>
    appendTrustedRecordDraftBatch(tx, {
      ...facts,
      draftSet: {
        batchId,
        revision: 2,
        drafts: [first],
        duplicateCandidates: [],
      },
    }),
  );
  return { f, batchId, first, facts };
}
it('appends a later file without changing real human-confirmed draft/event/save rows', async () => {
  const h = await fixture();
  const saved = await saveRecordDraft(
    connection.db,
    h.f.account.one,
    {
      ...h.f.input,
      operation_id: randomUUID(),
      draftId: h.first.draftId,
    },
    h.f.clock,
  );
  expect(saved.result.events).toHaveLength(1);
  const snapshot = async () => ({
    draft: await connection.db
      .select()
      .from(recordDrafts)
      .where(eq(recordDrafts.draftId, h.first.draftId)),
    save: await connection.db
      .select()
      .from(recordSaves)
      .where(eq(recordSaves.batchId, h.batchId)),
    mappings: await connection.db
      .select()
      .from(recordDraftEvents)
      .where(eq(recordDraftEvents.batchId, h.batchId)),
    event: await connection.db
      .select()
      .from(events)
      .where(eq(events.id, saved.result.events[0]!.eventId)),
  });
  const before = await snapshot();
  const [parent] = await connection.db
    .select()
    .from(recordDraftBatches)
    .where(eq(recordDraftBatches.batchId, h.batchId));
  const second = { ...structuredClone(h.first), draftId: randomUUID() };
  const appended = await connection.db.transaction((tx) =>
    appendTrustedRecordDraftBatch(tx, {
      ...h.facts,
      draftSet: {
        batchId: h.batchId,
        revision: 2,
        drafts: [second],
        duplicateCandidates: [],
      },
    }),
  );
  expect(appended.revision).toBe(parent!.revision + 1);
  expect(appended.drafts).toHaveLength(2);
  expect(await snapshot()).toEqual(before);
});
it('serializes two independently finished files without stale parent-generation failure', async () => {
  const h = await fixture();
  const additions = [randomUUID(), randomUUID()].map((draftId) => ({
    ...structuredClone(h.first),
    draftId,
  }));
  await Promise.all(
    additions.map((draft) =>
      connection.db.transaction((tx) =>
        appendTrustedRecordDraftBatch(tx, {
          ...h.facts,
          draftSet: {
            batchId: h.batchId,
            revision: 2,
            drafts: [draft],
            duplicateCandidates: [],
          },
        }),
      ),
    ),
  );
  const rows = await connection.db
    .select()
    .from(recordDrafts)
    .where(eq(recordDrafts.batchId, h.batchId));
  expect(rows.map((row) => row.draftId).sort()).toEqual(
    [h.first.draftId, ...additions.map((draft) => draft.draftId)].sort(),
  );
  const [batch] = await connection.db
    .select()
    .from(recordDraftBatches)
    .where(eq(recordDraftBatches.batchId, h.batchId));
  expect(batch!.revision).toBe(4);
});
it('rolls a duplicate append back without touching the previous ledger', async () => {
  const h = await fixture();
  await expect(
    connection.db.transaction((tx) =>
      appendTrustedRecordDraftBatch(tx, {
        ...h.facts,
        draftSet: {
          batchId: h.batchId,
          revision: 2,
          drafts: [h.first],
          duplicateCandidates: [],
        },
      }),
    ),
  ).rejects.toThrow('append_draft_identity_changed');
  const [batch] = await connection.db
    .select()
    .from(recordDraftBatches)
    .where(eq(recordDraftBatches.batchId, h.batchId));
  expect(batch!.revision).toBe(2);
});
