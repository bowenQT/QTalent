import 'server-only';
import { createClock, type Clock } from '../../lib/clock';
import { requireSession } from '../auth/next';
import { getDatabase, type DbExecutor } from '../db/client';
import { getEnv } from '../env';
import { readDirectory } from '../modules/directory';
import type { ComparisonReadPorts } from '../modules/evaluation-system/judgment-comparison/ports';
import { loadEvaluationContext } from '../usecases/evaluation-context';
import { ForbiddenError } from '../usecases/project-context';
import { comparisonAccess, type ComparisonAudience } from './judge-access';

/**
 * The BOW-919 read ports. Access is real: audience and node grants are reloaded from
 * the authorization domain on every call. `loadBatch` returns null because nothing
 * to compare is stored yet: there is no batch table, no HR-confirmed mapping table
 * and no 入营选拔 judgment in the database (the BOW-923 sheets are test fixtures
 * only). Once they are imported, this is where a batch is read for the viewer.
 */
export function comparisonReadPorts(
  db: DbExecutor,
  accountId: string,
  clock: Clock,
): ComparisonReadPorts {
  return {
    async loadCurrentAccess() {
      const now = clock.now().toISOString();
      const { context } = await loadEvaluationContext(db, accountId, now);
      return comparisonAccess(context);
    },
    async loadBatch() {
      return null;
    },
  };
}

export type JudgePage =
  | { status: 'admin' }
  | { status: 'forbidden' }
  /** The viewer may read comparisons, but no batch source is connected yet. */
  | { status: 'not_connected'; audience: ComparisonAudience };

/** /judge: who is asking decides the view; the batch read waits for its source. */
export async function getJudgePage(): Promise<JudgePage> {
  const session = await requireSession();
  const db = getDatabase();
  const clock = createClock(getEnv().APP_ENV);
  // A system admin has no talent context to load; the page explains the boundary.
  const directory = await readDirectory(db, session.user.id);
  if (directory?.account.isSystemAdmin) return { status: 'admin' };
  try {
    const { context } = await loadEvaluationContext(
      db,
      session.user.id,
      clock.now().toISOString(),
    );
    // Same derivation as `loadCurrentAccess`, from the context already loaded.
    const access = comparisonAccess(context);
    return access
      ? { status: 'not_connected', audience: access.audience }
      : { status: 'forbidden' };
  } catch (error) {
    if (error instanceof ForbiddenError) return { status: 'forbidden' };
    throw error;
  }
}
