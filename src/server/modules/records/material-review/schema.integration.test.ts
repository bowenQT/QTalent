import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../../../db/client';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  nativeDatabase,
  seedNativeCase,
} from '../../../../../tests/fixtures/bow-845/native';
import {
  seedRecordRules,
  seedRecordCase,
} from '../../../../../tests/fixtures/bow-846/native';
import { fixture } from '../../../../../tests/fixtures/upload-fake';
import {
  materialReviewItemSchema,
  materialReviewCommandSchema,
  materialReviewResolutionReceiptSchema,
} from '../../../../contracts/material-review';
import { recordAudit } from '../../../platform/audit';
import { auditEvents } from '../../../platform/audit/schema';
import { jobSnapshots } from '../../../jobs/schema';
import { originals, originalVersions } from '../schema';
import { arrangeInputs } from '../arrange/input-state/schema';
import {
  uploadCollections,
  uploadIntents,
  uploadObjects,
} from '../uploads/schema';
import { recordDrafts } from '../save-state/schema';
import {
  mediaMaterials,
  mediaReviewItems,
  mediaReviewOperations,
  mediaReviewDraftDependencies,
} from './schema';

let c: Awaited<ReturnType<typeof nativeDatabase>>;
beforeAll(async () => {
  c = await nativeDatabase();
  if (process.env.QTALENT_MEDIA_TEST_MIGRATIONS)
    await migrate(c.db, {
      migrationsFolder: process.env.QTALENT_MEDIA_TEST_MIGRATIONS,
    });
  await seedRecordRules(c.db);
}, 30000);
afterAll(async () => {
  await c?.close();
});

// Synthetic storage facts only. No model call or authorization is mocked as ready.
async function material() {
  const f = await seedNativeCase(c.db);
  const id = randomUUID(),
    inputId = randomUUID(),
    version = randomUUID(),
    collectionId = randomUUID(),
    uploadId = randomUUID();
  const at = new Date('2026-11-01T12:00:00Z');
  const request = fixture(collectionId).request;
  await c.db
    .insert(originals)
    .values({ id, title: '演示原件', kind: 'original' });
  await c.db.insert(originalVersions).values({
    id: version,
    originalId: id,
    version: 1,
    contentDigest: 'a'.repeat(64),
  });
  await c.db.insert(uploadCollections).values({
    id: collectionId,
    creatorAccountId: f.account,
    operationId: randomUUID(),
    target: { kind: 'people', personIds: [f.target] },
    targetFingerprint: 'b'.repeat(64),
    createdAt: 100,
    expiresAt: 200,
    revision: 1,
  });
  await c.db.insert(uploadIntents).values({
    id: uploadId,
    accountId: f.account,
    operationId: request.operationId,
    fingerprint: 'c'.repeat(64),
    quotaScope: collectionId,
    recordCollectionId: collectionId,
    request,
    declaredBytes: request.declaredBytes,
    objectKey: id,
    expiresAt: 200,
    revision: 1,
  });
  await c.db.insert(uploadObjects).values({
    originalVersionId: version,
    uploadId,
    objectKey: id,
    byteLength: request.declaredBytes,
    mediaType: 'image/png',
    sha256: 'a'.repeat(64),
    etag: 'synthetic',
  });
  await c.db.insert(jobSnapshots).values({
    jobId: inputId,
    kind: 'record_organize',
    resourceId: inputId,
    inputVersion: version,
    status: 'awaiting_manual',
    attempt: 1,
    revision: 1,
    updatedAt: at.toISOString(),
  });
  await c.db.insert(arrangeInputs).values({
    id: inputId,
    creatorAccountId: f.account,
    jobId: inputId,
    inputVersion: version,
    batchId: inputId,
    evaluationNodeId: f.node,
    boundAt: at,
    occurredOn: '2026-11-01',
    origin: 'text',
    originalInput: {
      operation_id: inputId,
      text: '演示：带附件的真实合成文本',
      attachmentIds: [uploadId],
      personId: f.target,
      projectId: null,
    },
    sourceContexts: [],
    inputSource: null,
    personIds: [f.target],
    projectMode: 'none',
    projectId: null,
    projectCandidateIds: [],
    supersededByInputId: null,
    createdAt: at,
  });
  const row = {
    id,
    inputId,
    inputVersion: version,
    clientFileId: randomUUID(),
    uploadId,
    recordCollectionId: collectionId,
    originalVersionId: version,
    revision: 1,
    intakeScope: null,
    scopeAuditId: null,
    createdAt: at,
  };
  await c.db.insert(mediaMaterials).values(row);
  const question = materialReviewItemSchema.parse({
    itemId: randomUUID(),
    materialId: id,
    batchId: inputId,
    evaluationNodeId: f.node,
    originalVersionId: version,
    revision: 1,
    state: 'pending',
    source: null,
    kind: 'image_scope',
    proposedRegion: null,
  });
  await c.db.insert(mediaReviewItems).values({
    id: question.itemId,
    materialId: id,
    kind: question.kind,
    revision: 1,
    state: 'pending',
    question,
    currentOperationId: null,
  });
  return { ...f, row, question };
}

