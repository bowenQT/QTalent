import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { and, eq, sql } from 'drizzle-orm';
import { PgBoss, fromDrizzle } from 'pg-boss';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import {
  nativeDatabase,
  seedNativeCase,
  seedNativeRules,
  businessAt,
  wallAt,
} from '../../fixtures/bow-845/native';
import {
  stagedMaterialUploads,
  seedAlreadyCapturedAttachmentScope,
  confirmBusinessDraft,
} from './business-fixtures';
import { syntheticBusinessModel } from './business-worker';
import { createRecordArrangeWorker } from '../../../src/server/usecases/record-arrange-worker';
import { createParsedAttachmentBatchRequests } from '../../../src/server/usecases/parsed-attachment-batch';
import { parsedAttachmentArrangeQueue } from '../../../src/server/jobs/parsed-attachment-arrange';
import { attachmentParseQueue } from '../../../src/server/jobs/attachment-parse';
import { recordArrangeQueue } from '../../../src/server/jobs/record-arrange';
import {
  mediaMaterials,
  mediaReviewItems,
} from '../../../src/server/modules/records/material-review/schema';
import {
  fragments,
  materialParses,
  recordDrafts,
  events,
  eventSources,
} from '../../../src/server/modules/records';
import { confirmations } from '../../../src/server/modules/talent';
import { evaluationRelations } from '../../../src/server/modules/programs';
import { jobSnapshots } from '../../../src/server/jobs/schema';
import {
  saveRecordDraft,
  undoRecordSave,
} from '../../../src/server/usecases/record-save';
import { readMaterialSource } from '../../../src/server/usecases/read-material-source';

let connection: Awaited<ReturnType<typeof nativeDatabase>>;
let uploads: Awaited<ReturnType<typeof stagedMaterialUploads>>;
let boss: PgBoss;
let worker: ChildProcess | undefined;
let modelCalls = 0;
const clock = { businessNow: () => businessAt, wallNow: () => wallAt };
beforeAll(async () => {
  connection = await nativeDatabase();
  await seedNativeRules(connection.db);
  uploads = await stagedMaterialUploads(connection.db, connection.testUrl);
  boss = new PgBoss({ connectionString: connection.testUrl });
  boss.on('error', () => undefined);
  await boss.start();
  for (const queue of [
    attachmentParseQueue,
    recordArrangeQueue,
    parsedAttachmentArrangeQueue,
  ])
    await boss.createQueue(queue, { retryLimit: 0 });
}, 30_000);
afterEach(async () => {
  await stopWorker();
});
afterAll(async () => {
  await stopWorker();
  await boss?.stop();
  await uploads?.close();
  await connection?.close();
}, 30_000);

