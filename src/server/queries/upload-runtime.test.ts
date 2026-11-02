import { afterEach, expect, it, vi } from 'vitest';
import { createDatabase } from '../db/client';
import { fixture } from '../../../tests/fixtures/upload-fake';
import {
  createUploadRuntime,
  createNodeAuthorizedUploadRuntime,
} from './upload-runtime';
import { jobAccount } from '../jobs/request';
import { recordAudit } from '../platform/audit';
vi.mock('../jobs/request', () => ({ jobAccount: vi.fn() }));
vi.mock('../platform/audit', () => ({ recordAudit: vi.fn() }));
const connections: ReturnType<typeof createDatabase>[] = [];
afterEach(async () => {
  await Promise.all(connections.splice(0).map((c) => c.pool.end()));
  vi.clearAllMocks();
});
function setup() {
  // Construction is lazy; this unreachable loopback endpoint must never be used
  // by unauthenticated or invalid requests.
  const connection = createDatabase(
    'postgresql://synthetic:unused@127.0.0.1:1/unused_test',
  );
  connections.push(connection);
  const f = fixture();
  const dispatch = vi.fn(async () => ({ jobId: 'unused' }));
  const transaction = vi.spyOn(connection.db, 'transaction');
  const runtime = createUploadRuntime({
    db: connection.db,
    storage: f.options.storage,
    collectionPolicy: {
      async canWriteTarget() {
        return true;
      },
      async loadBinding() {
        return { state: 'draft', externalAttachmentCount: 0 };
      },
      async collectionForEvent() {
        return null;
      },
    },
    canReadOriginal: f.options.policy.canReadOriginal,
    dispatch,
    trustedOrigin: 'https://app.invalid',
    securityNow: f.options.now,
  });
  return { f, runtime, transaction, dispatch, db: connection.db };
}
it('constructs lazily and authenticates through the shared Access/session boundary before any database work', async () => {
  const { runtime, transaction, dispatch } = setup();
  expect(jobAccount).not.toHaveBeenCalled();
  expect(transaction).not.toHaveBeenCalled();
  vi.mocked(jobAccount).mockResolvedValue(null);
  const response = await runtime.http.requestUpload(
    new Request('https://app.invalid/uploads', {
      method: 'POST',
      headers: {
        origin: 'https://app.invalid',
        'content-type': 'application/json',
      },
      body: '{}',
    }),
  );
  expect(response.status).toBe(401);
  expect(jobAccount).toHaveBeenCalledOnce();
  expect(transaction).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
  expect(recordAudit).not.toHaveBeenCalled();
});
it('uses the shared audit writer with an opaque ticket digest and fails closed on audit failure', async () => {
  const { runtime, db } = setup();
  vi.mocked(jobAccount).mockResolvedValue('account');
  vi.spyOn(runtime.reader, 'open').mockResolvedValue(
    new Response('synthetic bytes'),
  );
  vi.mocked(recordAudit).mockResolvedValue(undefined);
  const token = 'a'.repeat(43);
  const response = await runtime.http.readOriginal(
    new Request(`https://app.invalid/uploads/original?ticket=${token}`),
  );
  expect(response.status).toBe(200);
  const [executor, entry] = vi.mocked(recordAudit).mock.calls[0];
  expect(executor).toBe(db);
  expect(entry).toMatchObject({
    actorId: 'account',
    action: 'records.original.read',
  });
  expect(entry.resourceId).toMatch(/^upload-ticket:[a-f0-9]{64}$/);
  expect(entry.resourceId).not.toContain(token);
  vi.mocked(recordAudit).mockRejectedValue(
    new Error('synthetic audit unavailable'),
  );
  vi.mocked(runtime.reader.open).mockResolvedValue(
    new Response('must not escape'),
  );
  const denied = await runtime.http.readOriginal(
    new Request(`https://app.invalid/uploads/original?ticket=${token}`),
  );
  expect(denied.status).toBe(503);
  expect(await denied.text()).not.toContain('must not escape');
});

it('constructs the explicit node-aware runtime lazily and never loads scope or storage for anonymous HTTP requests', async () => {
  const connection = createDatabase(
    'postgresql://synthetic:unused@127.0.0.1:1/unused_test',
  );
  connections.push(connection);
  const transaction = vi.spyOn(connection.db, 'transaction');
  const f = fixture();
  const loadWrite = vi.fn(async () => null);
  const loadRead = vi.fn(async () => null);
  const dispatch = vi.fn(async () => ({ jobId: 'unused' }));
  const runtime = createNodeAuthorizedUploadRuntime({
    db: connection.db,
    storage: f.options.storage,
    dispatch,
    trustedOrigin: 'https://app.invalid',
    securityNow: f.options.now,
    collectionPolicy: {
      async loadBinding() {
        return { state: 'draft', externalAttachmentCount: 0 };
      },
      async collectionForEvent() {
        return null;
      },
    },
    targetAuthorization: {
      authorizationNow: () => '2026-10-31T16:00:00.000Z',
      loadWriteSnapshot: loadWrite,
      canWriteNode: async () => false,
    },
    originalAuthorization: {
      authorizationNow: () => '2026-10-31T16:00:00.000Z',
      load: loadRead,
      canReadFragment: async () => false,
    },
  });
  vi.mocked(jobAccount).mockResolvedValue(null);
  expect(
    (
      await runtime.http.requestUpload(
        new Request('https://app.invalid/uploads', {
          method: 'POST',
          headers: {
            origin: 'https://app.invalid',
            'content-type': 'application/json',
          },
          body: '{}',
        }),
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await runtime.http.readOriginal(
        new Request(
          'https://app.invalid/uploads/original?ticket=' + 'a'.repeat(43),
        ),
      )
    ).status,
  ).toBe(401);
  expect(transaction).not.toHaveBeenCalled();
  expect(loadWrite).not.toHaveBeenCalled();
  expect(loadRead).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
});
