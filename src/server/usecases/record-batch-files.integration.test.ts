import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
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
import { jobSnapshots } from '../jobs/schema';
import { getAppJobProducer } from '../platform/jobs/app-runtime';
import {
  materialParses,
  originals,
  originalVersions,
} from '../modules/records/schema';
import {
  uploadCollections,
  uploadIntents,
  uploadObjects,
} from '../modules/records/uploads/schema';

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
  // Stand-in for the BOW-873 unassigned upload migration (be-sources) on this
  // isolated database only; remove once that migration is on main.
  await connection.db.execute(sql`
    alter table records_upload_collections
      drop constraint records_upload_collection_target,
      add constraint records_upload_collection_target check (coalesce(
        jsonb_typeof(target) = 'object'
          and target->>'kind' in ('people','event','unassigned'),
        false))`);
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

/** A completed upload staged on a node with no parse job, as BOW-873 completion
 * of an unassigned upload leaves it. */
async function unassignedUpload(
  f: Awaited<ReturnType<typeof seedNativeCase>>,
  filename: string,
  evaluationNodeId = f.node,
) {
  const db = connection.db;
  const bytes = Buffer.from('演示材料：' + filename);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const originalId = randomUUID(),
    versionId = randomUUID(),
    collectionId = randomUUID(),
    uploadId = randomUUID();
  const target = { kind: 'unassigned' as const, evaluationNodeId };
  const request = {
    recordCollectionId: collectionId,
    purpose: 'attachment' as const,
    filename,
    declaredBytes: bytes.length,
    declaredMediaType: 'text/plain',
    target,
    operationId: randomUUID(),
  };
  await db
    .insert(originals)
    .values({ id: originalId, title: '演示原件', kind: 'original' });
  await db.insert(originalVersions).values({
    id: versionId,
    originalId,
    version: 1,
    contentDigest: digest,
  });
  await db.insert(uploadCollections).values({
    id: collectionId,
    creatorAccountId: f.account,
    operationId: randomUUID(),
    target: target as unknown as typeof uploadCollections.$inferInsert.target,
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
    // BOW-873 material request: the upload module's own type has no unassigned target yet.
    request: request as unknown as typeof uploadIntents.$inferInsert.request,
    declaredBytes: bytes.length,
    objectKey: originalId,
    expiresAt: 200,
    revision: 1,
    completionOperationId: randomUUID(),
    completionFingerprint: 'f'.repeat(64),
    completed: {
      uploadId,
      recordCollectionId: collectionId,
      originalId,
      originalVersionId: versionId,
      status: 'staged',
      revision: 1,
      source: null,
    } as unknown as typeof uploadIntents.$inferInsert.completed,
  });
  await db.insert(uploadObjects).values({
    originalVersionId: versionId,
    uploadId,
    objectKey: originalId,
    byteLength: bytes.length,
    mediaType: 'text/plain',
    sha256: digest,
    etag: 'synthetic',
  });
  return {
    file: { clientFileId: randomUUID(), uploadId },
    originalId,
    versionId,
  };
}
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
  outcome: 'parsed' | 'format',
) {
  const { jobId } = await parseJobOf(upload);
  await connection.db
    .update(jobSnapshots)
    .set({
      status: outcome === 'parsed' ? 'completed' : 'failed',
      revision: 2,
      result: {
        stage: outcome === 'parsed' ? 'parsed' : 'unsupported',
        mediaId: upload.originalId,
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
  const notes = await unassignedUpload(f, '演示周记.txt');
  const deck = await unassignedUpload(f, '演示汇报.key');
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

  // The same upload cannot go into a second current batch.
  expect(await startRecordArrangeAction(filesOnly([notes.file]))).toMatchObject(
    {
      status: 'validation_error',
      fieldErrors: { files: [expect.any(String)] },
    },
  );
});

it('refuses another account’s upload, files of two nodes, a node other than the upload’s, and text with no node', async () => {
  const f = await seedNativeCase(connection.db);
  const upload = await unassignedUpload(f, '演示周记.txt');
  const elsewhere = await unassignedUpload(
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
