import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  nativeDatabase,
  businessAt,
} from '../../../tests/fixtures/bow-845/native';
import {
  materialReviewCommandSchema,
  materialReviewItemSchema,
  materialReviewResolutionReceiptSchema,
} from '../../contracts/material-review';
import { jobSnapshots } from '../jobs/schema';
import { advanceJob } from '../jobs/state';
import { arrangeOperationFingerprint } from '../modules/records/arrange/input-state/bind';
import { readMediaReviewStateInTransaction } from '../modules/records/material-review/read';
import {
  mediaMaterials,
  mediaReviewItems,
  mediaReviewOperations,
} from '../modules/records/material-review/schema';
import { undoAttachmentPersonReviewInTransaction } from './attachment-person-review-undo';
import { seedImageCase } from './material-images/native.fixture';
import { canWriteArrange, loadArrangeActor } from './record-arrange-context';
import { readIntakeTable } from './talent-source-projection';
import { newAttachmentArrangeJob } from './parsed-attachment-state';

let connection: Awaited<ReturnType<typeof nativeDatabase>>;
beforeAll(async () => {
  connection = await nativeDatabase();
}, 30000);
afterAll(async () => {
  await connection?.close();
});

// Existing native fixture supplies synthetic captured-scope SQL facts. This is
// a mutation-adapter test, not approval or implementation of a scope-capture API.
async function fixture(bind = false) {
  const f = await seedImageCase(connection.db);
  const question = materialReviewItemSchema.parse({
    itemId: f.question.itemId,
    materialId: f.row.id,
    batchId: f.row.inputId,
    evaluationNodeId: f.node,
    originalVersionId: f.row.originalVersionId,
    revision: 1,
    state: 'pending',
    source: null,
    kind: 'unknown_person',
    observedName: null,
    candidates: [],
  });
  const resolution = bind
    ? { action: 'bind_people' as const, personIds: [f.target] }
    : { action: 'keep_original_only' as const };
  const command = materialReviewCommandSchema.parse({
    operationId: f.op.operationId,
    batchId: f.row.inputId,
    itemId: question.itemId,
    expectedRevision: 1,
    kind: 'unknown_person',
    resolution,
  });
  const receipt = materialReviewResolutionReceiptSchema.parse({
    batchId: f.row.inputId,
    materialId: f.row.id,
    itemId: question.itemId,
    revision: 2,
    kind: 'unknown_person',
    resolution,
    remainingReviewItemIds: [],
    blockingReviewItemIds: [],
    invalidatedDraftIds: [],
    resume: null,
  });
  await connection.db
    .update(mediaReviewItems)
    .set({ kind: 'unknown_person', question })
    .where(eq(mediaReviewItems.id, question.itemId));
  await connection.db
    .update(mediaReviewOperations)
    .set({
      command,
      receipt,
      fingerprint: arrangeOperationFingerprint(command),
    })
    .where(eq(mediaReviewOperations.id, f.op.id));
  const undo = {
    operationId: randomUUID(),
    batchId: f.row.inputId,
    itemId: question.itemId,
    expectedRevision: 2,
    kind: 'unknown_person' as const,
    action: 'undo' as const,
  };
  const run = (raw: unknown = undo) =>
    connection.db.transaction(async (tx) => {
      await readIntakeTable(tx, 'locked-for-write');
      const state = await readMediaReviewStateInTransaction(tx, f.row.id);
      if (!state) throw new Error('Expected persisted synthetic material');
      const actor = await loadArrangeActor(tx, f.account, businessAt);
      if (!canWriteArrange(actor, [f.target], null, f.node))
        throw new Error('Synthetic actor lacks actual node authority');
      return undoAttachmentPersonReviewInTransaction(
        tx,
        state,
        { accountId: f.account, personId: f.evaluator },
        raw,
        new Date('2026-11-03T00:00:00Z'),
      );
    });
  return { f, undo, run };
}
it('undoes original-only to pending while retaining initial scope and original operation', async () => {
  const h = await fixture();
  const [before] = await connection.db
    .select()
    .from(mediaMaterials)
    .where(eq(mediaMaterials.id, h.f.row.id));
  const result = await h.run();
  expect(result).toMatchObject({
    replayed: false,
    receipt: {
      previousRevision: 2,
      invalidatedDraftIds: [],
      resume: null,
      item: { state: 'pending', revision: 3 },
    },
  });
  const [after] = await connection.db
    .select()
    .from(mediaMaterials)
    .where(eq(mediaMaterials.id, h.f.row.id));
  expect(after).toEqual(before);
  const operations = await connection.db
    .select()
    .from(mediaReviewOperations)
    .where(eq(mediaReviewOperations.materialId, h.f.row.id));
  expect(operations).toHaveLength(2);
  expect(operations.find((op) => op.id === h.f.op.id)?.action).toBe('resolve');
  expect(operations.find((op) => op.action === 'undo')?.sourceOperationId).toBe(
    h.f.op.id,
  );
});
it('replays the same accepted undo and conflicts on key/payload or stale revision', async () => {
  const h = await fixture();
  const first = await h.run();
  expect(await h.run()).toEqual({ ...first, replayed: true });
  await expect(h.run({ ...h.undo, expectedRevision: 3 })).rejects.toThrow(
    'review_operation_changed',
  );
  await expect(h.run({ ...h.undo, operationId: randomUUID() })).rejects.toThrow(
    'review_revision_changed',
  );
  expect(
    await connection.db
      .select()
      .from(mediaReviewOperations)
      .where(eq(mediaReviewOperations.materialId, h.f.row.id)),
  ).toHaveLength(2);
});
it('cancels just the withdrawn binding generation without deleting its metadata', async () => {
  const h = await fixture(true);
  const state = await connection.db.transaction((tx) =>
    readMediaReviewStateInTransaction(tx, h.f.row.id),
  );
  if (!state) throw new Error('Expected native state');
  let job = newAttachmentArrangeJob(
    {
      parentInputId: state.input.id,
      parentInputVersion: state.input.inputVersion,
      batchId: state.input.batchId!,
      materialId: state.material.id,
      originalVersionId: state.material.originalVersionId,
      parseVersionId: 'demo-parse-' + randomUUID(),
      captureAuditId: state.material.scopeAuditId!,
      materialRevision: state.material.revision,
      reviewItemId: h.f.question.itemId,
      reviewOperationId: h.f.op.id,
      itemRevision: 2,
      accountId: h.f.account,
    },
    h.f.evaluator,
    '2026-11-02T00:00:00Z',
  );
  job = advanceJob(
    job,
    { attempt: 1, expectedRevision: job.revision, status: 'running' },
    '2026-11-02T00:00:01Z',
  );
  await connection.db.insert(jobSnapshots).values(job);
  await h.run();
  const [cancelled] = await connection.db
    .select()
    .from(jobSnapshots)
    .where(eq(jobSnapshots.jobId, job.jobId));
  expect(cancelled!.status).toBe('cancelled');
  expect(cancelled!.result).toEqual(job.result);
});
