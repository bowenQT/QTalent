import { getDatabase } from '../db/client';
import { getEnv } from '../env';
import { createClock } from '../../lib/clock';
import { getAppJobProducer } from '../platform/jobs/app-runtime';
import {
  createStaffingDemandRuntime,
  staffingDemandQueue,
} from '../usecases/staffing-demand-runtime';
import { createJobStore } from './repository';
import { createJobService } from './service';
import { exampleJobPolicy } from './progress-example';
export function jobService() {
  const db = getDatabase();
  const demand = createStaffingDemandRuntime({
    db,
    boss: () => getAppJobProducer(staffingDemandQueue),
    businessDate: createClock(getEnv().APP_ENV).today,
  });
  return createJobService(
    createJobStore(db),
    [exampleJobPolicy(), demand.policy],
    () => new Date().toISOString(),
  );
}
