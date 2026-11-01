import { afterEach, expect, it, vi } from 'vitest';
import type { PgBoss } from 'pg-boss';
import type { Database, Transaction } from '../db/client';
import { createFakeModelinkMaas } from '../integrations/maas';
import { createStaffingDemandRuntime } from './staffing-demand-runtime';
import * as evaluation from './evaluation-context';
import { ForbiddenError } from './project-context';

const now = '2026-10-25T12:00:00.123Z';
const job = {
  jobId: 'job',
  kind: 'staffing_demand',
  resourceId: 'demand',
  inputVersion: 'version',
  status: 'queued' as const,
  attempt: 1,
  revision: 1,
  updatedAt: now,
  result: null,
  errorCode: null,
  cancelRequestedAt: null,
};
function policyTransaction() {
  return {
    select: () => ({
      from: () => ({
        where: async () => [
          { projectId: 'project', initiatorAccountId: 'account' },
        ],
      }),
    }),
  } as unknown as Transaction;
}
afterEach(() => vi.restoreAllMocks());

it('constructs without provider calls or queue startup; registration validates payload', async () => {
  const createQueue = vi.fn();
  const work = vi.fn();
  const maas = createFakeModelinkMaas({});
  const generate = vi.spyOn(maas, 'generateStructured');
  const runtime = createStaffingDemandRuntime({
    db: {} as Database,
    boss: { createQueue, work } as unknown as PgBoss,
    maas,
  });
  expect(generate).not.toHaveBeenCalled();
  expect(createQueue).not.toHaveBeenCalled();
  expect(runtime.policy.kind).toBe('staffing_demand');
  await expect(runtime.run({ jobId: '', attempt: 0 })).rejects.toThrow();
  expect(generate).not.toHaveBeenCalled();
  await runtime.register();
  expect(createQueue).toHaveBeenCalledExactlyOnceWith('staffing-demand');
  expect(work).toHaveBeenCalledWith('staffing-demand', expect.any(Function));
  const consume = work.mock.calls[0][1];
  await expect(
    consume([{ data: { jobId: '', attempt: 0 } }]),
  ).rejects.toThrow();
  expect(generate).not.toHaveBeenCalled();
});

it('refuses worker startup without an explicit Modelink client', async () => {
  const boss = vi.fn<() => Promise<PgBoss>>();
  const runtime = createStaffingDemandRuntime({ db: {} as Database, boss });
  await expect(runtime.run({ jobId: 'job', attempt: 1 })).rejects.toThrow(
    'Modelink/Gemini',
  );
  await expect(runtime.register()).rejects.toThrow('Modelink/Gemini');
  expect(boss).not.toHaveBeenCalled();
});

it('reloads current evaluation authorization with the full instant on every access', async () => {
  const load = vi
    .spyOn(evaluation, 'loadEvaluationContext')
    .mockRejectedValue(new ForbiddenError());
  const businessDate = vi.fn(() => '2026-09-04');
  const runtime = createStaffingDemandRuntime({
    db: {} as Database,
    boss: {} as PgBoss,
    businessDate,
    now: () => now,
  });
  const tx = policyTransaction();
  expect(await runtime.policy.can(tx, 'account', job, 'read')).toBe(false);
  expect(await runtime.policy.can(tx, 'account', job, 'read')).toBe(false);
  expect(load).toHaveBeenCalledTimes(2);
  expect(load).toHaveBeenNthCalledWith(1, tx, 'account', now);
  expect(load).toHaveBeenNthCalledWith(2, tx, 'account', now);
  expect(businessDate).not.toHaveBeenCalled();
});

it('denies an identity without a current directory person and propagates SQL failures', async () => {
  const load = vi.spyOn(evaluation, 'loadEvaluationContext');
  load.mockResolvedValue({
    directory: { people: [] },
    context: { account: { personId: 'absent' } },
  } as unknown as Awaited<ReturnType<typeof evaluation.loadEvaluationContext>>);
  const runtime = createStaffingDemandRuntime({
    db: {} as Database,
    boss: {} as PgBoss,
    now: () => now,
  });
  const tx = policyTransaction();
  expect(await runtime.policy.can(tx, 'account', job, 'read')).toBe(false);
  load.mockRejectedValue(new Error('synthetic database unavailable'));
  await expect(runtime.policy.can(tx, 'account', job, 'read')).rejects.toThrow(
    'synthetic database unavailable',
  );
});
