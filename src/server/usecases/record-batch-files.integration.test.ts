import { randomUUID } from 'node:crypto';
import { PgBoss, fromDrizzle } from 'pg-boss';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { getDatabase } from '../db/client';
import { requireSession } from '../auth/next';
import { startRecordArrangeAction } from '../actions/record-arrange';
import { readRecordBatchAction } from '../actions/record-batch';
import {
  nativeDatabase,
  seedNativeRules,
  seedNativeCase,
  businessAt,
} from '../../../tests/fixtures/bow-845/native';
import { jobSnapshots } from '../jobs/schema';
import { getAppJobProducer } from '../platform/jobs/app-runtime';
import { createAttachmentParseWorker } from './attachment-parse-worker';
import { createParsedAttachmentBatchRequests } from './parsed-attachment-batch';
import { parsedAttachmentArrangeKind } from './parsed-attachment-state';
import { uploadIntents } from '../modules/records/uploads/schema';
import { materialParses } from '../modules/records/schema';
import { unassignedUpload } from '../../../tests/fixtures/bow-897/staged-upload';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../auth/next', () => ({ requireSession: vi.fn() }));
vi.mock('../db/client', async (original) => ({
  ...(await original<typeof import('../db/client')>()),
  getDatabase: vi.fn(),
}));
vi.mock('../env', () => ({ getEnv: () => ({ APP_ENV: 'test' }) }));
vi.mock('../platform/jobs/app-runtime', () => ({
  getAppJobProducer: vi.fn(),
}));

let connection: Awaited<ReturnType<typeof nativeDatabase>>;
let boss: PgBoss;
let send: MockInstance<PgBoss['send']>;
beforeAll(async () => {
  connection = await nativeDatabase();
  await seedNativeRules(connection.db);
  boss = new PgBoss({ connectionString: connection.testUrl });
  await boss.start();
  await boss.createQueue('attachment-parse', { retryLimit: 0 });
  await boss.createQueue('parsed-attachment-arrange', { retryLimit: 0 });
  send = vi.spyOn(boss, 'send');
}, 30000);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDatabase).mockImplementation(() => connection.db);
  vi.mocked(getAppJobProducer).mockResolvedValue(boss);
});
afterAll(async () => {
  await boss?.stop();
  await connection?.close();
});

/** The media job the batch created for this upload version. */
async function parseJobOf(
  upload: Awaited<ReturnType<typeof unassignedUpload>>,
) {
  const rows = await connection.db
    .select()
    .from(jobSnapshots)
    .where(
      and(
        eq(jobSnapshots.kind, 'media'),
        eq(jobSnapshots.resourceId, upload.file.uploadId),
        eq(jobSnapshots.inputVersion, upload.versionId),
      ),
    );
  expect(rows).toHaveLength(1);
  return rows[0]!;
}
/** Parsed uses the real canonical worker and lifecycle handoff. The other
 * branches exercise terminal parse receipt projection without fabricating text. */
