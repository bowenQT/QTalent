import { getDatabase } from '../db/client';
import { getEnv } from '../env';
import { createClock } from '../../lib/clock';
import { getAppJobProducer } from '../platform/jobs/app-runtime';
import {
  createStaffingDemandRuntime,
  staffingDemandQueue,
} from '../usecases/staffing-demand-runtime';
import { recordArrangeRequestsForServer } from '../usecases/record-arrange-runtime';
import { createJobService } from './service';
import { exampleJobPolicy } from './progress-example';
export function jobService() {
  const db = getDatabase();
  const clock = createClock(getEnv().APP_ENV);
  const demand = createStaffingDemandRuntime({
    db,
    boss: () => getAppJobProducer(staffingDemandQueue),
    now: () => clock.now().toISOString(),
  });
  const arrange = recordArrangeRequestsForServer();
  return createJobService(
    // Use the native store so a retry retains the immutable batch metadata
    // on the same locked job row while its policy enqueues in that transaction.
    arrange.native.store,
    [exampleJobPolicy(), demand.policy, arrange.policy],
    () => new Date().toISOString(),
  );
}