async function operation(
  f: Awaited<ReturnType<typeof material>>,
  tx: DbExecutor = c.db,
) {
  const auditId = await recordAudit(tx, {
    actorId: f.account,
    action: 'material.review',
    resourceId: f.row.id,
  });
  const operationId = randomUUID();
  return {
    id: randomUUID(),
    actorAccountId: f.account,
    actorPersonId: f.evaluator,
    operationId,
    fingerprint: 'd'.repeat(64),
    itemId: f.question.itemId,
    materialId: f.row.id,
    action: 'resolve' as const,
    sourceOperationId: null,
    command: materialReviewCommandSchema.parse({
      operationId,
      batchId: f.row.inputId,
      itemId: f.question.itemId,
      expectedRevision: 1,
      kind: 'image_scope',
      resolution: { action: 'keep_attachment_only' },
    }),
    receipt: materialReviewResolutionReceiptSchema.parse({
      batchId: f.row.inputId,
      materialId: f.row.id,
      itemId: f.question.itemId,
      revision: 2,
      kind: 'image_scope',
      resolution: { action: 'keep_attachment_only' },
      remainingReviewItemIds: [],
      blockingReviewItemIds: [],
      invalidatedDraftIds: [],
      resume: null,
    }),
    changes: [{ itemId: f.question.itemId, previousRevision: 1, revision: 2 }],
    auditId,
    createdAt: new Date('2026-11-01T12:00:00Z'),
  };
}

it('retains an unknown complete scope and a null initial source without inventing authorization', async () => {
  const f = await material();
  expect(
    await c.db
      .select()
      .from(mediaMaterials)
      .where(eq(mediaMaterials.id, f.row.id)),
  ).toEqual([f.row]);
  expect(
    (
      await c.db
        .select()
        .from(mediaReviewItems)
        .where(eq(mediaReviewItems.id, f.question.itemId))
    )[0],
  ).toMatchObject({
    state: 'pending',
    currentOperationId: null,
    question: { source: null },
  });
});

