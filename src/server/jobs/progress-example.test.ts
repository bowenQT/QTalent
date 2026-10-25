import { beforeEach, expect, it, vi } from 'vitest';
import { exampleJobPolicy, exampleSnapshotSchema } from './progress-example';
import { newJob } from './state';
import { ForbiddenError } from '../usecases/project-context';
import type { Transaction } from '../db/client';
import type { AuthzContext } from '../authz';
const load = vi.hoisted(() => vi.fn());
vi.mock('../usecases/project-context', async (original) => ({
  ...(await original<typeof import('../usecases/project-context')>()),
  loadProjectContext: load,
}));
const job = newJob(
  { jobId: 'j', kind: 'test-job', resourceId: 'p', inputVersion: 'v1' },
  '2026-10-25T00:00:00.000Z',
);
const tx = {} as Transaction;
let context: AuthzContext;
beforeEach(() => {
  context = {
    account: { id: 'a', personId: 'person', isSystemAdmin: false },
    now: '2026-10-25',
    grants: [
      {
        accountId: 'a',
        role: 'hr',
        scope: 'cohort',
        cohortId: 'c',
        validFrom: '2026-01-01',
        validTo: null,
        revokedAt: null,
      },
    ],
    enrollments: [],
    assignments: [],
    members: [],
    people: [],
    projects: [
      {
        id: 'p',
        cohortId: 'c',
        isTopic: true,
        creatorId: 'other',
        ownerId: null,
      },
    ],
  };
  load.mockReset().mockResolvedValue({ context });
});
it('uses current project authorization, not job ownership, and denies every control', async () => {
  const policy = exampleJobPolicy();
  expect(await policy.can(tx, 'a', job, 'read')).toBe(true);
  for (const action of ['retry', 'resume', 'cancel'] as const)
    expect(await policy.can(tx, 'a', job, action)).toBe(false);
  context.grants[0].cohortId = 'other';
  expect(await policy.can(tx, 'a', job, 'read')).toBe(false);
  context.grants[0].cohortId = 'c';
  context.account.isSystemAdmin = true;
  expect(await policy.can(tx, 'a', job, 'read')).toBe(false);
  context.account.isSystemAdmin = false;
  context.grants[0].revokedAt = '2026-01-02';
  expect(await policy.can(tx, 'a', job, 'read')).toBe(false);
  context.projects = [];
  expect(await policy.can(tx, 'a', job, 'read')).toBe(false);
});
it('sanitizes known authorization rejection and preserves dependency failure', async () => {
  const policy = exampleJobPolicy();
  load.mockRejectedValue(new ForbiddenError());
  expect(await policy.can(tx, 'a', job, 'read')).toBe(false);
  load.mockRejectedValue(new Error('database'));
  await expect(policy.can(tx, 'a', job, 'read')).rejects.toThrow('database');
});
it('only projects strictly validated synthetic units, no credentials or talent inference', async () => {
  const policy = exampleJobPolicy();
  expect(await policy.project(tx, 'a', job)).toEqual({
    result: null,
    progress: null,
  });
  expect(
    await policy.project(tx, 'a', {
      ...job,
      result: { units: [{ id: 'u', label: '演示单元' }] },
    }),
  ).toEqual({
    result: { units: [{ id: 'u', label: '演示单元' }] },
    progress: { completed: 1, total: 1 },
  });
  await expect(
    policy.project(tx, 'a', {
      ...job,
      result: { units: [], rawPrompt: 'secret' },
    }),
  ).rejects.toThrow();
  expect(await policy.inputVersion(tx, job)).toBeNull();
  expect(await policy.canResume(tx, job)).toBe(false);
  await expect(policy.enqueue(tx, job, 'retry')).rejects.toThrow('authorized');
  expect(exampleSnapshotSchema.safeParse({}).success).toBe(false);
});
