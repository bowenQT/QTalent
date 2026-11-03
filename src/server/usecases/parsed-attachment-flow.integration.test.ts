import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { and, eq, sql } from 'drizzle-orm';
import { PgBoss, fromDrizzle } from 'pg-boss';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  nativeDatabase,
  seedNativeRules,
  businessAt,
} from '../../../tests/fixtures/bow-845/native';
import { materialReviewItemSchema } from '../../contracts/material-review';
import type { RecordBatchDraft } from '../../contracts/record';
import { grants } from '../modules/directory';
import { evaluationRelations } from '../modules/programs';
import {
  createFakeModelinkMaas,
  type ModelinkMaasClient,
} from '../integrations/maas';
import {
  originalVersions,
  recordDrafts,
  recordSaves,
  recordDraftEvents,
  events,
} from '../modules/records';
import {
  uploadIntents,
  uploadObjects,
  uploadCollections,
} from '../modules/records/uploads/schema';
import {
  mediaMaterials,
  mediaReviewItems,
  mediaReviewOperations,
} from '../modules/records/material-review/schema';
import { jobSnapshots } from '../jobs/schema';
import { readJobInTransaction, createJobStore } from '../jobs/repository';
import { createJobService } from '../jobs/service';
import { createParsedAttachmentPolicy } from './parsed-attachment-policy';
import { parsedAttachmentArrangeQueue } from '../jobs/parsed-attachment-arrange';
import { newJob } from '../jobs/state';
import { seedImageCase } from './material-images/native.fixture';
import { createParsedAttachmentWorker } from './parsed-attachment-worker';
import { createAttachmentParseWorker } from './attachment-parse-worker';
import { readParsedAttachmentReceipt } from './parsed-attachment-receipt';
import { readIntakeTable } from './talent-source-projection';
import { arrangeInputs } from '../modules/records/arrange/input-state/schema';
import { saveRecordDraft } from './record-save';
import {
  parsedAttachmentArrangeKind,
  readAttachmentArrangeMetadata,
} from './parsed-attachment-state';
import { mediaDraftDependenciesCurrent } from './media-draft-dependencies';

let connection: Awaited<ReturnType<typeof nativeDatabase>>;
let boss: PgBoss;
let pause: {
  personId: string;
  entered: () => void;
  wait: Promise<void>;
} | null = null;
let modelCalls = 0;
const client: ModelinkMaasClient = {
  async generateStructured(input) {
    modelCalls++;
    if (pause && JSON.stringify(input.messages).includes(pause.personId)) {
      pause.entered();
      await pause.wait;
    }
    const raw = JSON.parse(
      input.messages.find((message) => message.role === 'user')!
        .content as string,
    );
    const source = raw.sources[0];
    const quote = source.text.slice(0, 24);
    return createFakeModelinkMaas({
      events: [
        {
          eventKey: 'proposal',
          personIds: raw.personIds,
          sbi: {
            title: '演示事件',
            situation: '',
            behavior: quote,
            impact: '',
          },
          evidence: [{ reference: source.reference, quote }],
          scores: raw.personIds.map((personId: string) => ({
            state: 'unknown',
            personId,
            dimensionId: raw.dimensions[0],
            reason: '演示离线模型不产生评分',
          })),
        },
      ],
      similarGroups: [],
    }).generateStructured(input);
  },
};
const model = { client, calls: () => modelCalls };
let worker: ReturnType<typeof createParsedAttachmentWorker>;
beforeAll(async () => {
  connection = await nativeDatabase();
  await seedNativeRules(connection.db);
  boss = new PgBoss({ connectionString: connection.testUrl });
  await boss.start();
  worker = createParsedAttachmentWorker({
    db: connection.db,
    boss,
    client: model.client,
    businessNow: () => businessAt,
    now: () => new Date(),
  });
  await worker.register();
}, 30_000);
afterAll(async () => {
  await boss?.stop();
  await connection?.close();
}, 30_000);

/** Explicit precondition fixture, NOT a scope capture endpoint. Reuses the
 * existing native material fixture, replacing its synthetic image with TXT/PDF
 * before parsing. Real PG facts/permissions/queue/parser/845/846 are exercised;
 * only object storage and the model are controlled external boundaries. */
