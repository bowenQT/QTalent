import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database, Transaction } from '../db/client';
import { accountBindings, grants, people } from '../modules/directory';
import { cohorts } from '../modules/programs';
import { recordAudit } from '../platform/audit';
import { loadProjectContext } from './project-context';
import { lockRuleCategory } from '../modules/evaluation-system/applicability';
import {
  authorizeSelectionAction,
  SelectionLifecycleError,
  type SelectionAuthority,
} from '../modules/evaluation-system/selection-standard';
import {
  importSelectionBaselineSnapshot,
  selectionStorageFailure,
  bindSelectionCohortFacts,
  readStoredSelectionCohortBinding,
  type SelectionBaselineSnapshot,
} from '../modules/evaluation-system/selection/postgres';

const identifier = z.string().trim().min(1).max(200);
const cohortInput = z.strictObject({
  id: identifier,
  name: z.string().trim().min(1).max(200),
});

async function transact<R>(
  db: Database,
  work: (tx: Transaction) => Promise<R>,
): Promise<R> {
  try {
    return await db.transaction(work, { isolationLevel: 'read committed' });
  } catch (error) {
    throw selectionStorageFailure(error);
  }
}

/** Current persisted identity/grants, locked before evaluating business time.
 * No session, role, directory rows or time facts are accepted from browser input. */
export async function loadSelectionAuthority(
  tx: Transaction,
  accountId: string,
  clock: () => Date,
): Promise<SelectionAuthority> {
  const [binding] = await tx
    .select()
    .from(accountBindings)
    .where(eq(accountBindings.accountId, accountId))
    .for('share');
  if (!binding || binding.isSystemAdmin)
    throw new SelectionLifecycleError('forbidden', '当前身份无法处理选拔标准');
  await tx
    .select()
    .from(grants)
    .where(eq(grants.accountId, accountId))
    .orderBy(grants.id)
    .for('share');
  await tx
    .select()
    .from(people)
    .where(eq(people.id, binding.personId))
    .for('share');
  const now = clock().toISOString();
  const data = await loadProjectContext(tx, accountId, now);
  const person = data.directory.people.find(
    (row) => row.id === binding.personId,
  );
  if (!person || data.context.account.personId !== binding.personId)
    throw new SelectionLifecycleError('forbidden', '当前账号绑定已变化');
  return { context: data.context, actor: { id: person.id, name: person.name } };
}

function authorizeCohort(authority: SelectionAuthority, cohortId: string) {
  try {
    authorizeSelectionAction(authority, 'manager');
  } catch (error) {
    if (!(error instanceof SelectionLifecycleError)) throw error;
    authorizeSelectionAction(authority, 'hr', cohortId);
  }
}
export async function readSelectionCohort(
  tx: Transaction,
  authority: SelectionAuthority,
  cohortId: string,
) {
  authorizeCohort(authority, cohortId);
  const [cohort] = await tx
    .select()
    .from(cohorts)
    .where(eq(cohorts.id, cohortId))
    .for('share');
  return cohort ?? null;
}

/** Explicit internal reviewed import only. The source snapshot/time is supplied
 * by the trusted import operator; this is not a Web action accepting a publisher.
 * Directory, period, baseline content/head and audit commit/roll back together. */
export async function initializeReviewedSelectionBaseline(
  db: Database,
  accountId: string,
  reviewed: SelectionBaselineSnapshot,
  clock: () => Date = () => new Date(),
) {
  return transact(db, async (tx) => {
    await lockRuleCategory(tx, 'xe_selection');
    const authority = await loadSelectionAuthority(tx, accountId, clock);
    authorizeSelectionAction(authority, 'manager');
    const result = await importSelectionBaselineSnapshot(
      tx,
      reviewed,
      () => new Date(authority.context.now),
    );
    if (result.created)
      await recordAudit(tx, {
        actorId: accountId,
        action: 'selection_standard.import_baseline',
        resourceId: reviewed.versionId,
      });
    return result.head;
  });
}

/** Existing cohort adoption used by the trusted923 importer. It cannot create a
 * directory cohort or request a version; actual current922 facts choose once. */
export async function bindExistingSelectionCohort(
  db: Database,
  accountId: string,
  rawCohortId: unknown,
  clock: () => Date = () => new Date(),
) {
  const cohortId = identifier.parse(rawCohortId);
  return transact(db, async (tx) => {
    await lockRuleCategory(tx, 'xe_selection');
    const authority = await loadSelectionAuthority(tx, accountId, clock);
    const cohort = await readSelectionCohort(tx, authority, cohortId);
    if (!cohort)
      throw new SelectionLifecycleError('not_found', '期次不存在或不可见');
    const result = await bindSelectionCohortFacts(
      tx,
      authority,
      cohort,
      'baseline_import',
    );
    if (result.created)
      await recordAudit(tx, {
        actorId: accountId,
        action: 'selection_standard.bind_cohort',
        resourceId: cohortId,
      });
    return result.binding;
  });
}

/** Minimal real cohort creation and first adoption, serialized with publication.
 * It does not implement the selection workflow or fabricate historical cohorts. */
export async function createSelectionCohort(
  db: Database,
  accountId: string,
  raw: unknown,
  clock: () => Date = () => new Date(),
) {
  const input = cohortInput.parse(raw);
  return transact(db, async (tx) => {
    await lockRuleCategory(tx, 'xe_selection');
    const authority = await loadSelectionAuthority(tx, accountId, clock);
    authorizeSelectionAction(authority, 'manager');
    const old = await readSelectionCohort(tx, authority, input.id);
    if (old && old.name !== input.name)
      throw new SelectionLifecycleError('conflict', '期次已存在且名称不一致');
    if (old) {
      const saved = await readStoredSelectionCohortBinding(tx, old.id);
      if (!saved)
        throw new SelectionLifecycleError(
          'conflict',
          '已有期次缺少创建时绑定，不能按当前版本补写',
        );
      return saved;
    }
    await tx.insert(cohorts).values(input);
    const result = await bindSelectionCohortFacts(tx, authority, input);
    if (result.created)
      await recordAudit(tx, {
        actorId: accountId,
        action: 'selection_standard.create_cohort',
        resourceId: input.id,
      });
    return result.binding;
  });
}

/** Reads only persisted adoption; never substitutes the current default version. */
export async function readNativeSelectionCohortVersion(
  db: Database,
  accountId: string,
  rawCohortId: unknown,
  clock: () => Date = () => new Date(),
) {
  const cohortId = identifier.parse(rawCohortId);
  return transact(db, async (tx) => {
    const authority = await loadSelectionAuthority(tx, accountId, clock);
    const cohort = await readSelectionCohort(tx, authority, cohortId);
    if (!cohort)
      throw new SelectionLifecycleError('not_found', '期次不存在或不可见');
    return readStoredSelectionCohortBinding(tx, cohort.id);
  });
}
