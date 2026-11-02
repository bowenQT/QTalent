import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import {
  nativeDatabase,
  seedNativeCase,
} from '../../../../../tests/fixtures/bow-845/native';
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
import { refuseMaterialDispatch } from '../../../../server/queries/material-upload-runtime';
import { POST as createCollection } from './collections/route';
import { POST as requestUpload } from './route';
import { POST as completeUpload } from './complete/route';
import {
  POST as kodoPost,
  PUT as kodoPut,
} from '../../test/kodo/[...path]/route';

const h = vi.hoisted(() => ({
  db: undefined as unknown,
  account: null as string | null,
}));
vi.mock('../../../../server/db/client', async (original) => ({
  ...(await original<typeof import('../../../../server/db/client')>()),
  getDatabase: () => h.db,
}));
// No deployed Kodo: the routes fall back to the test-only v2 double.
vi.mock('../../../../server/queries/kodo-upload-storage', () => ({
  kodoUploadStorageFromEnv: () => null,
}));
vi.mock('../../../../server/auth', () => ({
  getSession: async () => (h.account ? { user: { id: h.account } } : null),
}));
vi.mock('../../../../server/env', () => ({
  getEnv: () => ({ APP_ENV: 'test', BETTER_AUTH_URL: 'https://app.test' }),
}));
vi.mock('../../../../server/access', () => ({
  verifyAccessRequest: async () => undefined,
}));

let connection: Awaited<ReturnType<typeof nativeDatabase>>;
let seeded: Awaited<ReturnType<typeof seedNativeCase>>;
const origin = 'https://app.test';