async function fixture(
  knownScope = true,
  pendingIdentity = true,
  format: 'txt' | 'pdf' = 'txt',
) {
  const f = await seedImageCase(connection.db);
  const bytes =
    format === 'pdf'
      ? await readFile('tests/fixtures/attachments/chinese-pages.pdf')
      : Buffer.from('补齐回滚步骤。记录边界触发条件。', 'utf8');
  const mediaType = format === 'pdf' ? 'application/pdf' : 'text/plain';
  const digest = createHash('sha256').update(bytes).digest('hex');
  const [intent] = await connection.db
    .select()
    .from(uploadIntents)
    .where(eq(uploadIntents.id, f.row.uploadId));
  await connection.db
    .update(uploadIntents)
    .set({
      request: {
        ...intent!.request,
        filename: `demo.${format}`,
        declaredMediaType: mediaType,
        declaredBytes: bytes.length,
      },
      declaredBytes: bytes.length,
      completed: { ...intent!.completed!, jobId: f.row.parseJobId },
    })
    .where(eq(uploadIntents.id, f.row.uploadId));
  await connection.db
    .update(uploadObjects)
    .set({ byteLength: bytes.length, mediaType, sha256: digest })
    .where(eq(uploadObjects.uploadId, f.row.uploadId));
  await connection.db
    .update(originalVersions)
    .set({ contentDigest: digest })
    .where(eq(originalVersions.id, f.row.originalVersionId));
  await connection.db
    .update(mediaReviewItems)
    .set({ currentOperationId: null, state: 'pending' })
    .where(eq(mediaReviewItems.id, f.question.itemId));
  await connection.db
    .delete(mediaReviewOperations)
    .where(eq(mediaReviewOperations.id, f.op.id));
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
  if (pendingIdentity)
    await connection.db
      .update(mediaReviewItems)
      .set({ kind: 'unknown_person', question, revision: 1, state: 'pending' })
      .where(eq(mediaReviewItems.id, question.itemId));
  else
    await connection.db
      .delete(mediaReviewItems)
      .where(eq(mediaReviewItems.id, question.itemId));
  if (!knownScope)
    await connection.db
      .update(mediaMaterials)
      .set({ intakeScope: null, scopeAuditId: null })
      .where(eq(mediaMaterials.id, f.row.id));
  const parser = createAttachmentParseWorker({
    db: connection.db,
    boss,
    demo: true,
    businessNow: () => businessAt,
    now: () => new Date(),
    afterParse: worker.afterParse,
    afterRecovery: worker.recover,
    storage: {
      async openObject() {
        return {
          status: 200 as const,
          headers: {
            'content-length': String(bytes.length),
            'content-type': mediaType,
          },
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
          close() {},
        };
      },
    },
  });
  const parse = () => parser.run({ jobId: f.row.parseJobId, attempt: 1 });
  const bind = (accountId = f.account, revision = 1) =>
    worker.requests.resolve(accountId, {
      operationId: randomUUID(),
      batchId: f.row.inputId,
      itemId: question.itemId,
      expectedRevision: revision,
      kind: 'unknown_person',
      resolution: { action: 'bind_people', personIds: [f.target] },
    });
  const undo = (revision = 2, accountId = f.account) =>
    worker.requests.undo(accountId, {
      operationId: randomUUID(),
      batchId: f.row.inputId,
      itemId: question.itemId,
      expectedRevision: revision,
      kind: 'unknown_person',
      action: 'undo',
    });
  const drafts = () =>
    connection.db
      .select()
      .from(recordDrafts)
      .where(eq(recordDrafts.batchId, f.row.inputId));
  const receipt = () =>
    connection.db.transaction(async (tx) => {
      await readIntakeTable(tx, 'locked');
      await readJobInTransaction(tx, f.row.inputId, true);
      const [input] = await tx
        .select()
        .from(arrangeInputs)
        .where(eq(arrangeInputs.id, f.row.inputId));
      return readParsedAttachmentReceipt(tx, input!, businessAt);
    });
  return { f, parse, bind, undo, drafts, receipt };
}
const save = (draft: RecordBatchDraft, accountId: string) =>
  saveRecordDraft(
    connection.db,
    accountId,
    {
      operation_id: randomUUID(),
      expected_revision: draft.revision,
      draftId: draft.draftId,
      personIds: draft.personIds,
      projectId: draft.projectId,
      sbi: draft.sbi,
      decisions: draft.personIds.map((personId) => ({
        personId,
        dimensionId: 'native-prof',
        action: 'unknown' as const,
        reason: '演示人工确认资料不足',
      })),
    },
    { businessNow: () => businessAt, wallNow: () => new Date().toISOString() },
  );

