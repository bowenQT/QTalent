// Synthetic persisted input, not a capture/review writer or production seed.
// Based on the X1 d44c88ad schema fixture; facts remain actual SQL rows.
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import type { Database, DbExecutor } from '../../db/client';
import { initialBatchMetadata } from '../record-batch-arrange-state';
import { seedNativeCase } from '../../../../tests/fixtures/bow-845/native';
import { fixture } from '../../../../tests/fixtures/upload-fake';
import {
  materialReviewItemSchema,
  materialReviewCommandSchema,
  materialReviewResolutionReceiptSchema,
} from '../../../contracts/material-review';
import { recordAudit } from '../../platform/audit';
import { jobSnapshots } from '../../jobs/schema';
import { originals, originalVersions } from '../../modules/records/schema';
import { arrangeInputs } from '../../modules/records/arrange/input-state/schema';
import {
  uploadCollections,
  uploadIntents,
  uploadObjects,
} from '../../modules/records/uploads/schema';
import {
  mediaMaterials,
  mediaReviewItems,
  mediaReviewOperations,
} from '../../modules/records/material-review/schema';

export async function seedImageCase(db: Database) {
  // Left half red, right half blue: allowed crop must contain only red pixels.
  const pixels = Buffer.from(
    Array.from({ length: 4 * 2 }, (_, i) =>
      i % 4 < 2 ? [255, 0, 0] : [0, 0, 255],
    ).flat(),
  );
  const bytes = await sharp(pixels, {
    raw: { width: 4, height: 2, channels: 3 },
  })
    .png()
    .toBuffer();
  const digest = createHash('sha256').update(bytes).digest('hex');
  async function material() {
    const f = await seedNativeCase(db);
    const id = randomUUID(),
      inputId = randomUUID(),
      version = randomUUID(),
      collectionId = randomUUID(),
      uploadId = randomUUID();
    const at = new Date('2026-11-01T12:00:00Z');
    const request = {
      ...fixture(collectionId).request,
      filename: 'demo.png',
      declaredBytes: bytes.length,
      mediaType: 'image/png',
      target: { kind: 'people' as const, personIds: [f.target] },
    };
    await db
      .insert(originals)
      .values({ id, title: '演示原件', kind: 'original' });
    await db.insert(originalVersions).values({
      id: version,
      originalId: id,
      version: 1,
      contentDigest: digest,
    });
    await db.insert(uploadCollections).values({
      id: collectionId,
      creatorAccountId: f.account,
      operationId: randomUUID(),
      target: { kind: 'people', personIds: [f.target] },
      targetFingerprint: 'b'.repeat(64),
      createdAt: 100,
      expiresAt: 200,
      revision: 1,
    });
    await db.insert(uploadIntents).values({
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
      completionOperationId: randomUUID(),
      completionFingerprint: 'f'.repeat(64),
      completed: {
        uploadId,
        recordCollectionId: collectionId,
        originalId: id,
        originalVersionId: version,
        jobId: inputId,
        revision: 1,
        source: null,
      },
    });
    await db.insert(uploadObjects).values({
      originalVersionId: version,
      uploadId,
      objectKey: id,
      byteLength: request.declaredBytes,
      mediaType: 'image/png',
      sha256: digest,
      etag: 'synthetic',
    });
    await db.insert(jobSnapshots).values({
      jobId: inputId,
      kind: 'record_organize',
      resourceId: inputId,
      inputVersion: version,
      status: 'awaiting_manual',
      result: initialBatchMetadata(f.evaluator, inputId, []),
      attempt: 1,
      revision: 1,
      updatedAt: at.toISOString(),
    });
    await db.insert(arrangeInputs).values({
      id: inputId,
      creatorAccountId: f.account,
      jobId: inputId,
      inputVersion: version,
      batchId: inputId,
      evaluationNodeId: f.node,
      boundAt: at,
      occurredOn: '2026-11-01',
      origin: 'attachment',
      originalInput: { kind: 'media', operationId: inputId, materialIds: [id] },
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
    await db.insert(mediaMaterials).values(row);
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
    await db.insert(mediaReviewItems).values({
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
    tx: DbExecutor = db,
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
      changes: [
        { itemId: f.question.itemId, previousRevision: 1, revision: 2 },
      ],
      auditId,
      createdAt: new Date('2026-11-01T12:00:00Z'),
    };
  }

  async function imageCase() {
    const f = await material();
    const scopeAuditId = await recordAudit(db, {
      actorId: f.account,
      action: 'material.capture',
      resourceId: f.row.id,
    });
    await db
      .update(mediaMaterials)
      .set({
        intakeScope: {
          subjects: [
            {
              personId: f.target,
              evaluationNodeId: f.node,
              cohortId: f.cohort,
            },
          ],
          kind: 'evaluation',
          requiredKinds: [],
          occurredOn: '2026-11-01',
        },
        scopeAuditId,
      })
      .where(eq(mediaMaterials.id, f.row.id));
    const op = await operation(f);
    const resolution = {
      action: 'confirm_scope' as const,
      region: { left: 0, top: 0, right: 0.5, bottom: 1 },
      personIds: [f.target],
    };
    op.command = materialReviewCommandSchema.parse({
      ...op.command,
      resolution,
    });
    op.receipt = materialReviewResolutionReceiptSchema.parse({
      ...op.receipt,
      resolution,
      resume: { stage: 'image_scope_check', jobId: f.row.inputId },
    });
    await db.insert(mediaReviewOperations).values(op);
    await db
      .update(mediaReviewItems)
      .set({ currentOperationId: op.id, revision: 2, state: 'resolved' })
      .where(eq(mediaReviewItems.id, f.question.itemId));
    return { ...f, op, resolution, bytes };
  }

  return imageCase();
}
