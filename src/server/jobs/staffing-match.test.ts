import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { staffingMatchJobPolicy, runStaffingMatch } from './staffing-match';
import { matchingFixture } from '../../../tests/fixtures/staffing-matching';

async function fixture() {
  const f = matchingFixture();
  const { runId } = z.object({ runId: z.string() }).parse(
    await f.service.start('account-hr', {
      operationId: 'start',
      demandId: 'demand-a',
      expectedRevision: 2,
    }),
  );
  await f.service.execute(runId, 1);
  const enqueue = vi.fn(async () => undefined);
  const policy = staffingMatchJobPolicy({
    loadRun: async (_tx: null, id: string) =>
      f.store.state.runs.get(id) ?? null,
    project: f.service.project,
    enqueue,
  });
  return { ...f, runId, job: f.store.state.jobs.get(runId)!, policy, enqueue };
}
it('projects canonical cells with current authorization, never the stored raw job.result', async () => {
  const f = await fixture();
  f.job.result = { secret: 'private raw supplier result', total: 999 };
  expect(await f.policy.can(null, 'account-hr', f.job, 'read')).toBe(true);
  const projection = await f.policy.project(null, 'account-hr', f.job);
  expect(projection.progress).toEqual({ completed: 4, total: 4 });
  expect(JSON.stringify(projection)).not.toContain('supplier');
  f.context.people.find((person) => person.id === 'demo-a')!.noReview = true;
  const filtered = await f.policy.project(null, 'account-hr', f.job);
  expect(filtered.progress).toEqual({ completed: 3, total: 3 });
  expect(JSON.stringify(filtered)).not.toContain('demo-a');
});
it('refuses revoked access and does not expose a cached matching result', async () => {
  const f = await fixture();
  f.context.grants[0]!.revokedAt = '2026-09-03';
  expect(await f.policy.can(null, 'account-hr', f.job, 'read')).toBe(false);
  expect(await f.policy.project(null, 'account-hr', f.job)).toEqual({
    result: null,
    progress: null,
  });
});
it('supports only cancellation wake-up and rejects automatic retry/resume or unrelated jobs', async () => {
  const f = await fixture();
  expect(await f.policy.can(null, 'account-hr', f.job, 'retry')).toBe(false);
  expect(await f.policy.can(null, 'account-hr', f.job, 'resume')).toBe(false);
  expect(await f.policy.canResume(null, f.job)).toBe(false);
  expect(await f.policy.inputVersion(null, f.job)).toBeNull();
  await expect(f.policy.enqueue(null, f.job, 'retry')).rejects.toThrow(
    'Only cancellation',
  );
  await f.policy.enqueue(null, f.job, 'cancel');
  expect(f.enqueue).toHaveBeenCalledExactlyOnceWith(null, f.job);
  expect(
    await f.policy.can(
      null,
      'account-hr',
      { ...f.job, kind: 'staffing_demand' },
      'read',
    ),
  ).toBe(false);
  expect(
    await f.policy.can(
      null,
      'account-hr',
      { ...f.job, resourceId: 'other' },
      'read',
    ),
  ).toBe(false);
  expect(
    await f.policy.can(
      null,
      'account-hr',
      { ...f.job, inputVersion: 'changed' },
      'read',
    ),
  ).toBe(false);
  expect(
    await f.policy.can(
      null,
      'account-hr',
      { ...f.job, jobId: 'absent', resourceId: 'absent' },
      'read',
    ),
  ).toBe(false);
});
it('passes a strict queue identity to the usecase and rejects payload escalation', async () => {
  const execute = vi.fn(async () => undefined);
  await runStaffingMatch(execute, { jobId: 'run-a', attempt: 1 });
  expect(execute).toHaveBeenCalledExactlyOnceWith('run-a', 1);
  await expect(
    runStaffingMatch(execute, {
      jobId: 'run-a',
      attempt: 1,
      accountId: 'manager',
    }),
  ).rejects.toThrow();
  await expect(
    runStaffingMatch(execute, { jobId: 'run-a', attempt: 0 }),
  ).rejects.toThrow();
  expect(execute).toHaveBeenCalledTimes(1);
});
it('does not convert dependency failures into an empty authorized list', async () => {
  const f = await fixture();
  f.loadEvidence.mockRejectedValue(new Error('database unavailable'));
  await expect(f.policy.project(null, 'account-hr', f.job)).rejects.toThrow(
    'database unavailable',
  );
});
