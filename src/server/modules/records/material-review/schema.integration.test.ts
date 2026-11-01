import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { readMediaReviewStateInTransaction } from './read';
import { lockUploadCollection } from '../uploads/store';
import { currentImageDecision } from './image-decision';
import {
  createInitialImageDisclosureReader,
  readInitialImageDisclosureInTransaction,
} from '../../../usecases/media-initial-image';
import { initialBatchMetadata } from '../../../usecases/record-batch-arrange-state';
import { evaluationRelations } from '../../programs';
import { accountBindings } from '../../directory';
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
  const request = {
    ...fixture(collectionId).request,
    filename: 'demo.png',
    mediaType: 'image/png',
    target: { kind: 'people' as const, personIds: [f.target] },
  };
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
    result: initialBatchMetadata(f.evaluator, inputId, []),
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

it('retains one exact group operation for multiple affected items of the same material', async () => {
  const f = await material();
  const question = { ...f.question, itemId: randomUUID() };
  await c.db.insert(mediaReviewItems).values({
    id: question.itemId,
    materialId: f.row.id,
    kind: question.kind,
    revision: 1,
    state: 'pending',
    question,
    currentOperationId: null,
  });
  await c.db.transaction(async (tx) => {
    const op = await operation(f, tx);
    op.changes.push({
      itemId: question.itemId,
      previousRevision: 1,
      revision: 2,
    });
    await tx.insert(mediaReviewOperations).values(op);
    for (const change of op.changes) {
      await tx
        .update(mediaReviewItems)
        .set({
          revision: change.revision,
          state: 'resolved',
          currentOperationId: op.id,
        })
        .where(eq(mediaReviewItems.id, change.itemId));
    }
    expect(
      await tx
        .select()
        .from(mediaReviewItems)
        .where(eq(mediaReviewItems.currentOperationId, op.id)),
    ).toHaveLength(2);
    expect(
      (
        await tx
          .select()
          .from(mediaReviewOperations)
          .where(eq(mediaReviewOperations.id, op.id))
      )[0].changes,
    ).toEqual(op.changes);
  });
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

it('reads real same-transaction media identity without promoting completed upload or unknown scope to processing permission', async () => {
  const f = await material();
  await c.db.transaction(async (tx) => {
    const state = await readMediaReviewStateInTransaction(tx, f.row.id);
    expect(state).toMatchObject({
      availability: 'current',
      upload: { originalVersionId: f.row.originalVersionId },
      material: { intakeScope: null },
      input: { inputSource: null },
      items: [{ state: 'pending', currentOperationId: null }],
    });
    expect(state?.collection.members).toHaveLength(1);
    expect(state?.operations).toEqual([]);
  });
});

it('rejects Repeatable Read because a pre-wait snapshot cannot establish current membership', async () => {
  const f = await material();
  await expect(
    c.db.transaction((tx) => readMediaReviewStateInTransaction(tx, f.row.id), {
      isolationLevel: 'repeatable read',
    }),
  ).rejects.toThrow('media_read_committed_required');
});

it('retains current operations and exact historical draft dependencies in the caller transaction', async () => {
  const f = await material();
  const fail = new Error('synthetic rollback');
  await expect(
    c.db.transaction(async (tx) => {
      const op = await operation(f, tx);
      await tx.insert(mediaReviewOperations).values(op);
      await tx
        .update(mediaReviewItems)
        .set({ currentOperationId: op.id, revision: 2, state: 'resolved' })
        .where(eq(mediaReviewItems.id, f.question.itemId));
      const state = await readMediaReviewStateInTransaction(tx, f.row.id);
      expect(state?.operations).toEqual([op]);
      expect(state?.items[0]).toMatchObject({
        currentOperationId: op.id,
        revision: 2,
      });
      expect(
        await c.db
          .select()
          .from(mediaReviewOperations)
          .where(eq(mediaReviewOperations.id, op.id)),
      ).toEqual([]);
      throw fail;
    }),
  ).rejects.toBe(fail);
  expect(
    (
      await c.db.transaction((tx) =>
        readMediaReviewStateInTransaction(tx, f.row.id),
      )
    )?.operations,
  ).toEqual([]);
});

it('waits on the actual collection quota lock then rereads a committed release, retaining its archived facts', async () => {
  const f = await material();
  let unlock!: () => void;
  let locked!: () => void;
  const gate = new Promise<void>((r) => {
    unlock = r;
  });
  const ready = new Promise<void>((r) => {
    locked = r;
  });
  let readerPid = 0;
  const writer = c.db.transaction(async (tx) => {
    await lockUploadCollection(tx, f.row.recordCollectionId);
    await tx
      .update(uploadIntents)
      .set({
        releasedAt: 300,
        releaseOperationId: randomUUID(),
        releaseFingerprint: 'e'.repeat(64),
        revision: 2,
      })
      .where(eq(uploadIntents.id, f.row.uploadId));
    locked();
    await gate;
  });
  await ready;
  const reader = c.db.transaction(async (tx) => {
    const pid = await tx.execute<{ pid: number }>(
      sql`select pg_backend_pid() as pid`,
    );
    readerPid = pid.rows[0].pid;
    return readMediaReviewStateInTransaction(tx, f.row.id);
  });
  try {
    let waiting = false;
    for (let i = 0; i < 100 && !waiting; i++) {
      if (readerPid) {
        const observed = await c.db.execute<{ waiting: boolean }>(
          sql`select cardinality(pg_blocking_pids(${readerPid})) > 0 as waiting`,
        );
        waiting = observed.rows[0].waiting;
      }
      if (!waiting) await new Promise((r) => setTimeout(r, 10));
    }
    expect(waiting).toBe(true);
  } finally {
    unlock();
  }
  await writer;
  const state = await reader;
  expect(state).toMatchObject({
    availability: 'released',
    member: { intent: { revision: 2, releasedAt: 300 } },
  });
  expect(state?.collection.members).toHaveLength(1);
});

async function imageCase() {
  const f = await material();
  const scopeAuditId = await recordAudit(c.db, {
    actorId: f.account,
    action: 'material.capture',
    resourceId: f.row.id,
  });
  await c.db
    .update(mediaMaterials)
    .set({
      intakeScope: {
        subjects: [
          { personId: f.target, evaluationNodeId: f.node, cohortId: f.cohort },
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
  op.command = materialReviewCommandSchema.parse({ ...op.command, resolution });
  op.receipt = materialReviewResolutionReceiptSchema.parse({
    ...op.receipt,
    resolution,
    resume: { stage: 'image_scope_check', jobId: f.row.inputId },
  });
  await c.db.insert(mediaReviewOperations).values(op);
  await c.db
    .update(mediaReviewItems)
    .set({ currentOperationId: op.id, revision: 2, state: 'resolved' })
    .where(eq(mediaReviewItems.id, f.question.itemId));
  return { ...f, op, resolution };
}
const imageRead = (f: Awaited<ReturnType<typeof material>>) =>
  createInitialImageDisclosureReader(c.db)(
    f.account,
    f.row.id,
    '2026-11-01T12:00:00.000Z',
  );

it('loads a real initial image crop decision with current complete scope and native node authorization, preserving null source', async () => {
  const f = await imageCase();
  const result = await imageRead(f);
  expect(result).toMatchObject({
    facts: {
      materialId: f.row.id,
      source: null,
      members: [f.target],
      scope: {
        state: 'verified',
        region: f.resolution.region,
        subjects: [{ personId: f.target, evaluationNodeId: f.node }],
      },
    },
    authority: { processing: { allowed: true, accountId: f.account } },
  });
  expect(JSON.stringify(result)).not.toContain('objectKey');
  expect(JSON.stringify(result)).not.toContain('synthetic');
});

it('does not infer missing complete capture scope from the crop selection, creator or node', async () => {
  const f = await imageCase();
  await c.db
    .update(mediaMaterials)
    .set({ intakeScope: null, scopeAuditId: null })
    .where(eq(mediaMaterials.id, f.row.id));
  expect(await imageRead(f)).toBeNull();
});

it('rejects current-role revocation and a second out-of-scope co-subject rather than filtering it away', async () => {
  const f = await imageCase();
  await c.db
    .update(evaluationRelations)
    .set({ revokedAt: '2026-11-01T11:59:00Z' })
    .where(eq(evaluationRelations.id, f.relation));
  expect(await imageRead(f)).toBeNull();
  await c.db
    .update(evaluationRelations)
    .set({ revokedAt: null })
    .where(eq(evaluationRelations.id, f.relation));
  await c.db
    .update(mediaMaterials)
    .set({
      intakeScope: {
        subjects: [
          { personId: f.target, evaluationNodeId: f.node, cohortId: f.cohort },
          {
            personId: f.other,
            evaluationNodeId: f.otherNode,
            cohortId: f.cohort,
          },
        ],
        kind: 'evaluation',
        requiredKinds: [],
        occurredOn: '2026-11-01',
      },
    })
    .where(eq(mediaMaterials.id, f.row.id));
  expect(await imageRead(f)).toBeNull();
});

it('rejects a stale item revision or a receipt that disagrees with the accepted crop command', async () => {
  const f = await imageCase();
  await c.db
    .update(mediaReviewItems)
    .set({ revision: 3 })
    .where(eq(mediaReviewItems.id, f.question.itemId));
  expect(await imageRead(f)).toBeNull();
  await c.db
    .update(mediaReviewItems)
    .set({ revision: 2 })
    .where(eq(mediaReviewItems.id, f.question.itemId));
  await c.db
    .update(mediaReviewOperations)
    .set({
      receipt: materialReviewResolutionReceiptSchema.parse({
        ...f.op.receipt,
        resolution: {
          ...f.resolution,
          region: { left: 0, top: 0, right: 1, bottom: 1 },
        },
      }),
    })
    .where(eq(mediaReviewOperations.id, f.op.id));
  expect(await imageRead(f)).toBeNull();
});

it('uses only the current pointer after undo; an old resolved receipt cannot revive disclosure', async () => {
  const f = await imageCase();
  await c.db
    .update(mediaReviewItems)
    .set({ state: 'pending', currentOperationId: null, revision: 3 })
    .where(eq(mediaReviewItems.id, f.question.itemId));
  const state = await c.db.transaction((tx) =>
    readMediaReviewStateInTransaction(tx, f.row.id),
  );
  expect(state?.operations).toHaveLength(1);
  expect(currentImageDecision(state!)).toEqual({ state: 'unavailable' });
  expect(await imageRead(f)).toBeNull();
});

it('rejects a current account-to-person rebind without rewriting the historical decision', async () => {
  const f = await imageCase();
  await c.db
    .update(accountBindings)
    .set({ personId: f.other })
    .where(eq(accountBindings.accountId, f.account));
  expect(await imageRead(f)).toBeNull();
  expect(
    await c.db
      .select()
      .from(mediaReviewOperations)
      .where(eq(mediaReviewOperations.id, f.op.id)),
  ).toEqual([f.op]);
});

it('does not treat an unrelated audit ID as captured scope proof', async () => {
  const f = await imageCase();
  const unrelated = await recordAudit(c.db, {
    actorId: f.account,
    action: 'material.capture',
    resourceId: 'synthetic-other-material',
  });
  await c.db
    .update(mediaMaterials)
    .set({ scopeAuditId: unrelated })
    .where(eq(mediaMaterials.id, f.row.id));
  expect(await imageRead(f)).toBeNull();
});

it('waits for native relation revocation then applies the new authority before returning any image facts', async () => {
  const f = await imageCase();
  let unlock!: () => void;
  let locked!: () => void;
  const gate = new Promise<void>((r) => {
    unlock = r;
  });
  const ready = new Promise<void>((r) => {
    locked = r;
  });
  const writer = c.db.transaction(async (tx) => {
    await tx
      .update(evaluationRelations)
      .set({ revokedAt: '2026-11-01T11:59:00Z' })
      .where(eq(evaluationRelations.id, f.relation));
    locked();
    await gate;
  });
  await ready;
  let pid = 0;
  const reader = c.db.transaction(async (tx) => {
    const p = await tx.execute<{ pid: number }>(
      sql`select pg_backend_pid() as pid`,
    );
    pid = p.rows[0].pid;
    return readInitialImageDisclosureInTransaction(
      tx,
      f.account,
      f.row.id,
      '2026-11-01T12:00:00.000Z',
    );
  });
  try {
    let waiting = false;
    for (let i = 0; i < 100 && !waiting; i++) {
      if (pid) {
        const result = await c.db.execute<{ waiting: boolean }>(
          sql`select cardinality(pg_blocking_pids(${pid})) > 0 as waiting`,
        );
        waiting = result.rows[0].waiting;
      }
      if (!waiting) await new Promise((r) => setTimeout(r, 10));
    }
    expect(waiting).toBe(true);
  } finally {
    unlock();
  }
  await writer;
  expect(await reader).toBeNull();
});

it('does not reopen a terminal processing job solely because its old image decision remains resolved', async () => {
  const f = await imageCase();
  await c.db
    .update(jobSnapshots)
    .set({ status: 'completed' })
    .where(eq(jobSnapshots.jobId, f.row.inputId));
  expect(await imageRead(f)).toBeNull();
});
