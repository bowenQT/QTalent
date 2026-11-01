import 'server-only';
import type { createStaffingMatchUsecase } from '../usecases/staffing-match';

export type StaffingMatchService = Pick<
  ReturnType<typeof createStaffingMatchUsecase>,
  'start' | 'read' | 'judge'
>;

/**
 * The one place the find-people page gets candidate matching (BOW-854) from. It returns
 * null until every port `createStaffingMatchRuntime` needs exists on the server; the
 * actions then answer `not_connected` and the page says matching is not connected.
 * Nothing here stands in for a missing port.
 *
 * Still missing (listed on #248, comment 6559923544):
 * 1. Migrations for `staffing_match_runs` and `staffing_match_operations` (X1).
 * 2. 846's read-only `readConfirmations(tx, data)`: events and people, the human
 *    acceptance, withdrawals and evidence nature (#188 README「真实确认读取仍缺」).
 * 3. 837's shared source projection `projectSources(data)`.
 * 4. Server-side composition of the Jev client and the Gemini not-supported review
 *    (`createUnsupportedReview`).
 * 5. The `staffing_match` queue's producer and worker registration (X1).
 *
 * Once they exist, compose `createStaffingMatchRuntime` here (as `staffing-runtime.ts`
 * does for demands) and return its `service`.
 */
export async function staffingMatchService(): Promise<StaffingMatchService | null> {
  return null;
}
