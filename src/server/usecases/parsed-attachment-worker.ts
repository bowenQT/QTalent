import { fromDrizzle, type PgBoss } from 'pg-boss';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import type { ModelinkMaasClient } from '../integrations/maas';
import {
  parsedAttachmentArrangeQueue,
  registerParsedAttachmentArrange,
} from '../jobs/parsed-attachment-arrange';
import { createParsedAttachmentArrange } from './parsed-attachment-arrange';
import { createParsedAttachmentBatchRequests } from './parsed-attachment-batch';
import type { NativeBatchDependencies } from './record-batch-arrange-store';

/** Shares the application's boss and transaction; does not own a pool or clock.
 * Parser lifecycle hooks refresh terminal parses and recover missed handoffs. */
export function createParsedAttachmentWorker(input: {
  db: Database;
  boss: PgBoss;
  client: ModelinkMaasClient;
  businessNow(): string;
  now(): Date;
}) {
  const deps: NativeBatchDependencies = {
    ...input,
    enqueue: async (tx, job) => {
      const sent = await input.boss.send(
        parsedAttachmentArrangeQueue,
        { jobId: job.jobId, attempt: job.attempt },
        { db: fromDrizzle(tx, sql), retryLimit: 0 },
      );
      if (!sent)
        throw new Error('Attachment arrangement enqueue was not committed');
    },
  };
  const requests = createParsedAttachmentBatchRequests(deps);
  const arrange = createParsedAttachmentArrange(deps, input.client);
  return {
    requests,
    arrange,
    afterParse: requests.refreshForParseJob,
    async recover() {
      await requests.recover();
      return arrange.recover();
    },
    register: () => registerParsedAttachmentArrange(input.boss, arrange),
  };
}
