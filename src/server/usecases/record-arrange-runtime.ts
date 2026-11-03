import 'server-only';
import { fromDrizzle } from 'pg-boss';
import { sql } from 'drizzle-orm';
import { getDatabase } from '../db/client';
import { getEnv } from '../env';
import { createClock } from '../../lib/clock';
import { getAppJobProducer } from '../platform/jobs/app-runtime';
import { recordArrangeQueue } from '../jobs/record-arrange';
import {
  attachmentParseQueue,
  sendAttachmentParse,
} from '../jobs/attachment-parse';
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
      const queue =
        job.kind === 'media' ? attachmentParseQueue : recordArrangeQueue;
      const boss = await getAppJobProducer(queue);
      const db = fromDrizzle(tx, sql);
      const sent =
        queue === attachmentParseQueue
          ? await sendAttachmentParse(boss, job, { db })
          : await boss.send(
              queue,
              { jobId: job.jobId, attempt: job.attempt },
              { db, retryLimit: 0 },
            );
      if (!sent)
        throw new Error('Record arrangement enqueue was not committed');
    },
  });
}
