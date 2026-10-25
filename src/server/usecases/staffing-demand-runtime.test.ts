import { expect, it, vi } from 'vitest';
import type { PgBoss } from 'pg-boss';
import type { Database } from '../db/client';
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
