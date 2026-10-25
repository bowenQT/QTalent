import { beforeEach, expect, it, vi } from 'vitest';
import {
  runProgressExample,
  registerProgressExample,
  progressExampleQueue,
} from './progress-worker';
import { newJob, type JobRecord } from './state';
import type { Database } from '../db/client';
import type { PgBoss } from 'pg-boss';
const locked = vi.hoisted(() => vi.fn());
vi.mock('./repository', () => ({ createJobStore: () => ({ locked }) }));
let record: JobRecord | null;
let writes: JobRecord[];
const db = {} as Database;
beforeEach(() => {
  record = newJob(
    { jobId: 'j', kind: 'test-job', resourceId: 'p', inputVersion: 'v1' },
    '2026-10-25T00:00:00.000Z',
  );
  writes = [];
  locked.mockImplementation(async (_id, run) =>
    run({
      record,
      save: async (next: JobRecord) => {
        record = next;
        writes.push(next);
      },
    }),
  );
});
it('persists a synthetic example across observable phases and ignores duplicate completed delivery', async () => {
  await runProgressExample(db, { jobId: 'j', attempt: 1 });
  expect(writes.map((r) => r.status)).toEqual([
    'running',
    'partial',
    'completed',
  ]);
  expect(record?.result).toEqual({
    units: [{ id: 'synthetic-unit', label: '演示单元已处理' }],
  });
  await runProgressExample(db, { jobId: 'j', attempt: 1 });
  expect(writes).toHaveLength(3);
});
it.each(['queued', 'running', 'partial', 'failed', 'awaiting_manual'] as const)(
  'acknowledges cancellation fence from %s without publishing result',
  async (status) => {
    record = {
      ...record!,
      status,
      cancelRequestedAt: '2026-10-25T00:00:00.000Z',
    };
    await runProgressExample(db, { jobId: 'j', attempt: 1 });
    expect(record?.status).toBe('cancelled');
    expect(record?.result).toBeNull();
  },
);
it('resumes duplicate running delivery without attempting running-to-running', async () => {
  record = { ...record!, status: 'running' };
  await runProgressExample(db, { jobId: 'j', attempt: 1 });
  expect(writes.map((r) => r.status)).toEqual(['partial', 'completed']);
});
it.each(['failed', 'awaiting_manual', 'cancelled'] as const)(
  'does not automatically resume %s',
  async (status) => {
    record = { ...record!, status };
    await runProgressExample(db, { jobId: 'j', attempt: 1 });
    expect(writes).toHaveLength(0);
  },
);
it('ignores wrong kind, old attempts and missing jobs; rejects invalid queue input', async () => {
  await runProgressExample(db, { jobId: 'j', attempt: 2 });
  record = { ...record!, kind: 'other' };
  await runProgressExample(db, { jobId: 'j', attempt: 1 });
  record = null;
  await runProgressExample(db, { jobId: 'j', attempt: 1 });
  expect(writes).toHaveLength(0);
  await expect(
    runProgressExample(db, { jobId: 'j', attempt: 0 }),
  ).rejects.toThrow();
});
it('registers only the explicit pg-boss example queue', async () => {
  const createQueue = vi.fn();
  const work = vi.fn();
  await registerProgressExample({ createQueue, work } as unknown as PgBoss, db);
  expect(createQueue).toHaveBeenCalledWith(progressExampleQueue);
  expect(work.mock.calls[0][0]).toBe(progressExampleQueue);
  await work.mock.calls[0][1]([{ data: { jobId: 'j', attempt: 1 } }]);
  expect(record?.status).toBe('completed');
});