it('settles unknown scope as pending; a bind does not create proof or call the model', async () => {
  const h = await fixture(false);
  const calls = model.calls();
  await h.parse();
  expect((await h.receipt())?.status).toBe('needs_review');
  expect(await h.bind()).toMatchObject({ status: 'conflict' });
  await h.parse();
  expect(model.calls()).toBe(calls);
  expect(await h.drafts()).toEqual([]);
  const [material] = await connection.db
    .select()
    .from(mediaMaterials)
    .where(eq(mediaMaterials.id, h.f.row.id));
  expect(material!.intakeScope).toBeNull();
});
it.each(['txt', 'pdf'] as const)(
  'runs native canonical %s through845 exactly once and confirms its real source',
  async (format) => {
    const h = await fixture(true, false, format);
    const calls = model.calls();
    await h.parse();
    await expect
      .poll(async () => (await h.drafts()).length, { timeout: 15000 })
      .toBe(1);
    const draft = (await h.drafts())[0]!.draft;
    expect(draft.sourceReferences[0]!.location.kind).toBe(
      format === 'pdf' ? 'pdf' : 'document',
    );
    await h.parse();
    await worker.recover();
    expect(model.calls()).toBe(calls + 1);
    const saved = await save(draft, h.f.account);
    expect(saved.result.events).toHaveLength(1);
    const receipt = await h.receipt();
    expect(receipt?.confirmedDrafts).toHaveLength(1);
    expect(receipt?.draftSet).toBeNull();
  },
  30000,
);
it('does not confirm canonical PDF after current node permission is revoked', async () => {
  const h = await fixture(true, false, 'pdf');
  await h.parse();
  await expect
    .poll(async () => (await h.drafts()).length, { timeout: 15000 })
    .toBe(1);
  const draft = (await h.drafts())[0]!.draft;
  expect(draft.sourceReferences[0]!.location.kind).toBe('pdf');
  await connection.db
    .update(evaluationRelations)
    .set({ validTo: businessAt })
    .where(eq(evaluationRelations.id, h.f.relation));
  await expect(save(draft, h.f.account)).rejects.toMatchObject({
    status: 'forbidden',
  });
  expect(
    await connection.db
      .select()
      .from(recordSaves)
      .where(eq(recordSaves.batchId, h.f.row.inputId)),
  ).toHaveLength(0);
  expect((await h.drafts())[0]!.draft).toEqual(draft);
}, 30000);
it('enforces current review dependencies after undo/rebind, and blocks undo after real confirmation', async () => {
  const h = await fixture();
  await h.parse();
  expect(await h.bind()).toMatchObject({ status: 'success' });
  await expect
    .poll(async () => (await h.drafts()).length, { timeout: 15000 })
    .toBe(1);
  const old = (await h.drafts())[0]!.draft;
  expect(await h.undo()).toMatchObject({ status: 'success' });
  await expect(save(old, h.f.account)).rejects.toThrow(
    'material_review_changed',
  );
  expect(await h.bind(h.f.account, 3)).toMatchObject({ status: 'success' });
  await expect
    .poll(async () => (await h.drafts()).length, { timeout: 15000 })
    .toBe(2);
  await expect(save(old, h.f.account)).rejects.toThrow(
    'material_review_changed',
  );
  const current = (await h.drafts()).find(
    (row) => row.draftId !== old.draftId,
  )!.draft;
  const saved = await save(current, h.f.account);
  const ledger = async () => ({
    drafts: await h.drafts(),
    saves: await connection.db
      .select()
      .from(recordSaves)
      .where(eq(recordSaves.batchId, h.f.row.inputId)),
    mappings: await connection.db
      .select()
      .from(recordDraftEvents)
      .where(eq(recordDraftEvents.batchId, h.f.row.inputId)),
    event: await connection.db
      .select()
      .from(events)
      .where(eq(events.id, saved.result.events[0]!.eventId)),
  });
  const before = await ledger();
  expect(await h.undo(4)).toMatchObject({ status: 'conflict' });
  expect(await ledger()).toEqual(before);
}, 45000);
it('allows a different currently scoped HR to bind, auditing the real actor', async () => {
  const h = await fixture();
  await connection.db.insert(grants).values({
    id: randomUUID(),
    accountId: h.f.outsiderAccount,
    role: 'hr',
    scope: 'cohort',
    cohortId: h.f.cohort,
    validFrom: '2026-01-01',
  });
  await h.parse();
  expect(await h.bind(h.f.outsiderAccount)).toMatchObject({
    status: 'success',
  });
  await expect
    .poll(async () => (await h.drafts()).length, { timeout: 15000 })
    .toBe(1);
  const [operation] = await connection.db
    .select()
    .from(mediaReviewOperations)
    .where(eq(mediaReviewOperations.materialId, h.f.row.id));
  expect(operation!.actorAccountId).toBe(h.f.outsiderAccount);
  expect(operation!.actorPersonId).toBe(h.f.other);
  const [job] = await connection.db
    .select()
    .from(jobSnapshots)
    .where(
      and(
        eq(jobSnapshots.kind, parsedAttachmentArrangeKind),
        eq(jobSnapshots.resourceId, h.f.row.id),
      ),
    );
  expect(
    readAttachmentArrangeMetadata({ ...job!, result: job!.result ?? null })
      ?.generation.accountId,
  ).toBe(h.f.outsiderAccount);
}, 30000);
it('does not add the c902 unknown-person gate to another canonical producer', async () => {
  const h = await fixture(true, false);
  await h.parse();
  await expect
    .poll(async () => (await h.drafts()).length, { timeout: 15000 })
    .toBe(1);
  const draft = (await h.drafts())[0]!.draft;
  const otherProducerDraft = { ...draft, draftId: randomUUID() };
  // A parsed source alone is not an ownership marker. No c902 manifest owns this ID.
  expect(
    await connection.db.transaction((tx) =>
      mediaDraftDependenciesCurrent(tx, otherProducerDraft),
    ),
  ).toBe(true);
  const unrelated = newJob(
    {
      jobId: randomUUID(),
      kind: 'other-canonical-producer',
      resourceId: h.f.row.id,
      inputVersion: h.f.row.originalVersionId,
    },
    new Date().toISOString(),
  );
  await connection.db.insert(jobSnapshots).values(unrelated);
});

