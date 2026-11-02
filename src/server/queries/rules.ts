import 'server-only';
import { createClock } from '../../lib/clock';
import { requireSession } from '../auth/next';
import { getDatabase } from '../db/client';
import { DEMO_NEXT_COHORT } from '../db/seed/standard-iteration-demo/init';
import { getEnv } from '../env';
import { readDirectory } from '../modules/directory';
import {
  createNativeSelectionLifecycle,
  type SelectionStandardPage,
} from '../usecases/selection-standard-native';

/**
 * The selection-standard lifecycle on the business clock. The next cohort a
 * publication previews is the reviewed demo descriptor; production has none
 * configured, so publishing there stays unavailable rather than guessing one.
 */
export function selectionLifecycle() {
  const env = getEnv();
  const clock = createClock(env.APP_ENV);
  return createNativeSelectionLifecycle(getDatabase(), {
    nextCohort: env.APP_ENV === 'production' ? null : DEMO_NEXT_COHORT,
    clock: () => clock.now(),
  });
}

export type RulesPage = { status: 'admin' } | SelectionStandardPage;

/** /rules?r=front&line=xe-select: the viewer's role and scope come from the session. */
export async function getSelectionStandardPage(
  draftId: string | null,
): Promise<RulesPage> {
  const session = await requireSession();
  const directory = await readDirectory(getDatabase(), session.user.id);
  if (directory?.account.isSystemAdmin) return { status: 'admin' };
  return selectionLifecycle().readPage(session.user.id, draftId);
}