it('inserts the immutable operation then current pointer without an FK cycle, and rolls back both with the real audit', async () => {
  const f = await material();
  let opId = '',
    auditId = '';
  const failure = new Error('synthetic outer rollback');
  await expect(
    c.db.transaction(async (tx) => {
      const op = await operation(f, tx);
      opId = op.id;
      auditId = op.auditId;
      await tx.insert(mediaReviewOperations).values(op);
      await tx
        .update(mediaReviewItems)
        .set({ currentOperationId: op.id, revision: 2, state: 'resolved' })
        .where(eq(mediaReviewItems.id, f.question.itemId));
      expect(
        await c.db
          .select()
          .from(mediaReviewOperations)
          .where(eq(mediaReviewOperations.id, op.id)),
      ).toEqual([]);
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(
    await c.db
      .select()
      .from(mediaReviewOperations)
      .where(eq(mediaReviewOperations.id, opId)),
  ).toEqual([]);
  expect(
    await c.db.select().from(auditEvents).where(eq(auditEvents.id, auditId)),
  ).toEqual([]);
  expect(
    (
      await c.db
        .select()
        .from(mediaReviewItems)
        .where(eq(mediaReviewItems.id, f.question.itemId))
    )[0],
  ).toMatchObject({ revision: 1, state: 'pending', currentOperationId: null });
});

it('rejects a current pointer to an operation belonging to another material/item', async () => {
  const f = await material(),
    other = await material();
  const op = await operation(f);
  await c.db.insert(mediaReviewOperations).values(op);
  await expect(
    c.db
      .update(mediaReviewItems)
      .set({ currentOperationId: op.id, state: 'resolved' })
      .where(eq(mediaReviewItems.id, other.question.itemId)),
  ).rejects.toThrow();
});

it('rejects a stale input version and missing audit references instead of defaulting them', async () => {
  const f = await material();
  await expect(
    c.db.insert(mediaMaterials).values({
      ...f.row,
      id: randomUUID(),
      clientFileId: randomUUID(),
      inputVersion: 'missing-version',
    }),
  ).rejects.toThrow();
  const op = await operation(f);
  await expect(
    c.db.insert(mediaReviewOperations).values({ ...op, auditId: randomUUID() }),
  ).rejects.toThrow();
});

it('requires a real audit and a complete scope shape for captured facts while allowing unknown null facts', async () => {
  const f = await material();
  const scope = {
    subjects: [
      { personId: f.target, evaluationNodeId: f.node, cohortId: f.cohort },
    ],
    kind: 'evaluation' as const,
    requiredKinds: [],
    occurredOn: '2026-11-01',
  };
  await expect(
    c.db
      .update(mediaMaterials)
      .set({ intakeScope: scope })
      .where(eq(mediaMaterials.id, f.row.id)),
  ).rejects.toThrow();
  const auditId = await recordAudit(c.db, {
    actorId: f.account,
    action: 'synthetic.trusted.capture',
    resourceId: f.row.id,
  });
  await c.db
    .update(mediaMaterials)
    .set({ intakeScope: scope, scopeAuditId: auditId })
    .where(eq(mediaMaterials.id, f.row.id));
  await expect(
    c.db
      .update(mediaMaterials)
      .set({ intakeScope: { ...scope, subjects: [] } })
      .where(eq(mediaMaterials.id, f.row.id)),
  ).rejects.toThrow();
});

it('enforces one actor operation receipt and does not overwrite the original receipt', async () => {
  const f = await material(),
    op = await operation(f);
  await c.db.insert(mediaReviewOperations).values(op);
  await expect(
    c.db
      .insert(mediaReviewOperations)
      .values({ ...op, id: randomUUID(), fingerprint: 'e'.repeat(64) }),
  ).rejects.toThrow();
  expect(
    (
      await c.db
        .select()
        .from(mediaReviewOperations)
        .where(eq(mediaReviewOperations.id, op.id))
    )[0].receipt,
  ).toEqual(op.receipt);
});

it('retains the exact historical draft dependency when the current draft revision advances', async () => {
  const f = await material(),
    op = await operation(f);
  await c.db.insert(mediaReviewOperations).values(op);
  const saved = await seedRecordCase(c.db);
  const dependency = {
    operationId: op.id,
    itemId: f.question.itemId,
    draftId: saved.draft.draftId,
    draftRevision: saved.draft.revision,
  };
  await c.db.insert(mediaReviewDraftDependencies).values(dependency);
  await c.db
    .update(recordDrafts)
    .set({
      revision: saved.draft.revision + 1,
      draft: { ...saved.draft, revision: saved.draft.revision + 1 },
    })
    .where(eq(recordDrafts.draftId, saved.draft.draftId));
  expect(
    await c.db
      .select()
      .from(mediaReviewDraftDependencies)
      .where(eq(mediaReviewDraftDependencies.operationId, op.id)),
  ).toEqual([dependency]);
});
