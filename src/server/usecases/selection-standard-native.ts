import { createHash } from 'node:crypto';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database, Transaction } from '../db/client';
import { accountBindings, grants, people } from '../modules/directory';
import { cohorts } from '../modules/programs';
import { recordAudit } from '../platform/audit';
import { ForbiddenError, loadProjectContext } from './project-context';
import { lockRuleCategory } from '../modules/evaluation-system/applicability';
import { activeGrants } from '../authz';
import {
  authorizeSelectionAction,
  projectSelectionManagerRevision,
  SelectionLifecycleError,
  type SelectionAuthority,
} from '../modules/evaluation-system/selection-standard';
import {
  selectionRevisions,
  selectionVersionContents,
} from '../modules/evaluation-system/selection/schema';
import {
  importSelectionBaselineSnapshot,
  createSelectionPostgresStore,
  selectionStorageFailure,
  bindSelectionCohortFacts,
  readStoredSelectionCohortBinding,
  readCurrentSelectionStandard,
  type SelectionBaselineSnapshot,
} from '../modules/evaluation-system/selection/postgres';

import {
  assertSelectionBasisDisclosed,
  readNativeSelectionCreationFacts,
  readNativeSelectionImpact,
  readNativeSelectionProposal,
  type ReviewedNextSelectionCohort,
} from './selection-standard-facts';
import { executeSelectionRevision } from './selection-standard';
import {
  createSelectionRevisionInputSchema,
  selectionStandardContentSchema,
  type EffectiveRuleVersion,
  type SelectionManagerRevision,
  type SelectionRevision,
} from '../../contracts/selection-standard';

type SelectionStandardContent = z.infer<typeof selectionStandardContentSchema>;
/** What /rules shows: the standard in force, or the revision this viewer works on. */
export type SelectionStandardPage =
  | { status: 'forbidden' }
  | { status: 'not_found' }
  | { status: 'none' }
  | {
      status: 'current';
      audience: 'hr' | 'manager';
      version: EffectiveRuleVersion;
      content: SelectionStandardContent;
    }
  | {
      status: 'revision';
      base: SelectionStandardContent;
      view:
        | { audience: 'hr'; revision: SelectionRevision }
        | { audience: 'manager'; revision: SelectionManagerRevision };
    };

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
  /** Optional caller check of the resulting binding, run in the same
   * transaction under the category lock; throwing rolls the binding back. */
  verify?: (tx: Transaction) => Promise<void>,
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
    await verify?.(tx);
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

/** Actual production composition. Only reviewed future-cohort metadata is an
 * explicit server input; directory, authorization, canonical, attribution,
 * proposal, standard and impact facts are all read from this live transaction. */
