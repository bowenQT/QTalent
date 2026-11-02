import { createHash } from 'node:crypto';
import { createFakeKodo, KodoError } from '../../src/server/integrations/kodo';
import type { UploadRequest } from '../../src/contracts/media';
import type {
  ReadTicket,
  UploadedObject,
  UploadIntent,
  UploadPolicy,
  UploadStorage,
  UploadStore,
  UploadTransaction,
  UploadCollection,
} from '../../src/server/modules/records/uploads/types';

/** Synthetic protocol around the merged immutable Kodo fake; no signing key. */
export function fixture(recordCollectionId = 'trusted-record-collection-1') {
  let now = Date.parse('2026-10-25T16:00:00Z');
  let allowed = true;
  let dispatchFails = false;
  const fake = createFakeKodo();
  const mime = new Map<string, string>();
  let intents: UploadIntent[] = [];
  let collections: UploadCollection[] = [];
  let objects: UploadedObject[] = [];
  let tickets: ReadTicket[] = [];
  let jobs: string[] = [];
  let tail: Promise<unknown> = Promise.resolve();
  const storage: UploadStorage = {
    issueUploadGrant(input) {
      return {
        token: 'synthetic-upload-token',
        uploadEndpoint: 'https://upload.invalid',
        objectKey: input.objectKey,
        expiresAt: input.expiresAt,
        multipartVersion: 2,
      };
    },
    async statObject({ objectKey }) {
      try {
        const bytes = await fake.read(objectKey);
        return {
          key: objectKey,
          byteLength: bytes.length,
          mediaType: mime.get(objectKey)!,
          etag: createHash('sha256').update(bytes).digest('hex'),
        };
      } catch {
        throw new KodoError('not_found');
      }
    },
    async openObject({ objectKey, range }) {
      const bytes = await fake.read(objectKey);
      if (range && range.start >= bytes.length)
        throw new KodoError('invalid_range');
      const end = Math.min(range?.end ?? bytes.length - 1, bytes.length - 1);
      const start = range?.start ?? 0;
      const selected = bytes.slice(start, end + 1);
      return {
        status: range ? (206 as const) : (200 as const),
        headers: {
          'content-length': String(selected.length),
          'content-type': mime.get(objectKey)!,
          ...(range
            ? { 'content-range': `bytes ${start}-${end}/${bytes.length}` }
            : {}),
        },
        body: new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(selected);
            c.close();
          },
        }),
        close() {},
      };
    },
  };
  const tx: UploadTransaction = {
    async findCollection(id) {
      return collections.find((c) => c.id === id) ?? null;
    },
    async findCollectionOperation(accountId, operationId) {
      return (
        collections.find(
          (c) =>
            c.creatorAccountId === accountId && c.operationId === operationId,
        ) ?? null
      );
    },
    async insertCollection(collection) {
      collections.push(structuredClone(collection));
    },
    async findOperation(account, operation) {
      return (
        intents.find(
          (i) => i.accountId === account && i.operationId === operation,
        ) ?? null
      );
    },
    async findIntent(id) {
      return intents.find((i) => i.id === id) ?? null;
    },
    async activeCount(scope, instant) {
      return intents.filter(
        (i) =>
          i.quotaScope === scope &&
          i.releasedAt === null &&
          (i.completed !== null || i.expiresAt > instant),
      ).length;
    },
    async insertIntent(intent) {
      intents.push(structuredClone(intent));
    },
    async archiveAndDispatch(intent, object, ids) {
      if (dispatchFails) throw new Error('synthetic enqueue failure');
      objects.push({
        ...object,
        originalVersionId: ids.originalVersionId,
        uploadId: intent.id,
      });
      const id = `job-${jobs.length + 1}`;
      jobs.push(id);
      return id;
    },
    async saveCompletion(intent) {
      intents = intents.map((i) =>
        i.id === intent.id ? structuredClone(intent) : i,
      );
    },
    async saveRelease(intent) {
      intents = intents.map((i) =>
        i.id === intent.id ? structuredClone(intent) : i,
      );
    },
    async findObject(version) {
      return objects.find((o) => o.originalVersionId === version) ?? null;
    },
    async insertTicket(ticket) {
      tickets.push(structuredClone(ticket));
    },
    async findTicket(digest) {
      return tickets.find((t) => t.digest === digest) ?? null;
    },
  };
  const store: UploadStore = {
    transaction(_locks, work) {
      const result = tail.then(async () => {
        const before = structuredClone({
          intents,
          objects,
          tickets,
          jobs,
          collections,
        });
        try {
          return await work(tx);
        } catch (error) {
          ({ intents, objects, tickets, jobs, collections } = before);
          throw error;
        }
      });
      tail = result.catch(() => {});
      return result;
    },
  };
  const policy: UploadPolicy = {
    async resolveWriteTarget(_accountId, input) {
      return allowed && input.recordCollectionId === recordCollectionId
        ? {
            recordCollectionId,
            quotaScope: recordCollectionId,
            externalAttachmentCount: 0,
          }
        : null;
    },
    async canReadOriginal() {
      return allowed;
    },
  };
  const request: UploadRequest = {
    recordCollectionId,
    purpose: 'attachment',
    filename: 'demo.txt',
    declaredBytes: 7,
    declaredMediaType: 'text/plain',
    target: { kind: 'people', personIds: ['demo-person-1'] },
    operationId: 'request-1',
  };
  return {
    options: { store, storage, policy, now: () => now },
    request,
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
    deny() {
      allowed = false;
    },
    allow() {
      allowed = true;
    },
    failDispatch(value: boolean) {
      dispatchFails = value;
    },
    async put(
      key: string,
      bytes = new TextEncoder().encode('演示x'),
      mediaType = 'text/plain',
    ) {
      await fake.write({ key, bytes });
      mime.set(key, mediaType);
    },
    snapshot() {
      return structuredClone({ intents, objects, tickets, jobs, collections });
    },
  };
}
