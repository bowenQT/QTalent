import { sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { z } from 'zod';
import type { Database, Transaction } from '../db/client';
import type { ModelinkMaasClient } from '../integrations/maas';
import { ForbiddenError } from './project-context';
import { loadEvaluationContext } from './evaluation-context';
import {
  createDemandService,
  DemandAccessError,
  type DemandDependencies,
} from '../modules/staffing/demand/service';
import {
  demandJobPolicy,
  readDemandCreationSnapshotInTransaction,
  runDemandGeneration,
} from '../modules/staffing/demand/job';

export const staffingDemandQueue = 'staffing-demand';
const payloadSchema = z.strictObject({
  jobId: z.string().min(1),
  attempt: z.number().int().positive(),
});
/** Explicit composition; constructing/importing never calls the provider or starts a queue. */
export function createStaffingDemandRuntime(input: {
  db: Database;
  boss: PgBoss | (() => Promise<PgBoss>);
  maas?: ModelinkMaasClient;
  now?: () => string;
  /** Legacy caller input; authorization always uses the current full instant. */
  businessDate?: () => string;
}) {
  const getBoss = async () =>
    typeof input.boss === 'function' ? input.boss() : input.boss;
  const deps: DemandDependencies = {
    db: input.db,
    now: input.now ?? (() => new Date().toISOString()),
    async loadContext(tx, accountId, at) {
      try {
        const result = await loadEvaluationContext(tx, accountId, at);
        const actor = result.directory.people.find(
          (person) => person.id === result.context.account.personId,
        );
        if (!actor) throw new DemandAccessError();
        return { context: result.context, actorName: actor.name };
      } catch (error) {
        if (error instanceof ForbiddenError) throw new DemandAccessError();
        throw error;
      }
    },
    async enqueue(tx, job) {
      const id = await (
        await getBoss()
      ).send(
        staffingDemandQueue,
        { jobId: job.jobId, attempt: job.attempt },
        { db: fromDrizzle(tx, sql) },
      );
      if (!id) throw new Error('Demand job enqueue rejected');
    },
  };
  return {
    service: createDemandService(deps),
    policy: demandJobPolicy(deps),
    readCreationSnapshotInTransaction(
      tx: Transaction,
      accountId: string,
      input: { operationId: string; jobId: string },
    ) {
      return readDemandCreationSnapshotInTransaction(
        deps,
        tx,
        accountId,
        input,
      );
    },
    async run(payload: unknown) {
      if (!input.maas)
        throw new Error(
          'Demand worker requires an explicit Modelink/Gemini client',
        );
      await runDemandGeneration(deps, input.maas, payloadSchema.parse(payload));
    },
    async register() {
      const maas = input.maas;
      if (!maas)
        throw new Error(
          'Demand worker requires an explicit Modelink/Gemini client',
        );
      const boss = await getBoss();
      await boss.createQueue(staffingDemandQueue);
      await boss.work(staffingDemandQueue, async (jobs) => {
        for (const job of jobs)
          await runDemandGeneration(deps, maas, payloadSchema.parse(job.data));
      });
    },
  };
}
