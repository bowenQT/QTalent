import 'server-only';
import { fromDrizzle } from 'pg-boss';
import { sql } from 'drizzle-orm';
import { getDatabase } from '../db/client';
import { getEnv } from '../env';
import { createClock } from '../../lib/clock';
import { getAppJobProducer } from '../platform/jobs/app-runtime';
import { recordArrangeQueue } from '../jobs/record-arrange';
import { createRecordArrangeRequests } from './record-arrange-requests';

/** Request-local service;852 owns the only lazy producer and its lifecycle. */
export function recordArrangeRequestsForServer() {
  const environment = getEnv().APP_ENV;
  const clock = createClock(environment);
  return createRecordArrangeRequests({
    db: getDatabase(),
    businessNow: () => clock.now().toISOString(),
    now: () => new Date(),
    enqueue: async (tx, job) => {
      const boss = await getAppJobProducer(recordArrangeQueue);
      const sent = await boss.send(
        recordArrangeQueue,
        { jobId: job.jobId, attempt: job.attempt },
        { db: fromDrizzle(tx, sql), retryLimit: 0 },
      );
      if (!sent)
        throw new Error('Record arrangement enqueue was not committed');
    },
  });
}
