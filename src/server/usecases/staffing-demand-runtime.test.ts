import { expect, it, vi } from 'vitest';
import type { PgBoss } from 'pg-boss';
import type { Database, Transaction } from '../db/client';
import { createFakeMaas } from '../integrations/maas';
import { createStaffingDemandRuntime } from './staffing-demand-runtime';

it('constructs without provider calls or queue startup; explicit registration validates payload', async () => {
  const createQueue = vi.fn();
  const work = vi.fn();
  const maas = createFakeMaas({});
  const generate = vi.spyOn(maas, 'generateStructured');
  const runtime = createStaffingDemandRuntime({
    db: {} as Database,
    boss: { createQueue, work } as unknown as PgBoss,
    maas,
    businessDate: () => '2026-09-04',
  });
  expect(generate).not.toHaveBeenCalled();
  expect(createQueue).not.toHaveBeenCalled();
  expect(runtime.policy.kind).toBe('staffing_demand');
  await expect(runtime.run({ jobId: '', attempt: 0 })).rejects.toThrow();
  expect(generate).not.toHaveBeenCalled();
  await runtime.register();
  expect(createQueue).toHaveBeenCalledWith('staffing-demand');
  expect(work).toHaveBeenCalledWith('staffing-demand', expect.any(Function));
});

it('uses the injected business date for authorization, not the wall clock', async () => {
  const context = await import('./project-context');
  const load = vi
    .spyOn(context, 'loadProjectContext')
    .mockRejectedValue(new context.ForbiddenError());
  const tx = {
    select: () => ({
      from: () => ({
        where: async () => [
          { projectId: 'project', initiatorAccountId: 'account' },
        ],
      }),
    }),
  } as unknown as Transaction;
  const runtime = createStaffingDemandRuntime({
    db: {} as Database,
    boss: {} as PgBoss,
    businessDate: () => '2026-09-04',
    now: () => '2026-10-25T12:00:00.000Z',
  });
  try {
    const job = {
      jobId: 'job',
      kind: 'staffing_demand',
      resourceId: 'demand',
      inputVersion: 'version',
      status: 'queued' as const,
      attempt: 1,
      revision: 1,
      updatedAt: '2026-10-25T12:00:00.000Z',
      result: null,
      errorCode: null,
      cancelRequestedAt: null,
    };
    expect(await runtime.policy.can(tx, 'account', job, 'read')).toBe(false);
    expect(load).toHaveBeenCalledWith(tx, 'account', '2026-09-04');
  } finally {
    load.mockRestore();
  }
});
