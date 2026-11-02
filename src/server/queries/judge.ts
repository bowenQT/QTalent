import 'server-only';
import { eq } from 'drizzle-orm';
import type {
  ComparisonHrPage,
  ComparisonManagerPage,
  ComparisonRaterPage,
} from '../../contracts/judgment-comparison';
import type {
  ConfirmedStandardAttribution,
  StandardAttributionHypothesis,
} from '../../contracts/standard-attribution';
import type { z } from 'zod';
import type { selectionStandardContentSchema } from '../../contracts/selection-standard';
import { createClock, type Clock } from '../../lib/clock';
import { requireSession } from '../auth/next';
import {
  getDatabase,
  type Database,
  type DbExecutor,
  type Transaction,
} from '../db/client';
import { getEnv } from '../env';
import { people, readDirectory } from '../modules/directory';
import { readEffectiveRuleVersion } from '../modules/evaluation-system';
import type { ComparisonReadPorts } from '../modules/evaluation-system/judgment-comparison/ports';
import { readJudgmentComparison } from '../modules/evaluation-system/judgment-comparison/read';
import { readCurrentSelectionStandard } from '../modules/evaluation-system/selection/postgres';
import { loadEvaluationContext } from '../usecases/evaluation-context';
import {
  listComparisonBatches,
  readComparisonDataset,
} from '../usecases/judgment-comparison-dataset';
import { ForbiddenError } from '../usecases/project-context';
import { readBatchAttributionState } from '../usecases/standard-attribution/batch-state';
import {
  comparisonAccess,
  comparisonCohortIds,
  type ComparisonAudience,
} from './judge-access';

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
      const now = Date.parse(access.now);
      const inScope = data.cases.some((unit) =>
        access.grants.some(
          (grant) =>
            grant.personId === unit.person.id &&
            (grant.nodeId === unit.frontNodeId ||
              grant.nodeId === unit.backNodeId) &&
            Date.parse(grant.validFrom) <= now &&
            (grant.validUntil === null || now < Date.parse(grant.validUntil)),
        ),
      );
      return inScope ? data : null;
    },
  };
}

export type JudgePage =
  | { status: 'admin' }
  | { status: 'forbidden' }
  | { status: 'not_found' }
  /** The viewer may read comparisons, but no batch in their scope is stored. */
  | { status: 'empty'; audience: ComparisonAudience }
  | {
      status: 'hr';
      page: ComparisonHrPage;
      standard: {
        versionId: string;
        content: z.infer<typeof selectionStandardContentSchema>;
      } | null;
      hypotheses: StandardAttributionHypothesis[];
      attributions: ConfirmedStandardAttribution[];
    }
  | {
      status: 'hr_rater';
      page: ComparisonHrPage;
      evaluatorId: string;
      batchNames: Record<string, string>;
    }
  | {
      status: 'rater';
      page: ComparisonRaterPage;
      raterName: string;
      batchNames: Record<string, string>;
    }
  | { status: 'manager'; page: ComparisonManagerPage };

type ReadPage = Extract<
  Awaited<ReturnType<typeof readJudgmentComparison>>,
  { status: 'success' }
>['page'];

async function currentStandard(tx: Transaction, now: Date) {
  const effective = await readEffectiveRuleVersion(
    tx,
    { category: 'xe_selection', at: now.toISOString() },
    () => now,
  );
  if (effective.status !== 'success') return null;
  const current = await readCurrentSelectionStandard(
    tx,
    effective.version.versionId,
    () => now,
  );
  return current
    ? { versionId: current.version.versionId, content: current.content }
    : null;
}

async function readFor(
  db: Database,
  accountId: string,
  clock: Clock,
  rater: string | null,
): Promise<JudgePage> {
  const now = clock.now().toISOString();
  let context;
  try {
    ({ context } = await loadEvaluationContext(db, accountId, now));
  } catch (error) {
    if (error instanceof ForbiddenError) return { status: 'forbidden' };
    throw error;
  }
  const access = comparisonAccess(context);
  if (!access) return { status: 'forbidden' };
  const batches = await db.transaction(
    (tx) => listComparisonBatches(tx, comparisonCohortIds(context, access)),
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
  const ports = comparisonReadPorts(db, accountId, clock);
  const pages: ReadPage[] = [];
  for (const batch of batches) {
    const result = await readJudgmentComparison(
      {
        batchId: batch.id,
        ...(access.audience === 'rater'
          ? { evaluatorId: access.viewerId }
          : {}),
      },
      ports,
    );
    if (result.status === 'success') pages.push(result.page);
    else if (result.status === 'forbidden') return { status: 'forbidden' };
    else if (result.status === 'validation_error')
      throw new Error('Stored comparison facts failed validation');
  }
  const batchNames = Object.fromEntries(batches.map((b) => [b.id, b.name]));
  const [first] = pages;
  if (!first) return { status: 'empty', audience: access.audience };
  if (first.audience === 'manager')
    return {
      status: 'manager',
      page: {
        ...first,
        batches: pages.flatMap((page) =>
          page.audience === 'manager' ? page.batches : [],
        ),
      },
    };
  if (first.audience === 'rater') {
    const [viewer] = await db
      .select({ name: people.name })
      .from(people)
      .where(eq(people.id, access.viewerId));
    if (!viewer) return { status: 'forbidden' };
    return { status: 'rater', page: first, raterName: viewer.name, batchNames };
  }
  if (rater !== null)
    return first.raters.some((entry) => entry.evaluator.id === rater)
      ? { status: 'hr_rater', page: first, evaluatorId: rater, batchNames }
      : { status: 'not_found' };
  const { standard, state } = await db.transaction(
    async (tx) => ({
      standard: await currentStandard(tx, clock.now()),
      state: await readBatchAttributionState(
        tx,
        first.batch.id,
        accountId,
        now,
      ),
    }),
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
  return {
    status: 'hr',
    page: first,
    standard,
    hypotheses: state?.hypotheses ?? [],
    attributions: state?.attributions ?? [],
  };
}

/**
 * /judge and /judge?rater=…. Who may read, in which audience and which batches
 * is decided on the server; a mentor always reads their own judgments, HR may
 * open one rater of the batch.
 */
export async function getJudgePage(
  rater: string | null = null,
): Promise<JudgePage> {
  const session = await requireSession();
  const db = getDatabase();
  // A system admin has no talent context to load; the page explains the boundary.
  const directory = await readDirectory(db, session.user.id);
  if (directory?.account.isSystemAdmin) return { status: 'admin' };
  return readFor(
    db,
    session.user.id,
    createClock(getEnv().APP_ENV),
    rater === 'me' ? null : rater,
  );
}