async function stopWorker() {
  const current = worker;
  worker = undefined;
  if (!current || current.exitCode !== null || current.signalCode !== null)
    return;
  const exit = once(current, 'exit');
  current.kill('SIGTERM');
  const force = setTimeout(() => current.kill('SIGKILL'), 15_000);
  const [code, signal] = await exit;
  clearTimeout(force);
  expect({ code, signal }, 'test-composed worker must stop cleanly').toEqual({
    code: 0,
    signal: null,
  });
}
async function startWorker() {
  modelCalls = 0;
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'tests/e2e/bow-871/business-worker.ts'],
    {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        APP_ENV: 'test',
        DATABASE_URL: connection.testUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  worker = child;
  // Consume diagnostics without printing connection-bearing database errors.
  child.stdout?.on('data', () => undefined);
  child.stderr?.on('data', () => undefined);
  child.on('message', (message) => {
    if (
      typeof message === 'object' &&
      message &&
      'type' in message &&
      message.type === 'model-call'
    )
      modelCalls++;
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Business worker readiness deadline')),
      30_000,
    );
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', () => {
      clearTimeout(timeout);
      reject(new Error('Business worker exited before ready'));
    });
    child.on('message', (message) => {
      if (
        typeof message === 'object' &&
        message &&
        'type' in message &&
        message.type === 'ready'
      ) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  return child.pid;
}
async function eventually<T>(read: () => Promise<T>, expected: unknown) {
  await expect
    .poll(
      async () => {
        if (worker && (worker.exitCode !== null || worker.signalCode !== null))
          throw new Error('Business worker stopped before the durable outcome');
        return read();
      },
      { timeout: 30_000, interval: 100 },
    )
    .toEqual(expected);
}
function dependencies() {
  return {
    db: connection.db,
    businessNow: () => businessAt,
    now: () => new Date(wallAt),
    enqueue: async (
      tx: Parameters<Parameters<typeof connection.db.transaction>[0]>[0],
      job: { jobId: string; attempt: number },
    ) => {
      const sent = await boss.send(
        parsedAttachmentArrangeQueue,
        { jobId: job.jobId, attempt: job.attempt },
        { db: fromDrizzle(tx, sql), retryLimit: 0 },
      );
      if (!sent) throw new Error('Actual parsed attachment queue rejected');
    },
  };
}
async function submit(format: 'txt' | 'docx' | 'pdf') {
  const facts = await seedNativeCase(connection.db);
  const filename = `演示业务回归.${format}`;
  const mediaType =
    format === 'txt'
      ? 'text/plain'
      : format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const bytes =
    format === 'txt'
      ? Buffer.from('演示材料：补齐回滚步骤。\r\n\r\n记录交接说明。\n')
      : await readFile(`tests/fixtures/attachments/chinese-pages.${format}`);
  const uploaded = await uploads.upload({
    accountId: facts.account,
    evaluationNodeId: facts.node,
    filename,
    mediaType,
    bytes,
  });
  const provider = syntheticBusinessModel();
  const app = createRecordArrangeWorker(
    {
      db: connection.db,
      boss,
      businessNow: () => businessAt,
      now: () => new Date(wallAt),
      environment: { MODELINK_API_KEY: 'synthetic-business-regression-only' },
    },
    { fetch: provider.fetch },
  );
  const input = {
    operationId: randomUUID(),
    evaluationNodeId: facts.node,
    personIds: [],
    projectId: null,
    text: '',
    files: [{ clientFileId: randomUUID(), uploadId: uploaded.grant.uploadId }],
  };
  const result = await app.requests.create(facts.account, input);
  expect(result.status).toBe('success');
  if (result.status !== 'success')
    throw new Error('Actual media producer rejected');
  const [material] = await connection.db
    .select()
    .from(mediaMaterials)
    .where(eq(mediaMaterials.uploadId, uploaded.grant.uploadId));
  if (!material) throw new Error('Actual media material missing');
  return {
    facts,
    app,
    input,
    uploaded,
    material,
    batchId: result.result.batchId,
    reviews: createParsedAttachmentBatchRequests(dependencies()),
    parentCalls: provider.calls,
  };
}
type Case = Awaited<ReturnType<typeof submit>>;
async function pending(h: Case) {
  await eventually(
    async () =>
      (
        await connection.db
          .select()
          .from(mediaReviewItems)
          .where(eq(mediaReviewItems.materialId, h.material.id))
      ).length,
    1,
  );
  const [item] = await connection.db
    .select()
    .from(mediaReviewItems)
    .where(eq(mediaReviewItems.materialId, h.material.id));
  expect(item).toMatchObject({ kind: 'unknown_person', state: 'pending' });
  const receipt = await h.app.requests.readBatch(h.facts.account, {
    batchId: h.batchId,
  });
  expect(receipt.status).toBe('success');
  if (receipt.status !== 'success')
    throw new Error('Actual pending batch is unreadable');
  expect(receipt.result.status).toBe('needs_review');
  expect(receipt.result.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ itemId: item!.id, kind: 'unknown_person' }),
    ]),
  );
  expect(receipt.result.draftSet).toBeNull();
  expect(modelCalls).toBe(0);
  expect(h.parentCalls()).toBe(0);
  return item!;
}
async function drafts(h: Case) {
  return connection.db
    .select()
    .from(recordDrafts)
    .where(eq(recordDrafts.batchId, h.batchId))
    .orderBy(recordDrafts.draftId);
}
async function formal(h: Case) {
  return connection.db
    .select()
    .from(events)
    .where(eq(events.personId, h.facts.target));
}
async function bindPreviouslyCaptured(h: Case) {
  const item = await pending(h);
  // This explicit prerequisite fixture does NOT turn ordinary staged uploads
  // into a proven capture product. Only the downstream bridge is under test.
  await seedAlreadyCapturedAttachmentScope(connection.db, {
    materialId: h.material.id,
    accountId: h.facts.account,
    personId: h.facts.target,
    nodeId: h.facts.node,
    cohortId: h.facts.cohort,
  });
  const command = {
    operationId: randomUUID(),
    batchId: h.batchId,
    itemId: item.id,
    expectedRevision: item.revision,
    kind: 'unknown_person',
    resolution: { action: 'bind_people', personIds: [h.facts.target] },
  };
  const resolved = await h.reviews.resolve(h.facts.account, command);
  expect(resolved.status).toBe('success');
  return { command, resolved };
}

