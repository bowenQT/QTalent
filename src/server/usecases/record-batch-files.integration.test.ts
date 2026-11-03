import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { getDatabase } from '../db/client';
import { requireSession } from '../auth/next';
import { startRecordArrangeAction } from '../actions/record-arrange';
import { readRecordBatchAction } from '../actions/record-batch';
import {
  nativeDatabase,
  seedNativeRules,
  seedNativeCase,
} from '../../../tests/fixtures/bow-845/native';
import { attachmentParseMessageId } from '../jobs/attachment-parse';
import { jobSnapshots } from '../jobs/schema';
import { getAppJobProducer } from '../platform/jobs/app-runtime';
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
beforeAll(async () => {
  connection = await nativeDatabase();
  await seedNativeRules(connection.db);
}, 30000);
const send = vi.fn(async () => 'synthetic-queue-message');
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDatabase).mockImplementation(() => connection.db);
  vi.mocked(getAppJobProducer).mockResolvedValue({ send } as unknown as Awaited<
    ReturnType<typeof getAppJobProducer>
  >);
});
afterAll(async () => {
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
/** What the attachment worker commits when it finishes a file. */
async function finishParse(
  upload: Awaited<ReturnType<typeof unassignedUpload>>,
  outcome: 'parsed' | 'format' | 'cancelled' | 'input_changed',
) {
  const { jobId } = await parseJobOf(upload);
  await connection.db
    .update(jobSnapshots)
    .set({
      status: (
        {
          parsed: 'completed',
          format: 'failed',
          cancelled: 'cancelled',
          input_changed: 'failed',
        } as const
      )[outcome],
      revision: 2,
      ...(outcome === 'input_changed'
        ? { errorCode: 'input_changed' as const }
        : {}),
      ...(outcome === 'cancelled'
        ? { cancelRequestedAt: new Date().toISOString() }
        : {}),
      // A cancelled job keeps the stage it stopped in.
      result: {
        stage: {
          parsed: 'parsed',
          format: 'unsupported',
          cancelled: 'parsing',
          input_changed: 'parsing',
        }[outcome],
        mediaId: upload.file.uploadId,
        source: null,
        fragmentIds: [],
        ...(outcome === 'format' ? { failureReason: 'format' } : {}),
      },
    })
    .where(eq(jobSnapshots.jobId, jobId));
  if (outcome !== 'parsed') return null;
  const parseVersionId = randomUUID();
  await connection.db.insert(materialParses).values({
    id: parseVersionId,
    originalVersionId: upload.versionId,
    contentDigest: 'd'.repeat(64),
    parserVersion: 'demo-parser-1',
    projectionVersion: 'demo-projection-1',
    resultDigest: 'e'.repeat(64),
    jobId,
    attempt: 1,
  });
  return parseVersionId;
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
  // Sent for the job's current revision under that revision's message id.
  expect(send).toHaveBeenCalledWith(
    'attachment-parse',
    { jobId: notesJob.jobId, attempt: 1, revision: notesJob.revision },
    expect.objectContaining({
      retryLimit: 0,
      id: attachmentParseMessageId(notesJob.jobId, notesJob.revision),
    }),
  );
  expect(send).toHaveBeenCalledWith(
    'attachment-parse',
    { jobId: deckJob.jobId, attempt: 1, revision: deckJob.revision },
    expect.anything(),
  );

  const parseVersionId = await finishParse(notes, 'parsed');
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
      status: 'parsed',
      parseVersionId,
    },
    expect.objectContaining({
      materialId: deck.originalId,
      status: 'unsupported',
      reason: 'format',
    }),
  ]);
  expect(read.result.counts.files).toMatchObject({
    total: 2,
    parsed: 1,
    unsupported: 1,
    processing: 0,
  });
  // Every file has settled, so the batch has stopped and nothing polls it.
  expect(read.result).toMatchObject({ status: 'completed', jobId: null });

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
      status: 'completed',
      jobId: null,
      files: [{ status: 'failed', code: 'processing_failed' }],
    },
  });
});

it('shows a file withdrawn before its parse as not retryable, without saying why', async () => {
  const f = await seedNativeCase(connection.db);
  const notes = await unassignedUpload(connection.db, f, '演示周记.txt');
  signIn(f.account);
  const created = await startRecordArrangeAction(filesOnly([notes.file]));
  expect(created.status).toBe('success');
  if (created.status !== 'success') return;
  await finishParse(notes, 'input_changed');
  const read = await readRecordBatchAction({ batchId: created.result.batchId });
  expect(read).toMatchObject({
    status: 'success',
    result: {
      status: 'completed',
      files: [
        {
          status: 'failed',
          code: 'processing_failed',
          message: '文件已移除或当前无权处理，不能再解析',
          retryable: false,
        },
      ],
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
