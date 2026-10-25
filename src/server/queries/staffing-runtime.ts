import 'server-only';
import { getDatabase } from '../db/client';
import { getAppJobProducer } from '../platform/jobs/app-runtime';
import {
  createStaffingDemandRuntime,
  staffingDemandQueue,
} from '../usecases/staffing-demand-runtime';

export async function staffingDemandRuntime() {
  return createStaffingDemandRuntime({
    db: getDatabase(),
    boss: () => getAppJobProducer(staffingDemandQueue),
  });
}