it.each(['txt', 'docx', 'pdf'] as const)(
  '%s: real parse→known-source fixture→real binding/queue→AI draft→human confirmation/undo preserves canonical provenance',
  async (format) => {
    const h = await submit(format);
    const originalPid = await startWorker();
    if (format === 'txt') {
      await pending(h);
      await stopWorker();
    }
    await bindPreviouslyCaptured(h);
    if (format === 'txt') {
      // Resolve persists a successful-path generation while no consumer exists.
      const generations = await connection.db
        .select()
        .from(jobSnapshots)
        .where(
          and(
            eq(jobSnapshots.kind, 'record_attachment_organize'),
            sql`${jobSnapshots.result}->'generation'->>'materialId'=${h.material.id}`,
          ),
        );
      expect(generations).toHaveLength(1);
      const generation = generations[0]!;
      expect(generation.status).toBe('queued');
      expect(await drafts(h)).toEqual([]);
      expect(modelCalls).toBe(0);
      const queued = await connection.db.execute(sql`
        select id from pgboss.job
        where name=${parsedAttachmentArrangeQueue}
          and data->>'jobId'=${generation.jobId} and state='created'
      `);
      expect(queued.rows).toHaveLength(1);
      expect(await startWorker()).not.toBe(originalPid);
      await eventually(async () => (await drafts(h)).length, 1);
      const persisted = await drafts(h);
      expect(modelCalls).toBe(1);
      const delivery = await boss.send(
        parsedAttachmentArrangeQueue,
        { jobId: generation.jobId, attempt: generation.attempt },
        { retryLimit: 0 },
      );
      expect(delivery).toBeTruthy();
      await eventually(
        async () =>
          (
            await connection.db.execute(
              sql`select state from pgboss.job where id=${delivery}`,
            )
          ).rows[0]?.state,
        'completed',
      );
      expect(await drafts(h)).toEqual(persisted);
      expect(modelCalls).toBe(1);
    } else {
      await eventually(async () => (await drafts(h)).length, 1);
    }
    const rows = await drafts(h);
    const draft = rows[0]!.draft;
    expect(modelCalls).toBe(1);
    expect(draft.origin).toBe('ai_suggestion');
    expect(await formal(h)).toEqual([]);
    const [parse] = await connection.db
      .select()
      .from(materialParses)
      .where(eq(materialParses.jobId, h.material.parseJobId));
    expect(parse).toBeDefined();
    const stored = await connection.db
      .select()
      .from(fragments)
      .where(eq(fragments.parseVersionId, parse!.id));
    expect(stored.length).toBeGreaterThan(0);
    expect(
      draft.sourceReferences.map((reference) => reference.fragmentId).sort(),
    ).toEqual(stored.map((fragment) => fragment.id).sort());
    expect(
      draft.sourceReferences.every(
        (reference) =>
          reference.originalVersionId === h.material.originalVersionId &&
          reference.location.kind === (format === 'pdf' ? 'pdf' : 'document'),
      ),
    ).toBe(true);
    const save = confirmBusinessDraft(draft);
    const saved = await saveRecordDraft(
      connection.db,
      h.facts.account,
      save,
      clock,
    );
    expect(saved.result.events).toHaveLength(1);
    expect(saved.result.confirmationIds).toHaveLength(1);
    expect(saved.result.revision).toBe(draft.revision + 1);
    const savedRows = rows.map((row) => ({
      ...row,
      revision: row.revision + 1,
      draft: { ...row.draft, revision: row.draft.revision + 1 },
    }));
    expect(await drafts(h)).toEqual(savedRows);
    expect(
      await saveRecordDraft(connection.db, h.facts.account, save, clock),
    ).toEqual({ ...saved, replayed: true });
    expect(await drafts(h)).toEqual(savedRows);
    const [confirmed] = await connection.db
      .select()
      .from(confirmations)
      .where(eq(confirmations.id, saved.result.confirmationIds[0]!));
    expect(confirmed).toMatchObject({
      active: true,
      evaluatorId: h.facts.evaluator,
      value: 3,
    });
    const mappings = await connection.db
      .select()
      .from(eventSources)
      .where(eq(eventSources.eventId, saved.result.events[0]!.eventId));
    expect(mappings.map((mapping) => mapping.fragmentId).sort()).toEqual(
      stored.map((fragment) => fragment.id).sort(),
    );
    for (const reference of draft.sourceReferences) {
      const source = await readMaterialSource(
        connection.db,
        h.facts.account,
        {
          fragmentId: reference.fragmentId,
          originalVersionId: reference.originalVersionId,
        },
        () => businessAt,
      );
      expect(source.status).toBe('success');
    }
    const undone = await undoRecordSave(
      connection.db,
      h.facts.account,
      { operation_id: randomUUID(), saveId: saved.result.saveId },
      clock,
    );
    const withdrawn = await formal(h);
    expect(withdrawn).toHaveLength(1);
    expect(withdrawn[0]!.withdrawnAt).not.toBeNull();
    expect(undone.result.draftRestoration).toEqual({
      status: 'available',
      draftId: draft.draftId,
      draftRevision: draft.revision + 2,
    });
    expect(await drafts(h)).toEqual(
      rows.map((row) => ({
        ...row,
        revision: row.revision + 2,
        draft: { ...row.draft, revision: row.draft.revision + 2 },
      })),
    );
    const [inactive] = await connection.db
      .select()
      .from(confirmations)
      .where(eq(confirmations.id, saved.result.confirmationIds[0]!));
    expect(inactive?.active).toBe(false);
  },
  90_000,
);