beforeAll(async () => {
  connection = await nativeDatabase();
  h.db = connection.db;
  seeded = await seedNativeCase(connection.db);
}, 60_000);
afterAll(async () => {
  await connection?.close();
});
beforeEach(() => {
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
async function stage(operationId: string = randomUUID()) {
  const response = await post(
    createCollection,
    '/api/record/uploads/collections',
    { operationId },
  );
  return {
    response,
    body: materialStagingCollectionResultSchema.parse(await response.json()),
  };
}
function materialRequest(
  recordCollectionId: string,
  file: { purpose: string; filename: string; mediaType: string; bytes: number },
  evaluationNodeId = seeded.node,
) {
  return {
    purpose: file.purpose,
    recordCollectionId,
    filename: file.filename,
    declaredBytes: file.bytes,
    declaredMediaType: file.mediaType,
    target: { kind: 'unassigned', evaluationNodeId },
    operationId: randomUUID(),
  };
}
/** The browser's v2 multipart upload (init, parts, complete) against the
 * test-only Kodo route, as the workbench client sends it. */
async function uploadV2(
  grant: { uploadEndpoint: string; uploadToken: string; objectKey: string },
  bytes: Uint8Array,
  mediaType: string,
) {
  const key = Buffer.from(grant.objectKey)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const base = `${grant.uploadEndpoint}/buckets/test-bucket/objects/${key}/uploads`;
  const send = (
    handler: typeof kodoPost,
    url: string,
    init: RequestInit = {},
  ) =>
    handler(
      new Request(url, {
        ...init,
        headers: {
          authorization: `UpToken ${grant.uploadToken}`,
          ...init.headers,
        },
      }),
      {
        params: Promise.resolve({
          path: url.slice(grant.uploadEndpoint.length + 1).split('/'),
        }),
      },
    );
  const init = await send(kodoPost, base, { method: 'POST' });
  expect(init.status).toBe(200);
  const { uploadId } = (await init.json()) as { uploadId: string };
  const half = Math.ceil(bytes.length / 2);
  const parts = [];
  for (const [index, chunk] of [
    bytes.slice(0, half),
    bytes.slice(half),
  ].entries()) {
    const put = await send(kodoPut, `${base}/${uploadId}/${index + 1}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: chunk,
    });
    expect(put.status).toBe(200);
    parts.push({
      partNumber: index + 1,
      etag: ((await put.json()) as { etag: string }).etag,
    });
  }
  const done = await send(kodoPost, `${base}/${uploadId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ parts, mimeType: mediaType }),
  });
  expect(done.status).toBe(200);
  expect(await done.json()).toMatchObject({ key: grant.objectKey });
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
  expect(result.upload).toMatchObject({
    method: 'resumable_v2',
    uploadEndpoint: `${origin}/api/test/kodo`,
  });
  await uploadV2(result.upload, new Uint8Array(file.bytes), file.mediaType);
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
  // The only node with a current relation the account may write.
  expect(staged.body.evaluationNodeId).toBe(seeded.node);
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
      status: 'staged',
      uploadId: delivered.grant.uploadId,
      recordCollectionId: collectionId,
      source: null,
    });
    expect(result).not.toHaveProperty('jobId');
    const validated = await readValidatedUpload(
      createPostgresUploadStore(connection.db, refuseMaterialDispatch),
      {
        uploadId: result.uploadId,
        originalVersionId: result.originalVersionId,
      },
    );
    expect(validated).toMatchObject({
      recordCollectionId: collectionId,
      target: { kind: 'unassigned', evaluationNodeId: seeded.node },
      accountId: seeded.account,
      jobId: null,
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

it('replays a staging collection and refuses a target node other than the collection’s', async () => {
  const operationId = randomUUID();
  const first = await stage(operationId);
  const again = await stage(operationId);
  expect(again.body).toEqual(first.body);
  if (first.body.status !== 'success') throw new Error(first.body.status);
  const elsewhere = await post(
    requestUpload,
    '/api/record/uploads',
    materialRequest(
      first.body.recordCollectionId,
      {
        purpose: 'attachment',
        filename: 'demo.txt',
        mediaType: 'text/plain',
        bytes: 12,
      },
      seeded.otherNode,
    ),
  );
  expect(elsewhere.status).toBe(403);
});

it('decides the session and node write permission on the server', async () => {
  h.account = null;
  expect((await stage()).response.status).toBe(401);
  // No current relation on any writable node: nothing to deliver into.
  h.account = seeded.outsiderAccount;
  const outsider = await stage();
  expect(outsider.response.status).toBe(409);
  expect(outsider.body).toMatchObject({ status: 'default_node_missing' });
  h.account = seeded.account;
  const crossSite = await post(
    createCollection,
    '/api/record/uploads/collections',
    { operationId: randomUUID() },
    'https://elsewhere.invalid',
  );
  expect(crossSite.status).toBe(403);
});

it('answers unsupported formats and sizes before issuing a grant, and grants up to the contract size', async () => {
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
  // Up to the 2 GiB contract a video gets a grant.
  const large = await post(
    requestUpload,
    '/api/record/uploads',
    materialRequest(id, {
      purpose: 'video',
      filename: 'demo.mp4',
      mediaType: 'video/mp4',
      bytes: 1.5 * 1024 ** 3,
    }),
  );
  expect(await large.json()).toMatchObject({ status: 'success' });
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
  const outsider = await post(requestUpload, '/api/record/uploads', request);
  expect(outsider.status).toBe(403);
  const outsiderBody = await outsider.json();
  // A missing collection and another account's record collection answer alike.
  const peopleCollection = randomUUID();
  await connection.db.insert(uploadCollections).values({
    id: peopleCollection,
    creatorAccountId: seeded.account,
    operationId: randomUUID(),
    target: { kind: 'people', personIds: [seeded.target] },
    targetFingerprint: 'a'.repeat(64),
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    revision: 1,
  });
  for (const recordCollectionId of [randomUUID(), peopleCollection]) {
    const refused = await post(requestUpload, '/api/record/uploads', {
      ...request,
      recordCollectionId,
      operationId: randomUUID(),
    });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({
      status: outsiderBody.status,
    });
  }
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
