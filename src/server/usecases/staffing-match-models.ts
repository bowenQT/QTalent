import { createJevClientFromEnv } from '../integrations/jev';
import { createModelinkMaasClientFromEnv } from '../integrations/maas';
import { createUnsupportedReview } from '../modules/staffing/matching/review';
import type { StaffingMatchDependencies } from './staffing-match';

const key = /^[^\s]+$/;

/** The two model ports of BOW-854 matching, from existing server env names.
 * Jev judges every cell; only its not_supported goes to the Gemini review.
 * No env file is read, nothing is called at construction, and a missing key
 * reports `configured: false` so the caller can answer not_connected instead
 * of running cells that would all fail on configuration.
 */
export function createStaffingMatchModels(
  environment: Record<string, string | undefined> = process.env,
  transport: { fetch?: typeof fetch } = {},
): Pick<StaffingMatchDependencies<unknown>, 'jev' | 'reviewUnsupported'> & {
  configured: boolean;
} {
  return {
    configured:
      key.test(environment.QINIU_MAAS_API_KEY ?? '') &&
      key.test(environment.MODELINK_API_KEY ?? ''),
    jev: createJevClientFromEnv(environment, transport),
    reviewUnsupported: createUnsupportedReview(
      createModelinkMaasClientFromEnv(environment, transport),
    ),
  };
}