it('unclassified staged bytes survive test-process reconstruction but cannot be promoted by binding or duplicate delivery', async () => {
  const originalPid = await startWorker();
  await stopWorker();
  const h = await submit('txt');
  const restoredPid = await startWorker();
  expect(restoredPid).not.toBe(originalPid);
  const item = await pending(h);
  const parseBefore = await connection.db
    .select()
    .from(materialParses)
    .where(eq(materialParses.jobId, h.material.parseJobId));
  expect(parseBefore).toHaveLength(1);
  const forbiddenBind = await h.reviews.resolve(h.facts.account, {
    operationId: randomUUID(),
    batchId: h.batchId,
    itemId: item.id,
    expectedRevision: item.revision,
    kind: 'unknown_person',
    resolution: { action: 'bind_people', personIds: [h.facts.target] },
  });
  expect(forbiddenBind.status).toBe('conflict');
  expect(await h.app.requests.create(h.facts.account, h.input)).toMatchObject({
    status: 'success',
    replayed: true,
  });
  const delivery = await boss.send(
    attachmentParseQueue,
    { jobId: h.material.parseJobId, attempt: 1 },
    { retryLimit: 0 },
  );
  expect(delivery).toBeTruthy();
  await eventually(
    async () =>
      (
        await connection.db.execute(
          sql`select state from pgboss.job where id=${delivery}`,
        )
      ).rows[0]?.state,
    'completed',
  );
  expect(modelCalls).toBe(0);
  await stopWorker();
  await startWorker();
  await pending(h);
  expect(
    await connection.db
      .select()
      .from(materialParses)
      .where(eq(materialParses.jobId, h.material.parseJobId)),
  ).toEqual(parseBefore);
  expect(await drafts(h)).toEqual([]);
  expect(await formal(h)).toEqual([]);
  expect(modelCalls).toBe(0);
  const [material] = await connection.db
    .select()
    .from(mediaMaterials)
    .where(eq(mediaMaterials.id, h.material.id));
  expect(material).toMatchObject({ intakeScope: null, scopeAuditId: null });
}, 90_000);

