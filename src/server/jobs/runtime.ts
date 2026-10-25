import { getDatabase } from '../db/client';
import { createJobStore } from './repository';
import { createJobService } from './service';
import { exampleJobPolicy } from './progress-example';
export function jobService() {
  return createJobService(
    createJobStore(getDatabase()),
    [exampleJobPolicy()],
    () => new Date().toISOString(),
  );
}
