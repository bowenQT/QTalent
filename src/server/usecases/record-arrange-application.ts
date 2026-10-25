import { fromDrizzle, type PgBoss } from 'pg-boss';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { createJobStore } from '../jobs/repository';
import {
  recordArrangeQueue,
  registerRecordArrangeJob,
} from '../jobs/record-arrange';
import { createRecordArrangeUsecase } from './record-arrange';
import { createRecordArrangeRequests } from './record-arrange-requests';
import { persistRecordDraft } from '../modules/records/write';
import type { StructuredMaasClient } from '../integrations/maas';

/** One composition for actual request storage, job policy and the trusted846 writer.
 * The shared worker owns boss lifecycle and registers this consumer serially. */
export function createRecordArrangeApplication(input: {
  db: Database;
  boss: PgBoss;
  client: StructuredMaasClient;
  environment: string;
  businessDate(): string;
  now(): Date;
}) {
  const requests = createRecordArrangeRequests({
    ...input,
    enqueue: async (tx, job) => {
      const sent = await input.boss.send(
        recordArrangeQueue,
        { jobId: job.jobId, attempt: job.attempt },
        { db: fromDrizzle(tx, sql), retryLimit: 0 },
      );
      if (!sent)
        throw new Error('Record arrangement enqueue was not committed');
    },
  });
  const runner = createRecordArrangeUsecase({
    store: createJobStore(input.db),
    client: input.client,
    now: () => input.now().toISOString(),
    load: (tx, id) => requests.load(tx, id),
    authorize: (tx, job) => requests.canRun(tx, job),
    persistRecordDraft: (tx, value) =>
      persistRecordDraft(tx, {
        id: value.id,
        creatorAccountId: value.creatorAccountId,
        ruleVersionId: value.ruleVersionId,
        draft: value.draft,
        sources: value.sources,
        evidence: value.evidence,
      }),
  });
  return {
    requests,
    policy: requests.policy,
    runner,
    register: () => registerRecordArrangeJob(input.boss, runner),
  };
}