it('current real node permission is required before upload and rechecked before queued parsing', async () => {
  const h = await submit('txt');
  await expect(
    uploads.runtime.collections.create(h.facts.outsiderAccount, {
      operationId: randomUUID(),
      target: { kind: 'unassigned', evaluationNodeId: h.facts.node },
    }),
  ).rejects.toMatchObject({ status: 'forbidden' });
  await connection.db
    .update(evaluationRelations)
    .set({ revokedAt: businessAt })
    .where(eq(evaluationRelations.id, h.facts.relation));
  await startWorker();
  await eventually(
    async () =>
      (
        await connection.db
          .select()
          .from(jobSnapshots)
          .where(eq(jobSnapshots.jobId, h.material.parseJobId))
      )[0]?.status,
    'failed',
  );
  expect(
    await connection.db
      .select()
      .from(materialParses)
      .where(eq(materialParses.jobId, h.material.parseJobId)),
  ).toEqual([]);
  expect(await drafts(h)).toEqual([]);
  expect(await formal(h)).toEqual([]);
  expect(modelCalls).toBe(0);
  expect(
    await connection.db
      .select()
      .from(jobSnapshots)
      .where(
        and(
          eq(jobSnapshots.kind, 'record_attachment_organize'),
          sql`${jobSnapshots.result}->'generation'->>'materialId'=${h.material.id}`,
        ),
      ),
  ).toEqual([]);
}, 60_000);

it('real attribution undo invalidates its generated draft; rebinding never revives the old draft and a confirmed successor blocks undo', async () => {
  const h = await submit('txt');
  await startWorker();
  const binding = await bindPreviouslyCaptured(h);
  await eventually(async () => (await drafts(h)).length, 1);
  if (binding.resolved.status !== 'success')
    throw new Error('Binding prerequisite failed');
  const oldDraft = (await drafts(h))[0]!.draft;
  const oldSave = confirmBusinessDraft(oldDraft);
  const undone = await h.reviews.undo(h.facts.account, {
    operationId: randomUUID(),
    batchId: h.batchId,
    itemId: binding.command.itemId,
    expectedRevision: binding.resolved.result.revision,
    kind: 'unknown_person',
    action: 'undo',
  });
  expect(undone.status).toBe('success');
  if (undone.status !== 'success')
    throw new Error('Actual attribution undo failed');
  await expect(
    saveRecordDraft(connection.db, h.facts.account, oldSave, clock),
  ).rejects.toMatchObject({ status: 'conflict' });
  expect(await formal(h)).toEqual([]);
  const rebound = await h.reviews.resolve(h.facts.account, {
    ...binding.command,
    operationId: randomUUID(),
    expectedRevision: undone.result.item.revision,
  });
  expect(rebound.status).toBe('success');
  if (rebound.status !== 'success') throw new Error('Actual rebind failed');
  await eventually(
    async () =>
      (await drafts(h)).filter((row) => row.draftId !== oldDraft.draftId)
        .length,
    1,
  );
  await expect(
    saveRecordDraft(
      connection.db,
      h.facts.account,
      { ...oldSave, operation_id: randomUUID() },
      clock,
    ),
  ).rejects.toMatchObject({ status: 'conflict' });
  expect(await formal(h)).toEqual([]);
  const current = (await drafts(h)).find(
    (row) => row.draftId !== oldDraft.draftId,
  )!.draft;
  const saved = await saveRecordDraft(
    connection.db,
    h.facts.account,
    confirmBusinessDraft(current),
    clock,
  );
  const snapshot = async () => ({
    draftRows: await drafts(h),
    eventRows: await formal(h),
    confirmationRows: await connection.db
      .select()
      .from(confirmations)
      .where(eq(confirmations.id, saved.result.confirmationIds[0]!)),
    reviewRows: await connection.db
      .select()
      .from(mediaReviewItems)
      .where(eq(mediaReviewItems.materialId, h.material.id)),
  });
  const committed = await snapshot();
  expect(committed.eventRows).toHaveLength(1);
  expect(committed.confirmationRows[0]).toMatchObject({ active: true });
  const denied = await h.reviews.undo(h.facts.account, {
    operationId: randomUUID(),
    batchId: h.batchId,
    itemId: binding.command.itemId,
    expectedRevision: rebound.result.revision,
    kind: 'unknown_person',
    action: 'undo',
  });
  expect(denied.status).toBe('conflict');
  expect(await snapshot()).toEqual(committed);
  expect(modelCalls).toBe(2);
}, 90_000);
