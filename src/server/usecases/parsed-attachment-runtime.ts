import 'server-only';
import { fromDrizzle } from 'pg-boss';
import { sql } from 'drizzle-orm';
import { getDatabase } from '../db/client';
import { getEnv } from '../env';
import { createClock } from '../../lib/clock';
import { getAppJobProducer } from '../platform/jobs/app-runtime';
import { parsedAttachmentArrangeQueue } from '../jobs/parsed-attachment-arrange';
import { createParsedAttachmentBatchRequests } from './parsed-attachment-batch';
import { createParsedAttachmentPolicy } from './parsed-attachment-policy';
import type { NativeBatchDependencies } from './record-batch-arrange-store';

export function parsedAttachmentRequestsForServer() {
  const clock = createClock(getEnv().APP_ENV);
  const deps: NativeBatchDependencies = {
    db: getDatabase(),
    businessNow: () => clock.now().toISOString(),
    now: () => new Date(),
    enqueue: async (tx, job) => {
      const boss = await getAppJobProducer(parsedAttachmentArrangeQueue);
      const sent = await boss.send(
        parsedAttachmentArrangeQueue,
        { jobId: job.jobId, attempt: job.attempt },
        { db: fromDrizzle(tx, sql), retryLimit: 0 },
      );
      if (!sent)
        throw new Error('Attachment arrangement enqueue was not committed');
    },
  };
  return {
    ...createParsedAttachmentBatchRequests(deps),
    policy: createParsedAttachmentPolicy(deps),
  };
}
