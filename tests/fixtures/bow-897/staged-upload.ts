import { createHash, randomUUID } from 'node:crypto';
import type { Database } from '../../../src/server/db/client';
import {
  originals,
  originalVersions,
} from '../../../src/server/modules/records/schema';
import {
  uploadCollections,
  uploadIntents,
  uploadObjects,
} from '../../../src/server/modules/records/uploads/schema';

/** A completed upload staged on a node with no parse job, as BOW-873 completion
 * of an unassigned upload leaves it. */
export async function unassignedUpload(
  db: Database,
  f: { account: string; node: string },
  filename: string,
  evaluationNodeId = f.node,
) {
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
    target,
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