export function createNativeSelectionLifecycle(
  db: Database,
  options: {
    nextCohort: ReviewedNextSelectionCohort | null;
    clock?: () => Date;
  },
) {
  const clock = options.clock ?? (() => new Date());
  // Freeze server configuration so a retained browser/request object cannot
  // mutate a preview source between calls. No fallback future cohort exists.
  const next = options.nextCohort
    ? Object.freeze({ ...options.nextCohort })
    : null;
  function compose(proposalId?: string) {
    return createSelectionPostgresStore(db, {
      async loadAuthority(tx, accountId, at) {
        const mode = await tx.execute<{ readOnly: string }>(
          sql`select current_setting('transaction_read_only') as "readOnly"`,
        );
        if (mode.rows[0]?.readOnly === 'off')
          return loadSelectionAuthority(tx, accountId, () => new Date(at));
        const data = await loadProjectContext(tx, accountId, at).catch(
          (error: unknown) => {
            if (error instanceof ForbiddenError)
              throw new SelectionLifecycleError(
                'forbidden',
                '当前身份无法读取选拔标准',
              );
            throw error;
          },
        );
        const actor = data.directory.people.find(
          (person) => person.id === data.context.account.personId,
        );
        if (!actor)
          throw new SelectionLifecycleError('forbidden', '当前人员绑定不存在');
        return {
          context: data.context,
          actor: { id: actor.id, name: actor.name },
        };
      },
      async creationFacts(tx, authority, input) {
        if (proposalId !== undefined) {
          const result = await readNativeSelectionProposal(
            tx,
            authority,
            proposalId,
            input,
            next,
          );
          return { ...result.facts, aiDraft: result.proposal.aiDraft };
        }
        return readNativeSelectionCreationFacts(tx, authority, input, next);
      },
      verifyBasisDisclosure: assertSelectionBasisDisclosed,
      async readImpact(tx, authority, record) {
        const saved = record.revision.impactPreview;
        if (
          !next ||
          next.id !== saved.nextCohort.id ||
          next.name !== saved.nextCohort.name
        )
          throw new SelectionLifecycleError('conflict', '下一期事实已变化');
        return readNativeSelectionImpact(tx, authority, next, [
          ...new Set([
            record.scopeCohortId,
            ...saved.existingResults.map((row) => row.cohortId),
            ...saved.preservedBindings.map((row) => row.cohort.id),
          ]),
        ]);
      },
      async readCohort(tx, authority, cohortId) {
        authorizeCohort(authority, cohortId);
        return (
          (
            await tx.select().from(cohorts).where(eq(cohorts.id, cohortId))
          )[0] ?? null
        );
      },
    });
  }
  const store = compose();
  /** HR works on an open draft or a submitted one (to withdraw it); the manager
   * only sees a revision once it waits for confirmation. */
  function shown(
    record: Awaited<ReturnType<typeof store.ports.readRevision>>,
    manager: boolean,
  ) {
    if (!record) return false;
    return manager
      ? record.revision.state === 'pending_confirmation'
      : ['draft', 'pending_confirmation'].includes(record.revision.state);
  }
  return {
    store,
    /**
     * /rules?r=front&line=xe-select[&draft=]. Identity and scope are the server's;
     * without a draft id the open revision of the category is found here, the
     * way the prototype shows it on the standard page.
     */
    async readPage(
      accountId: string,
      draftId: string | null,
    ): Promise<SelectionStandardPage> {
      try {
        return await store.ports.read(async (tx) => {
          const now = clock().toISOString();
          const authority = await store.ports.loadAuthority(tx, accountId, now);
          const roles = activeGrants(authority.context).map((g) => g.role);
          const manager = roles.includes('manager');
          if (!manager && !roles.includes('hr')) return { status: 'forbidden' };
          const purpose = manager ? 'manager' : 'hr';
          let id = draftId === null ? null : identifier.parse(draftId);
          if (id === null) {
            const [open] = await tx.db
              .select({ id: selectionRevisions.id })
              .from(selectionRevisions)
              .where(
                inArray(
                  selectionRevisions.state,
                  manager
                    ? ['pending_confirmation']
                    : ['draft', 'pending_confirmation'],
                ),
              )
              .orderBy(desc(selectionRevisions.updatedAt))
              .limit(1);
            id = open?.id ?? null;
          }
          if (id !== null) {
            let record: Awaited<ReturnType<typeof store.ports.readRevision>>;
            try {
              record = await store.ports.readRevision(tx, id, purpose);
            } catch (error) {
              // An open revision outside this HR's cohorts is not theirs to open.
              if (
                !(error instanceof SelectionLifecycleError) ||
                draftId !== null
              )
                throw error;
              record = null;
            }
            if (!record && draftId !== null) return { status: 'not_found' };
            if (record && shown(record, manager)) {
              const [base] = await tx.db
                .select({ content: selectionVersionContents.content })
                .from(selectionVersionContents)
                .where(
                  eq(
                    selectionVersionContents.versionId,
                    record.revision.baseVersionId,
                  ),
                );
              if (!base)
                throw new SelectionLifecycleError('conflict', '基准版本不存在');
              return {
                status: 'revision',
                base: selectionStandardContentSchema.parse(base.content),
                view: manager
                  ? {
                      audience: 'manager',
                      revision: projectSelectionManagerRevision(record),
                    }
                  : { audience: 'hr', revision: record.revision },
              };
            }
          }
          const effective = await store.ports.readEffectiveRuleVersion(
            tx,
            { category: 'xe_selection', at: now },
            () => new Date(now),
          );
          if (effective.status === 'not_found') return { status: 'none' };
          if (effective.status !== 'success')
            throw new SelectionLifecycleError('conflict', effective.message);
          const current = await readCurrentSelectionStandard(
            tx.db,
            effective.version.versionId,
            () => new Date(now),
          );
          if (!current) return { status: 'not_found' };
          return {
            status: 'current',
            audience: purpose,
            version: current.version,
            content: current.content,
          };
        });
      } catch (error) {
        if (
          error instanceof SelectionLifecycleError &&
          error.status === 'forbidden'
        )
          return { status: 'forbidden' };
        throw error;
      }
    },
    execute: (accountId: string, command: unknown) =>
      executeSelectionRevision(store.ports, accountId, command, clock),
    async adoptProposal(accountId: string, proposalId: string, raw: unknown) {
      const proposal = identifier.parse(proposalId);
      const input = createSelectionRevisionInputSchema.parse(raw);
      const operationId = createHash('sha256')
        .update(
          JSON.stringify(['selection-proposal', proposal, input.operationId]),
        )
        .digest('hex');
      return executeSelectionRevision(
        compose(proposal).ports,
        accountId,
        { action: 'create', input: { ...input, operationId } },
        clock,
      );
    },
  };
}
