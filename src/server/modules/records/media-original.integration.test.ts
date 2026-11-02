import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { nativeDatabase } from '../../../../tests/fixtures/bow-845/native';
import {
  seedRecordCase,
  seedRecordRules,
  wallStart,
} from '../../../../tests/fixtures/bow-846/native';
import { recordInputSchema } from '../../../contracts/record';
import { recordDraftBatches, recordDrafts } from './save-state/schema';
import {
  storeTrustedRecordDraftBatch,
  lockRecordCommand,
  readRecordConfirmationState,
} from './write';
import type { MediaRecordOriginalInput } from './arrange/input-state/original-input';

let c: Awaited<ReturnType<typeof nativeDatabase>>;
beforeAll(async () => {
  c = await nativeDatabase();
  await seedRecordRules(c.db);
}, 30000);
afterAll(async () => {
  await c?.close();
});
async function fixture() {
  const f = await seedRecordCase(c.db);
  const batchId = randomUUID(),
    draftId = randomUUID();
  const originalInput: MediaRecordOriginalInput = {
    kind: 'media',
    operationId: randomUUID(),
    materialIds: [randomUUID()],
  };
  const draft = { ...f.draft, batchId, draftId };
  const value = {
    draftSet: {
      batchId,
      revision: 1,
      duplicateCandidates: [],
      drafts: [draft],
    },
    originalInput,
    occurredOn: '2026-09-01',
    modelVersion: 'synthetic-media-model',
    createdByAccountId: f.account.one,
    createdAt: new Date(wallStart),
  };
  return { f, value, batchId, draftId };
}
// This tests the trusted producer's persistence boundary, not permission to read
// media or a canonical-source producer. Those must be checked before calling it.
it('persists exact internal media identity and reads it without inventing public text', async () => {
  const h = await fixture();
  await c.db.transaction(async (tx) => {
    await storeTrustedRecordDraftBatch(tx, h.value);
    const lock = await lockRecordCommand(tx, h.f.account.one, {
      action: 'save',
      input: { ...h.f.input, draftId: h.draftId },
    });
    const state = await readRecordConfirmationState(tx, lock);
    expect(state.batch.originalInput).toEqual(h.value.originalInput);
    expect(state.draftSet.drafts[0].origin).toBe('ai_suggestion');
    expect(recordInputSchema.safeParse(state.batch.originalInput).success).toBe(
      false,
    );
    expect(state.batch.originalInput).not.toHaveProperty('text');
  });
  expect(
    (
      await c.db
        .select()
        .from(recordDraftBatches)
        .where(eq(recordDraftBatches.batchId, h.batchId))
    )[0].originalInput,
  ).toEqual(h.value.originalInput);
});
it('keeps the media batch and every draft inside the caller transaction', async () => {
  const h = await fixture(),
    failure = new Error('synthetic outer rollback');
  await expect(
    c.db.transaction(async (tx) => {
      await storeTrustedRecordDraftBatch(tx, h.value);
      expect(
        await tx
          .select()
          .from(recordDrafts)
          .where(eq(recordDrafts.batchId, h.batchId)),
      ).toHaveLength(1);
      expect(
        await c.db
          .select()
          .from(recordDraftBatches)
          .where(eq(recordDraftBatches.batchId, h.batchId)),
      ).toEqual([]);
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(
    await c.db
      .select()
      .from(recordDraftBatches)
      .where(eq(recordDraftBatches.batchId, h.batchId)),
  ).toEqual([]);
  expect(
    await c.db
      .select()
      .from(recordDrafts)
      .where(eq(recordDrafts.batchId, h.batchId)),
  ).toEqual([]);
});
it.each([
  'missing-material',
  'duplicate-material',
  'missing-operation',
] as const)('rejects %s before any batch or draft is stored', async (mode) => {
  const h = await fixture();
  const originalInput = {
    ...h.value.originalInput,
    materialIds:
      mode === 'missing-material'
        ? []
        : mode === 'duplicate-material'
          ? ['demo-id', 'demo-id']
          : ['demo-id'],
    operationId:
      mode === 'missing-operation' ? '' : h.value.originalInput.operationId,
  };
  await expect(
    c.db.transaction((tx) =>
      storeTrustedRecordDraftBatch(tx, { ...h.value, originalInput }),
    ),
  ).rejects.toThrow();
  expect(
    await c.db
      .select()
      .from(recordDraftBatches)
      .where(eq(recordDraftBatches.batchId, h.batchId)),
  ).toEqual([]);
  expect(
    await c.db
      .select()
      .from(recordDrafts)
      .where(eq(recordDrafts.batchId, h.batchId)),
  ).toEqual([]);
});
