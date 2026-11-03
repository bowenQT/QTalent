import { getDatabase } from '../db/client';
import { getEnv } from '../env';
import { createClock } from '../../lib/clock';
import { getAppJobProducer } from '../platform/jobs/app-runtime';
import {
  createStaffingDemandRuntime,
  staffingDemandQueue,
} from '../usecases/staffing-demand-runtime';
import { parsedAttachmentRequestsForServer } from '../usecases/parsed-attachment-runtime';
import { recordArrangeRequestsForServer } from '../usecases/record-arrange-runtime';
import { createStaffingMatchServerRuntime } from '../usecases/staffing-match-runtime';
import { createJobService } from './service';
import { exampleJobPolicy } from './progress-example';
export function jobService() {
  const db = getDatabase();
  const env = getEnv();
  const clock = createClock(env.APP_ENV);
  const demand = createStaffingDemandRuntime({
    db,
    boss: () => getAppJobProducer(staffingDemandQueue),
    now: () => clock.now().toISOString(),
  });
  const arrange = recordArrangeRequestsForServer();
  const match = createStaffingMatchServerRuntime({
    db,
    boss: getAppJobProducer,
    environment: env.APP_ENV,
    wallNow: () => new Date(),
    env,
  });
  return createJobService(
    // Use the native store so a retry retains the immutable batch metadata
    // on the same locked job row while its policy enqueues in that transaction.
    arrange.native.store,
    [
      exampleJobPolicy(),
      demand.policy,
      arrange.policy,
      parsedAttachmentRequestsForServer().policy,
      match.policy,
    ],
    () => new Date().toISOString(),
  );
}
