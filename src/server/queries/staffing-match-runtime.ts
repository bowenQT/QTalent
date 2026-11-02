import 'server-only';
import { getDatabase } from '../db/client';
import { getEnv } from '../env';
import { getAppJobProducer } from '../platform/jobs/app-runtime';
import type { createStaffingMatchUsecase } from '../usecases/staffing-match';
import { createStaffingMatchServerRuntime } from '../usecases/staffing-match-runtime';

export type StaffingMatchService = Pick<
  ReturnType<typeof createStaffingMatchUsecase>,
  'start' | 'read' | 'judge'
>;

/**
 * The one place the find-people page gets candidate matching (BOW-854) from: the
 * same composition the worker registers. It returns null while either model port
 * (Jev, or the Gemini not-supported review) is not configured; the actions then
 * answer `not_connected` and the page says matching is not connected.
 */
export async function staffingMatchService(): Promise<StaffingMatchService | null> {
  const env = getEnv();
  const runtime = createStaffingMatchServerRuntime({
    db: getDatabase(),
    boss: getAppJobProducer,
    environment: env.APP_ENV,
    wallNow: () => new Date(),
    env,
  });
  return runtime.configured ? runtime.service : null;
}
