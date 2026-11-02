import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import {
  nativeDatabase,
  seedNativeCase,
} from '../../../../../tests/fixtures/bow-845/native';
import { fixture } from '../../../../../tests/fixtures/upload-fake';
import {
  materialRequestUploadResultSchema,
  completeUploadResultSchema,
} from '../../../../contracts/media';
import { materialStagingCollectionResultSchema } from '../../../../contracts/material-uploads';
import {
  createPostgresUploadStore,
  readValidatedUpload,
} from '../../../../server/modules/records';
import {
  uploadCollections,
  uploadIntents,
  uploadObjects,
} from '../../../../server/modules/records/uploads/schema';
import { stageMaterialUpload } from '../../../../server/queries/material-upload-runtime';
import { POST as createCollection } from './collections/route';
import { POST as requestUpload } from './route';
import { POST as completeUpload } from './complete/route';

const h = vi.hoisted(() => ({
  db: undefined as unknown,
  storage: undefined as unknown,
  account: null as string | null,
}));
vi.mock('../../../../server/db/client', async (original) => ({
  ...(await original<typeof import('../../../../server/db/client')>()),
  getDatabase: () => h.db,
}));
vi.mock('../../../../server/queries/kodo-upload-storage', () => ({
  kodoUploadStorageFromEnv: () => h.storage,
}));
vi.mock('../../../../server/auth', () => ({
  getSession: async () => (h.account ? { user: { id: h.account } } : null),
}));
vi.mock('../../../../server/access', () => ({
  verifyAccessRequest: async () => undefined,
}));

let connection: Awaited<ReturnType<typeof nativeDatabase>>;
let seeded: Awaited<ReturnType<typeof seedNativeCase>>;
let kodo: ReturnType<typeof fixture>;
const origin = new URL(process.env.BETTER_AUTH_URL ?? 'http://invalid').origin;

beforeAll(async () => {
  connection = await nativeDatabase();
  h.db = connection.db;
  seeded = await seedNativeCase(connection.db);
}, 60_000);
afterAll(async () => {
  await connection?.close();
});
beforeEach(() => {
  kodo = fixture();
  h.storage = kodo.options.storage;
  h.account = seeded.account;
});

