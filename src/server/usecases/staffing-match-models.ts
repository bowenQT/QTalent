import { createJevClientFromEnv } from '../integrations/jev';
import { jevEnvironmentReady } from '../integrations/jev/client';
import { createModelinkMaasClientFromEnv } from '../integrations/maas';
import { modelinkEnvironmentReady } from '../integrations/maas/modelink';
import { createUnsupportedReview } from '../modules/staffing/matching/review';
import type { StaffingMatchDependencies } from './staffing-match';

/** The two model ports of BOW-854 matching, from existing server env names.
 * Jev judges every cell; only its not_supported goes to the Gemini review.
 * No env file is read and nothing is called at construction. `configured`
 * reuses each client's own env check, so it is true only when both ports are
 * live; otherwise the caller answers not_connected instead of running cells
 * that would all fail on configuration.
 */
export function createStaffingMatchModels(
  environment: Record<string, string | undefined> = process.env,
  transport: { fetch?: typeof fetch } = {},
): Pick<StaffingMatchDependencies<unknown>, 'jev' | 'reviewUnsupported'> & {
  configured: boolean;
} {
  return {
    configured:
      jevEnvironmentReady(environment) && modelinkEnvironmentReady(environment),
    jev: createJevClientFromEnv(environment, transport),
    reviewUnsupported: createUnsupportedReview(
      createModelinkMaasClientFromEnv(environment, transport),
    ),
  };
}
