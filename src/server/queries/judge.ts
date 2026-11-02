import 'server-only';
import { createClock, type Clock } from '../../lib/clock';
import { requireSession } from '../auth/next';
import { getDatabase, type DbExecutor } from '../db/client';
import { getEnv } from '../env';
import { readDirectory } from '../modules/directory';
import type { ComparisonReadPorts } from '../modules/evaluation-system/judgment-comparison/ports';
import { holdsCaseGrant } from '../modules/evaluation-system/judgment-comparison/projection';
import { loadEvaluationContext } from '../usecases/evaluation-context';
import { readComparisonDataset } from '../usecases/judgment-comparison-dataset';
import { ForbiddenError } from '../usecases/project-context';
import { comparisonAccess, type ComparisonAudience } from './judge-access';

/**
 * The BOW-919 read ports. Access is real: audience and node grants are reloaded from
 * the authorization domain on every call. `loadBatch` reads the canonical batch and
 * returns it only when the viewer holds a current grant on one of its cases;
 * `projectComparison` then cuts it down to what that audience may see.
 */
export function comparisonReadPorts(
  db: DbExecutor,
  accountId: string,
  clock: Clock,
): ComparisonReadPorts {
  return {
    async loadCurrentAccess() {
      const now = clock.now().toISOString();
      try {
        const { context } = await loadEvaluationContext(db, accountId, now);
        return comparisonAccess(context);
      } catch (error) {
        // An admin, an unbound or a removed binding: no access, which the reader answers as forbidden.
        if (error instanceof ForbiddenError) return null;
        throw error;
      }
    },
    async loadBatch(batchId, access) {
      // One snapshot for canonical rows, sources and attributions.
      const data = await db.transaction(
        (tx) => readComparisonDataset(tx, batchId),
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
      if (!data) return null;
      const inScope = data.cases.some((unit) =>
        holdsCaseGrant(access, { ...unit, personId: unit.person.id }),
      );
      return inScope ? data : null;
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