function post(
  handler: (request: Request) => Promise<Response>,
  path: string,
  body: unknown,
  from = origin,
) {
  return handler(
    new Request(`${origin}${path}`, {
      method: 'POST',
      headers: { origin: from, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}
async function stage(node = seeded.node) {
  const response = await post(
    createCollection,
    '/api/record/uploads/collections',
    {
      operationId: randomUUID(),
      evaluationNodeId: node,
    },
  );
  return {
    response,
    body: materialStagingCollectionResultSchema.parse(await response.json()),
  };
}
function materialRequest(
  recordCollectionId: string,
  file: { purpose: string; filename: string; mediaType: string; bytes: number },
) {
  return {
    purpose: file.purpose,
    recordCollectionId,
    filename: file.filename,
    declaredBytes: file.bytes,
    declaredMediaType: file.mediaType,
    target: { kind: 'unassigned', evaluationNodeId: seeded.node },
    operationId: randomUUID(),
  };
}
async function deliver(
  recordCollectionId: string,
  file: {
    purpose: string;
    filename: string;
    mediaType: string;
    bytes: Uint8Array;
  },
) {
  const granted = await post(
    requestUpload,
    '/api/record/uploads',
    materialRequest(recordCollectionId, { ...file, bytes: file.bytes.length }),
  );
  const result = materialRequestUploadResultSchema.parse(await granted.json());
  if (result.status !== 'success') throw new Error(result.status);
  // The browser's direct upload, replaced by the synthetic Kodo double.
  await kodo.put(
    result.upload.objectKey,
    new Uint8Array(file.bytes),
    file.mediaType,
  );
  const completed = await post(completeUpload, '/api/record/uploads/complete', {
    uploadId: result.upload.uploadId,
    receiptRef: 'synthetic-receipt',
    operationId: randomUUID(),
    expectedRevision: result.upload.revision,
  });
  return {
    grant: result.upload,
    response: completed,
    body: completeUploadResultSchema.parse(await completed.json()),
  };
}

it('takes a material from grant through direct upload to a verified original', async () => {
  const staged = await stage();
  expect(staged.response.status).toBe(200);
  if (staged.body.status !== 'success') throw new Error(staged.body.status);
  const collectionId = staged.body.recordCollectionId;
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: '#c00' },
  })
    .png()
    .toBuffer();
  const text = new TextEncoder().encode('演示面谈材料：补齐回滚步骤。');
  const image = await deliver(collectionId, {
    purpose: 'image',
    filename: 'demo-whiteboard.png',
    mediaType: 'image/png',
    bytes: png,
  });
  const note = await deliver(collectionId, {
    purpose: 'attachment',
    filename: 'demo-note.txt',
    mediaType: 'text/plain',
    bytes: text,
  });
  for (const delivered of [image, note]) {
    expect(delivered.response.status).toBe(200);
    if (delivered.body.status !== 'success')
      throw new Error(delivered.body.status);
    const result = delivered.body.result;
    expect(result).toMatchObject({
      uploadId: delivered.grant.uploadId,
      recordCollectionId: collectionId,
      jobId: `staged:${delivered.grant.uploadId}`,
      source: null,
    });
    const validated = await readValidatedUpload(
      createPostgresUploadStore(connection.db, stageMaterialUpload),
      {
        uploadId: result.uploadId,
        originalVersionId: result.originalVersionId,
      },
    );
    expect(validated).toMatchObject({
      recordCollectionId: collectionId,
      target: { kind: 'unassigned', evaluationNodeId: seeded.node },
      accountId: seeded.account,
    });
  }
  const [collection] = await connection.db
    .select()
    .from(uploadCollections)
    .where(eq(uploadCollections.id, collectionId));
  expect(collection).toMatchObject({
    creatorAccountId: seeded.account,
    target: { kind: 'unassigned', evaluationNodeId: seeded.node },
  });
  const objects = await connection.db
    .select()
    .from(uploadObjects)
    .where(eq(uploadObjects.uploadId, image.grant.uploadId));
  expect(objects).toEqual([
    expect.objectContaining({ byteLength: png.length, mediaType: 'image/png' }),
  ]);
});

it('replays a staging collection for the same operation and rejects another node payload', async () => {
  const operationId = randomUUID();
  const body = { operationId, evaluationNodeId: seeded.node };
  const first = await (
    await post(createCollection, '/api/record/uploads/collections', body)
  ).json();
  const again = await (
    await post(createCollection, '/api/record/uploads/collections', body)
  ).json();
  expect(again).toEqual(first);
  const changed = await post(
    createCollection,
    '/api/record/uploads/collections',
    {
      operationId,
      evaluationNodeId: seeded.otherNode,
    },
  );
  expect(changed.status).toBe(409);
});

it('decides the session and node write permission on the server', async () => {
  h.account = null;
  expect((await stage()).response.status).toBe(401);
  h.account = seeded.outsiderAccount;
  expect((await stage()).response.status).toBe(403);
  h.account = seeded.account;
  // The account writes records only for subjects of the main node.
  expect((await stage(seeded.otherNode)).response.status).toBe(403);
  const crossSite = await post(
    createCollection,
    '/api/record/uploads/collections',
    { operationId: randomUUID(), evaluationNodeId: seeded.node },
    'https://elsewhere.invalid',
  );
  expect(crossSite.status).toBe(403);
});

it('answers unsupported formats and sizes before issuing a grant', async () => {
  const staged = await stage();
  if (staged.body.status !== 'success') throw new Error(staged.body.status);
  const id = staged.body.recordCollectionId;
  const gif = await post(
    requestUpload,
    '/api/record/uploads',
    materialRequest(id, {
      purpose: 'image',
      filename: 'demo.gif',
      mediaType: 'image/gif',
      bytes: 10,
    }),
  );
  expect(await gif.json()).toMatchObject({
    status: 'unsupported',
    reason: 'format',
  });
  const huge = await post(
    requestUpload,
    '/api/record/uploads',
    materialRequest(id, {
      purpose: 'video',
      filename: 'demo.mp4',
      mediaType: 'video/mp4',
      bytes: 3 * 1024 ** 3,
    }),
  );
  expect(await huge.json()).toMatchObject({
    status: 'unsupported',
    reason: 'size',
  });
  const intents = await connection.db
    .select()
    .from(uploadIntents)
    .where(eq(uploadIntents.recordCollectionId, id));
  expect(intents).toEqual([]);
});

it('refuses another account’s staging collection and an unfinished upload', async () => {
  const staged = await stage();
  if (staged.body.status !== 'success') throw new Error(staged.body.status);
  const request = materialRequest(staged.body.recordCollectionId, {
    purpose: 'attachment',
    filename: 'demo.txt',
    mediaType: 'text/plain',
    bytes: 12,
  });
  h.account = seeded.outsiderAccount;
  expect(
    (await post(requestUpload, '/api/record/uploads', request)).status,
  ).toBe(403);
  h.account = seeded.account;
  const granted = materialRequestUploadResultSchema.parse(
    await (await post(requestUpload, '/api/record/uploads', request)).json(),
  );
  if (granted.status !== 'success') throw new Error(granted.status);
  const early = await post(completeUpload, '/api/record/uploads/complete', {
    uploadId: granted.upload.uploadId,
    receiptRef: 'synthetic-receipt',
    operationId: randomUUID(),
    expectedRevision: granted.upload.revision,
  });
  expect(early.status).toBe(400);
  expect(await early.json()).toMatchObject({
    fieldErrors: { form: ['尚未找到完整上传的文件，请完成上传后再重试'] },
  });
});