it('projects a cancelled file as failed instead of a successful parsed-only batch', async () => {
  const h = await fixture(true, false);
  let entered!: () => void, release!: () => void;
  const atModel = new Promise<void>((resolve) => {
    entered = resolve;
  });
  pause = {
    personId: h.f.target,
    entered,
    wait: new Promise<void>((resolve) => {
      release = resolve;
    }),
  };
  try {
    await h.parse();
    await atModel;
    const [child] = await connection.db
      .select()
      .from(jobSnapshots)
      .where(
        and(
          eq(jobSnapshots.kind, parsedAttachmentArrangeKind),
          eq(jobSnapshots.resourceId, h.f.row.id),
        ),
      );
    const deps = {
      db: connection.db,
      businessNow: () => businessAt,
      now: () => new Date(),
      enqueue: async (
        tx: import('../db/client').Transaction,
        job: import('../jobs/state').JobRecord,
      ) => {
        await boss.send(
          parsedAttachmentArrangeQueue,
          { jobId: job.jobId, attempt: job.attempt },
          { db: fromDrizzle(tx, sql), retryLimit: 0 },
        );
      },
    };
    const service = createJobService(
      createJobStore(connection.db),
      [createParsedAttachmentPolicy(deps)],
      () => new Date().toISOString(),
    );
    expect(
      await service.command(h.f.account, {
        operationId: randomUUID(),
        jobId: child!.jobId,
        expectedRevision: child!.revision,
        action: 'cancel',
      }),
    ).toMatchObject({ status: 'success' });
    release();
    pause = null;
    await expect
      .poll(
        async () => {
          const [job] = await connection.db
            .select()
            .from(jobSnapshots)
            .where(eq(jobSnapshots.jobId, child!.jobId));
          return job!.status;
        },
        { timeout: 15000 },
      )
      .toBe('cancelled');
    expect(await h.receipt()).toMatchObject({
      status: 'failed',
      files: [{ status: 'failed', retryable: false }],
    });
    expect(await h.drafts()).toEqual([]);
  } finally {
    release();
    pause = null;
  }
}, 30000);
it('does not disclose a hidden file review item in another file binding receipt', async () => {
  const visible = await fixture();
  const hidden = await fixture();
  await visible.parse();
  await hidden.parse();
  // Same uploader/batch, but B's captured complete scope includes an object/node
  // outside A's current authorization. The fixture is an explicit native fact.
  await connection.db
    .update(uploadIntents)
    .set({ accountId: visible.f.account })
    .where(eq(uploadIntents.id, hidden.f.row.uploadId));
  await connection.db
    .update(uploadCollections)
    .set({ creatorAccountId: visible.f.account })
    .where(eq(uploadCollections.id, hidden.f.row.recordCollectionId));
  await connection.db
    .update(mediaMaterials)
    .set({
      inputId: visible.f.row.inputId,
      inputVersion: visible.f.row.inputVersion,
    })
    .where(eq(mediaMaterials.id, hidden.f.row.id));
  await connection.db
    .update(arrangeInputs)
    .set({
      originalInput: {
        kind: 'media',
        operationId: visible.f.row.inputId,
        materialIds: [visible.f.row.id, hidden.f.row.id],
      },
    })
    .where(eq(arrangeInputs.id, visible.f.row.inputId));
  const [item] = await connection.db
    .select()
    .from(mediaReviewItems)
    .where(eq(mediaReviewItems.materialId, hidden.f.row.id));
  await connection.db
    .update(mediaReviewItems)
    .set({
      question: {
        ...item!.question,
        batchId: visible.f.row.inputId,
        evaluationNodeId: visible.f.node,
      },
    })
    .where(eq(mediaReviewItems.id, item!.id));
  for (const action of ['defer', 'keep_original_only']) {
    expect(
      await worker.requests.resolve(visible.f.account, {
        operationId: randomUUID(),
        batchId: visible.f.row.inputId,
        itemId: item!.id,
        expectedRevision: 1,
        kind: 'unknown_person',
        resolution: { action },
      }),
    ).toMatchObject({ status: 'not_found' });
  }
  const command = {
    operationId: randomUUID(),
    batchId: visible.f.row.inputId,
    itemId: visible.f.question.itemId,
    expectedRevision: 1,
    kind: 'unknown_person',
    resolution: { action: 'bind_people', personIds: [visible.f.target] },
  };
  const result = await worker.requests.resolve(visible.f.account, command);
  expect(result).toMatchObject({
    status: 'success',
    result: { remainingReviewItemIds: [], blockingReviewItemIds: [] },
  });
  expect(
    await worker.requests.resolve(visible.f.account, command),
  ).toMatchObject({
    status: 'success',
    replayed: true,
    result: { remainingReviewItemIds: [] },
  });
  expect(
    (await visible.receipt())?.files.map((file) => file.materialId),
  ).not.toContain(hidden.f.row.id);
}, 30000);

it('does not let another node-authorized actor control an unknown complete scope', async () => {
  const h = await fixture(false);
  await connection.db.insert(grants).values({
    id: randomUUID(),
    accountId: h.f.outsiderAccount,
    role: 'hr',
    scope: 'cohort',
    cohortId: h.f.cohort,
    validFrom: '2026-01-01',
  });
  await h.parse();
  const command = {
    operationId: randomUUID(),
    batchId: h.f.row.inputId,
    itemId: h.f.question.itemId,
    expectedRevision: 1,
    kind: 'unknown_person',
    resolution: { action: 'keep_original_only' },
  };
  expect(
    await worker.requests.resolve(h.f.outsiderAccount, command),
  ).toMatchObject({ status: 'not_found' });
  expect(
    await worker.requests.resolve(h.f.outsiderAccount, {
      ...command,
      resolution: { action: 'defer' },
    }),
  ).toMatchObject({ status: 'not_found' });
  expect(await worker.requests.resolve(h.f.account, command)).toMatchObject({
    status: 'success',
  });
  expect(await h.undo(2, h.f.outsiderAccount)).toMatchObject({
    status: 'not_found',
  });
  expect(await h.undo()).toMatchObject({ status: 'success' });
});
