import 'server-only';
import { getDatabase } from '../db/client';
import { getEnv } from '../env';
import { createClock } from '../../lib/clock';
import { getAppJobProducer } from '../platform/jobs/app-runtime';
import {
  createStaffingDemandRuntime,
  staffingDemandQueue,
} from '../usecases/staffing-demand-runtime';

export async function staffingDemandRuntime() {
  return createStaffingDemandRuntime({
    db: getDatabase(),
    businessDate: createClock(getEnv().APP_ENV).today,
    boss: () => getAppJobProducer(staffingDemandQueue),
  });
}
