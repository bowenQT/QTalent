import type { PgBoss } from 'pg-boss';
import type { Database } from '../db/client';
import type { getEnv } from '../env';
import { createClock } from '../../lib/clock';
import { staffingMatchQueue } from '../jobs/staffing-match';
import { createStaffingDemandRuntime } from './staffing-demand-runtime';
import {
  createStaffingMatchEvidenceLoader,
  createStaffingMatchRuntime,
} from './staffing-match';
import { createStaffingMatchModels } from './staffing-match-models';
import { readStaffingMatchConfirmations } from './staffing-match-confirmations';
import { projectReadableSources } from './source-projection';

type Env = ReturnType<typeof getEnv>;

/**
 * BOW-854 matching for the web producer and the worker, per the composition
 * interface frozen on #305. Constructing it touches no database, queue or
 * provider; `register()` only creates the queue and its handler.
 * `configured` is false unless both model ports are live; the entry answers
 * not_connected then instead of starting cells that would all fail. A worker
 * that is not configured creates the queue but takes no jobs: queued runs wait
 * for a worker with both ports instead of settling as awaiting_manual, which
 * the job policy can neither retry nor resume.
 */
export function createStaffingMatchServerRuntime(input: {
  db: Database;
  boss: (queue: typeof staffingMatchQueue) => Promise<PgBoss>;
  environment: Env['APP_ENV'];
  wallNow: () => Date;
  env: Env;
}) {
  const models = createStaffingMatchModels({
    QINIU_MAAS_API_KEY: input.env.QINIU_MAAS_API_KEY,
    MODELINK_API_KEY: input.env.MODELINK_API_KEY,
    MODELINK_BASE_URL: input.env.MODELINK_BASE_URL,
    MODELINK_MODEL: input.env.MODELINK_MODEL,
  });
  const clock = createClock(input.environment, input.wallNow);
  // Matching only reads confirmed demands; it never enqueues demand work.
  const demands = createStaffingDemandRuntime({
    db: input.db,
    boss: () =>
      Promise.reject(new Error('Matching does not start demand jobs')),
    now: () => clock.now().toISOString(),
  }).service;
  const runtime = createStaffingMatchRuntime({
    db: input.db,
    boss: input.boss,
    environment: input.environment,
    wallNow: input.wallNow,
    demands,
    loadEvidence: createStaffingMatchEvidenceLoader({
      db: input.db,
      readConfirmations: readStaffingMatchConfirmations,
      projectSources: projectReadableSources,
    }),
    jev: models.jev,
    reviewUnsupported: models.reviewUnsupported,
  });
  return {
    configured: models.configured,
    service: runtime.service,
    policy: runtime.policy,
    async register() {
      const boss = await input.boss(staffingMatchQueue);
      if (models.configured) await runtime.registerWorker(boss);
      else await boss.createQueue(staffingMatchQueue);
    },
  };
}