async function finishParse(
  upload: Awaited<ReturnType<typeof unassignedUpload>>,
  outcome: 'parsed' | 'format' | 'cancelled',
) {
  const { jobId } = await parseJobOf(upload);
  if (outcome === 'parsed') {
    const [intent] = await connection.db
      .select()
      .from(uploadIntents)
      .where(eq(uploadIntents.id, upload.file.uploadId));
    const bytes = Buffer.from('演示材料：' + intent!.request.filename);
    const requests = createParsedAttachmentBatchRequests({
      db: connection.db,
      businessNow: () => businessAt,
      now: () => new Date(),
      enqueue: async (tx, job) => {
        await boss.send(
          'parsed-attachment-arrange',
          { jobId: job.jobId, attempt: job.attempt },
          { db: fromDrizzle(tx, sql), retryLimit: 0 },
        );
      },
    });
    const parser = createAttachmentParseWorker({
      db: connection.db,
      boss,
      demo: true,
      businessNow: () => businessAt,
      now: () => new Date(),
      afterParse: requests.refreshForParseJob,
      storage: {
        async openObject() {
          return {
            status: 200 as const,
            headers: {
              'content-length': String(bytes.length),
              'content-type': 'text/plain',
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
    await parser.run({ jobId, attempt: 1 });
    const rows = await connection.db
      .select()
      .from(materialParses)
      .where(eq(materialParses.jobId, jobId));
    expect(rows).toHaveLength(1);
    expect(
      await connection.db
        .select()
        .from(jobSnapshots)
        .where(eq(jobSnapshots.kind, parsedAttachmentArrangeKind)),
    ).toHaveLength(0);
    return rows[0]!.id;
  }
  await connection.db
    .update(jobSnapshots)
    .set({
      status: (
        {
          parsed: 'completed',
          format: 'failed',
          cancelled: 'cancelled',
        } as const
      )[outcome],
      revision: 2,
      ...(outcome === 'cancelled'
        ? { cancelRequestedAt: new Date().toISOString() }
        : {}),
      // A cancelled job keeps the stage it stopped in.
      result: {
        stage: {
          parsed: 'parsed',
          format: 'unsupported',
          cancelled: 'parsing',
        }[outcome],
        mediaId: upload.file.uploadId,
        source: null,
        fragmentIds: [],
        ...(outcome === 'format' ? { failureReason: 'format' } : {}),
      },
    })
    .where(eq(jobSnapshots.jobId, jobId));
  return null;
}
function signIn(account: string) {
  vi.mocked(requireSession).mockResolvedValue({
    user: { id: account },
  } as Awaited<ReturnType<typeof requireSession>>);
}
const filesOnly = (files: { clientFileId: string; uploadId: string }[]) => ({
  operationId: randomUUID(),
  personIds: [],
  projectId: null,
  text: '',
  files,
});

it('takes staged files on their upload node, hands each parse to the worker, and shows each file as it finishes', async () => {
  const f = await seedNativeCase(connection.db);
  const notes = await unassignedUpload(connection.db, f, '演示周记.txt');
  const deck = await unassignedUpload(connection.db, f, '演示汇报.key');
  signIn(f.account);
  const created = await startRecordArrangeAction(
    filesOnly([notes.file, deck.file]),
  );
  expect(created.status).toBe('success');
  if (created.status !== 'success') return;
  const receipt = created.result;
  expect(receipt.evaluationNodeId).toBe(f.node);
  expect(receipt.textMaterial).toBeNull();
  const notesJob = await parseJobOf(notes);
  const deckJob = await parseJobOf(deck);
  expect(notesJob).toMatchObject({ status: 'queued', attempt: 1 });
  expect(receipt.files.map((file) => [file.filename, file.status])).toEqual([
    ['演示周记.txt', 'processing'],
    ['演示汇报.key', 'processing'],
  ]);
  expect(receipt.files[0]).toMatchObject({ jobId: notesJob.jobId });
  expect(receipt.status).toBe('processing');
  // Only the file parses run; no arrangement job is reported as active.
  expect(receipt.jobId).toBeNull();
  // Each file's parse goes to the attachment worker's queue in the batch's transaction.
  expect(getAppJobProducer).toHaveBeenCalledWith('attachment-parse');
  expect(send).toHaveBeenCalledWith(
    'attachment-parse',
    { jobId: notesJob.jobId, attempt: 1 },
    expect.objectContaining({ retryLimit: 0 }),
  );
  expect(send).toHaveBeenCalledWith(
    'attachment-parse',
    { jobId: deckJob.jobId, attempt: 1 },
    expect.anything(),
  );

  await finishParse(notes, 'parsed');
  await finishParse(deck, 'format');
  const read = await readRecordBatchAction({ batchId: receipt.batchId });
  expect(read.status).toBe('success');
  if (read.status !== 'success') return;
  expect(read.result.files).toEqual([
    {
      materialId: notes.originalId,
      clientFileId: notes.file.clientFileId,
      filename: '演示周记.txt',
      originalVersionId: notes.versionId,
      status: 'needs_review',
      reviewItemIds: [expect.any(String)],
    },
    expect.objectContaining({
      materialId: deck.originalId,
      status: 'unsupported',
      reason: 'format',
    }),
  ]);
  expect(read.result.counts.files).toMatchObject({
    total: 2,
    parsed: 0,
    needs_review: 1,
    unsupported: 1,
    processing: 0,
  });
  // Parsing settled, but unknown scope remains a real review item and never queues a model.
  expect(read.result).toMatchObject({ status: 'needs_review', jobId: null });

  // The same upload cannot go into a second current batch.
  expect(await startRecordArrangeAction(filesOnly([notes.file]))).toMatchObject(
    {
      status: 'validation_error',
      fieldErrors: { files: [expect.any(String)] },
    },
  );
});

it('shows a cancelled parse as stopped, not as still parsing', async () => {
  const f = await seedNativeCase(connection.db);
  const notes = await unassignedUpload(connection.db, f, '演示周记.txt');
  signIn(f.account);
  const created = await startRecordArrangeAction(filesOnly([notes.file]));
  expect(created.status).toBe('success');
  if (created.status !== 'success') return;
  await finishParse(notes, 'cancelled');
  const read = await readRecordBatchAction({ batchId: created.result.batchId });
  expect(read).toMatchObject({
    status: 'success',
    result: {
      status: 'failed',
      jobId: null,
      files: [{ status: 'failed', code: 'processing_failed' }],
    },
  });
});

it('refuses another account’s upload, files of two nodes, a node other than the upload’s, and text with no node', async () => {
  const f = await seedNativeCase(connection.db);
  const upload = await unassignedUpload(connection.db, f, '演示周记.txt');
  const elsewhere = await unassignedUpload(
    connection.db,
    f,
    '演示汇报.txt',
    'demo-other-node',
  );
  signIn(f.outsiderAccount);
  // Someone else's upload answers exactly as an upload that does not exist.
  const answer = async (file: { clientFileId: string; uploadId: string }) => {
    const result = await startRecordArrangeAction(filesOnly([file]));
    return 'fieldErrors' in result
      ? { status: result.status, fieldErrors: result.fieldErrors }
      : result;
  };
  expect(await answer(upload.file)).toEqual(
    await answer({ clientFileId: randomUUID(), uploadId: randomUUID() }),
  );
  expect(
    await startRecordArrangeAction(filesOnly([upload.file])),
  ).toMatchObject({
    status: 'validation_error',
    fieldErrors: { files: [expect.any(String)] },
  });
  signIn(f.account);
  expect(
    await startRecordArrangeAction(filesOnly([upload.file, elsewhere.file])),
  ).toMatchObject({
    status: 'validation_error',
    fieldErrors: { files: [expect.stringContaining('不同的评价节点')] },
  });
  expect(
    await startRecordArrangeAction({
      ...filesOnly([upload.file]),
      evaluationNodeId: 'demo-other-node',
    }),
  ).toMatchObject({
    status: 'validation_error',
    fieldErrors: { evaluationNodeId: [expect.any(String)] },
  });
  expect(
    await startRecordArrangeAction({
      ...filesOnly([]),
      text: '演示文字',
    }),
  ).toMatchObject({
    status: 'validation_error',
    fieldErrors: { evaluationNodeId: [expect.any(String)] },
  });
  // Nothing was written for any refused delivery.
  expect(
    await connection.db
      .select()
      .from(jobSnapshots)
      .where(
        inArray(jobSnapshots.resourceId, [
          upload.file.uploadId,
          elsewhere.file.uploadId,
        ]),
      ),
  ).toHaveLength(0);
  expect(send).not.toHaveBeenCalled();
});
