import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createJobService,
  type JobPolicy,
  type JobStore,
  type JobTransaction,
  type StoredOperation,
} from './service';
import { advanceJob, newJob, type JobRecord } from './state';
const now = '2026-10-25T00:00:00.000Z';
function fixture() {
  let record: JobRecord | null = advanceJob(
    newJob(
      { jobId: 'j', kind: 'test-job', resourceId: 'p', inputVersion: 'v1' },
      now,
    ),
    { status: 'running', attempt: 1, expectedRevision: 1 },
    now,
  );
  const operations = new Map<string, StoredOperation>();
  let allowed = true;
  let currentVersion = 'v1';
  const enqueue = vi.fn();
  const tx: JobTransaction<null> = {
    context: null,
    get record() {
      return record;
    },
    save: async (next) => {
      record = next;
    },
    operation: async (actor, key) => operations.get(actor + key) ?? null,
    saveOperation: async (actor, key, operation) => {
      operations.set(actor + key, operation);
    },
  };
  const store: JobStore<null> = {
    locked: async (_id, callback) => callback(tx),
  };
  const resultSchema = z
    .object({ units: z.array(z.object({ id: z.string() }).strict()) })
    .strict();
  const policy: JobPolicy<null> = {
    kind: 'test-job',
    resultSchema,
    can: async () => allowed,
    inputVersion: async () => currentVersion,
    canResume: async () => true,
    enqueue,
    project: async () => ({
      result: { units: [{ id: 'visible' }] },
      progress: { completed: 1, total: 1 },
    }),
  };
  return {
    service: createJobService(store, [policy], () => now),
    policy,
    enqueue,
    operations,
    get record() {
      return record!;
    },
    set record(value) {
      record = value;
    },
    deny() {
      allowed = false;
    },
    changeInput() {
      currentVersion = 'v2';
    },
  };
}
const cmd = {
  jobId: 'j',
  action: 'retry' as const,
  operationId: 'op',
  expectedRevision: 3,
};
describe('job service authorization and idempotence', () => {
  it('returns only consumer-projected validated public fields and visible counts', async () => {
    const f = fixture();
    const result = await f.service.read('account', 'j');
    expect(result).toMatchObject({
      status: 'success',
      snapshot: {
        result: { units: [{ id: 'visible' }] },
        progress: { completed: 1, total: 1 },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /inputVersion|resourceId|confidence|objectKey/,
    );
    f.deny();
    expect(await f.service.read('account', 'j')).toEqual({
      status: 'forbidden',
    });
  });
  it('replays same operation without enqueue or attempt duplication, checking permission first', async () => {
    const f = fixture();
    f.record = advanceJob(
      f.record,
      { status: 'failed', attempt: 1, expectedRevision: 2 },
      now,
    );
    const first = await f.service.command('account', cmd);
    expect(first).toMatchObject({
      status: 'success',
      snapshot: { attempt: 2, status: 'queued' },
    });
    expect(await f.service.command('account', cmd)).toEqual(first);
    expect(f.enqueue).toHaveBeenCalledTimes(1);
    expect(
      await f.service.command('account', { ...cmd, action: 'resume' }),
    ).toEqual({ status: 'conflict' });
    f.deny();
    expect(await f.service.command('account', cmd)).toEqual({
      status: 'forbidden',
    });
  });
  it('refuses changed inputs and stale commands before side effects', async () => {
    const f = fixture();
    f.record = advanceJob(
      f.record,
      { status: 'failed', attempt: 1, expectedRevision: 2 },
      now,
    );
    f.changeInput();
    expect(await f.service.command('account', cmd)).toEqual({
      status: 'conflict',
    });
    expect(f.enqueue).not.toHaveBeenCalled();
    expect(
      await f.service.command('account', { ...cmd, expectedRevision: 1 }),
    ).toEqual({ status: 'conflict' });
  });
  it('defaults unknown kinds to denial and rejects schema leakage', async () => {
    const f = fixture();
    f.record = { ...f.record, kind: 'unregistered' };
    expect(await f.service.read('account', 'j')).toEqual({
      status: 'forbidden',
    });
    f.record = { ...f.record, kind: 'test-job' };
    f.policy.project = async () => ({
      result: { units: [], confidence: 1 },
      progress: null,
    });
    await expect(f.service.read('account', 'j')).rejects.toThrow();
  });
});

it('handles missing records and unknown kinds without attempting controls', async () => {
  const f = fixture();
  f.record = null as unknown as JobRecord;
  expect(await f.service.read('a', 'j')).toEqual({ status: 'not_found' });
  expect(await f.service.command('a', cmd)).toEqual({ status: 'not_found' });
  f.record = {
    ...newJob(
      { jobId: 'j', kind: 'unknown', resourceId: 'p', inputVersion: 'v1' },
      now,
    ),
  };
  expect(await f.service.command('a', cmd)).toEqual({ status: 'forbidden' });
});
it('never upgrades read permission to control permission', async () => {
  const f = fixture();
  f.policy.can = async (_tx, _account, _job, action) => action === 'read';
  expect(
    await f.service.command('a', {
      ...cmd,
      action: 'cancel',
      expectedRevision: 2,
    }),
  ).toEqual({ status: 'forbidden' });
  expect(f.enqueue).not.toHaveBeenCalled();
  expect(f.record.cancelRequestedAt).toBeNull();
});
it('requires manual prerequisites, resumes once and returns sanitized errors', async () => {
  const f = fixture();
  f.record = advanceJob(
    f.record,
    { status: 'awaiting_manual', attempt: 1, expectedRevision: 2 },
    now,
  );
  f.policy.canResume = async () => false;
  const input = { ...cmd, action: 'resume' as const };
  expect(await f.service.command('a', input)).toEqual({ status: 'conflict' });
  f.policy.canResume = async () => true;
  expect(await f.service.command('a', input)).toMatchObject({
    status: 'success',
    snapshot: { status: 'running', attempt: 1, revision: 4 },
  });
  expect(await f.service.command('a', input)).toMatchObject({
    status: 'success',
    snapshot: { revision: 4 },
  });
  expect(f.enqueue).toHaveBeenCalledTimes(1);
  f.record = { ...f.record, status: 'failed', errorCode: 'processing_failed' };
  expect(await f.service.read('a', 'j')).toMatchObject({
    status: 'success',
    snapshot: {
      error: { code: 'processing_failed', message: '处理失败，可以检查后重试' },
    },
  });
});
it('persists a cancellation fence with one wakeup and rejects stale completion', async () => {
  const f = fixture();
  const input = { ...cmd, action: 'cancel' as const, expectedRevision: 2 };
  expect(await f.service.command('a', input)).toMatchObject({
    status: 'success',
    snapshot: { cancelRequestedAt: now, canCancel: false, canRetry: false },
  });
  expect(f.enqueue).toHaveBeenCalledTimes(1);
  expect(await f.service.command('a', input)).toMatchObject({
    status: 'success',
    snapshot: { revision: 3 },
  });
  expect(
    await f.service.command('a', {
      ...input,
      operationId: 'different',
      expectedRevision: 1,
    }),
  ).toEqual({ status: 'conflict' });
});
it('rejects duplicate policy registration and propagates transaction errors', async () => {
  const f = fixture();
  expect(() =>
    createJobService({ locked: vi.fn() }, [f.policy, f.policy], () => now),
  ).toThrow('Duplicate');
  f.record = advanceJob(
    f.record,
    { status: 'failed', attempt: 1, expectedRevision: 2 },
    now,
  );
  f.enqueue.mockRejectedValue(new Error('queue unavailable'));
  await expect(f.service.command('a', cmd)).rejects.toThrow(
    'queue unavailable',
  );
});

it('wakes a stopped attempt for cancellation acknowledgement exactly once', async () => {
  const f = fixture();
  f.record = advanceJob(
    f.record,
    { status: 'awaiting_manual', attempt: 1, expectedRevision: 2 },
    now,
  );
  const input = { ...cmd, action: 'cancel' as const };
  expect(await f.service.command('a', input)).toMatchObject({
    status: 'success',
    snapshot: { cancelRequestedAt: now },
  });
  expect(f.enqueue).toHaveBeenCalledWith(
    null,
    expect.objectContaining({ status: 'awaiting_manual' }),
    'cancel',
  );
  await f.service.command('a', input);
  await f.service.command('a', {
    ...input,
    operationId: 'second-cancel',
    expectedRevision: 4,
  });
  expect(f.enqueue).toHaveBeenCalledTimes(1);
});
