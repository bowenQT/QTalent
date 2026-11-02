import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  selectionRevisionSchema,
  selectionStandardContentSchema,
  selectionPublicationReceiptSchema,
  selectionPublicationUndoTransactionSchema,
  selectionCohortBindingSchema,
  effectiveRuleVersionSchema,
  createSelectionRevisionResultSchema,
  saveSelectionRevisionResultSchema,
  submitSelectionRevisionResultSchema,
  withdrawSelectionRevisionResultSchema,
  returnSelectionRevisionResultSchema,
  publishSelectionRevisionResultSchema,
  undoSelectionPublicationResultSchema,
  type SelectionCohortBinding,
} from '../../../../contracts/selection-standard';
import {
  comparisonActorSchema,
  comparisonManagerBasisSchema,
  selectionVersionIdSchema,
} from '../../../../contracts/judgment-comparison';
import type { Database, Transaction } from '../../../db/client';
import { recordAudit } from '../../../platform/audit';
import type {
  SelectionStandardPorts,
  SelectionOperation,
  SelectionRevisionCommand,
  SelectionRevisionPersistencePlan,
} from '../../../usecases/selection-standard';
import {
  authorizeSelectionAction,
  planSelectionCohortBinding,
  projectSelectionManagerRevision,
  SelectionLifecycleError,
  type SelectionAuthority,
  type SelectionRevisionRecord,
} from '../selection-standard';
import { readEffectiveRuleVersion } from '../effective-version';
import {
  lockRuleCategory,
  switchSelectionApplicability,
  RuleApplicabilityConflictError,
} from '../applicability';
import { ruleVersions, ruleVersionApplicability } from '../schema';
import {
  selectionRevisions,
  selectionVersionContents,
  selectionPublications,
  selectionCategoryHeads,
  selectionCohortBindings,
  selectionOperations,
} from './schema';

const text = z.string().trim().min(1).max(2000);
const recordSchema = z
  .strictObject({
    revision: selectionRevisionSchema,
    scopeCohortId: text,
    baseContent: selectionStandardContentSchema,
    content: selectionStandardContentSchema.nullable(),
    contentWasPublished: z.boolean(),
    managerBasis: z.array(comparisonManagerBasisSchema).min(1),
    submission: z
      .strictObject({
        submittedBy: comparisonActorSchema,
        submittedAt: z.iso.datetime(),
      })
      .nullable(),
  })
  .refine((record) =>
    record.revision.humanVersion === null
      ? record.content === null
      : record.content !== null,
  )
  .refine((record) => !record.contentWasPublished || record.content !== null);
const actionSchema = z.enum([
  'create',
  'save',
  'submit',
  'withdraw',
  'return',
  'publish',
  'undo',
]);
const results = {
  create: createSelectionRevisionResultSchema,
  save: saveSelectionRevisionResultSchema,
  submit: submitSelectionRevisionResultSchema,
  withdraw: withdrawSelectionRevisionResultSchema,
  return: returnSelectionRevisionResultSchema,
  publish: publishSelectionRevisionResultSchema,
  undo: undoSelectionPublicationResultSchema,
};
type Head = typeof selectionCategoryHeads.$inferSelect;
type RevisionRow = typeof selectionRevisions.$inferSelect;
type Action = SelectionRevisionCommand['action'];
type Effect =
  | { kind: 'revision'; action: Action; record: SelectionRevisionRecord }
  | { kind: 'publish'; record: SelectionRevisionRecord; receipt: unknown }
  | { kind: 'undo'; record: SelectionRevisionRecord; receipt: unknown }
  | { kind: 'binding'; binding: SelectionCohortBinding };
declare const transactionBrand: unique symbol;
/** Only issued inside this store's live transaction. db is for a same-tx cohort creator. */
export type SelectionPostgresTransaction = Readonly<{
  db: Transaction;
  [transactionBrand]: true;
}>;
type State = {
  active: boolean;
  write: boolean;
  head: Head | null;
  lock: { accountId: string; operationId: string } | null;
  authority: SelectionAuthority | null;
  loaded: Map<string, RevisionRow>;
  effect: Effect | null;
  auditedAction: Action | 'bind_cohort' | null;
  operationWritten: boolean;
  reservedVersionId: string | null;
};
export class SelectionPersistenceUnavailableError extends Error {
  readonly kind = 'unavailable';
  constructor(readonly databaseCode: string | null = null) {
    super('Selection persistence unavailable');
    this.name = 'SelectionPersistenceUnavailableError';
  }
}
function conflict(): never {
  throw new SelectionLifecycleError(
    'conflict',
    '选拔标准或事务版本已变化，请刷新后重试',
  );
}
export function selectionStorageFailure(error: unknown): Error {
  if (
    error instanceof SelectionLifecycleError ||
    error instanceof SelectionPersistenceUnavailableError
  )
    return error;
  if (error instanceof RuleApplicabilityConflictError)
    return new SelectionLifecycleError('conflict', '规则生效区段已变化');
  const raw = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const value = raw?.cause?.code ?? raw?.code;
  const code =
    typeof value === 'string' && /^[0-9A-Z]{5}$/.test(value) ? value : null;
  if (code && ['23505', '23503', '40001', '40P01'].includes(code))
    return new SelectionLifecycleError(
      'conflict',
      '对象或版本已变化，请刷新后重试',
    );
  return new SelectionPersistenceUnavailableError(code);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
function same(left: unknown, right: unknown) {
  return canonical(left) === canonical(right);
}
function scope(record: SelectionRevisionRecord) {
  return [
    ...new Set([
      record.scopeCohortId,
      record.revision.impactPreview.nextCohort.id,
      ...record.revision.impactPreview.existingResults.map(
        (item) => item.cohortId,
      ),
      ...record.revision.impactPreview.preservedBindings.map(
        (item) => item.cohort.id,
      ),
    ]),
  ];
}
function compareBindings(a: SelectionCohortBinding, b: SelectionCohortBinding) {
  return a.cohort.id < b.cohort.id ? -1 : a.cohort.id > b.cohort.id ? 1 : 0;
}
function role(action: Action) {
  return ['return', 'publish', 'undo'].includes(action)
    ? ('manager' as const)
    : ('hr' as const);
}
function checkAuthority(
  authority: SelectionAuthority,
  accountId: string,
  now: string,
) {
  if (
    !z.iso.datetime().safeParse(now).success ||
    !comparisonActorSchema.safeParse(authority.actor).success ||
    !authority.context.account.personId.trim() ||
    authority.context.account.id !== accountId ||
    authority.context.account.isSystemAdmin ||
    authority.actor.id !== authority.context.account.personId ||
    Date.parse(authority.context.now) !== Date.parse(now)
  )
    throw new SelectionLifecycleError('forbidden', '当前身份无法处理此请求');
}
function authorizeRecord(
  authority: SelectionAuthority,
  record: SelectionRevisionRecord,
) {
  try {
    authorizeSelectionAction(authority, 'manager');
  } catch (error) {
    if (!(error instanceof SelectionLifecycleError)) throw error;
    for (const cohortId of scope(record))
      authorizeSelectionAction(authority, 'hr', cohortId);
  }
}
function unpack(row: RevisionRow): SelectionRevisionRecord {
  const record = recordSchema.parse(row.record);
  if (
    record.revision.id !== row.id ||
    record.revision.versionId !== row.versionId ||
    record.revision.baseVersionId !== row.baseVersionId ||
    record.scopeCohortId !== row.scopeCohortId ||
    record.revision.state !== row.state ||
    record.revision.revision !== row.revision ||
    record.revision.contentRevision !== row.contentRevision ||
    record.contentWasPublished !== row.contentWasPublished
  )
    throw new SelectionPersistenceUnavailableError();
  return record;
}
function values(record: SelectionRevisionRecord, now: string) {
  return {
    id: record.revision.id,
    versionId: record.revision.versionId,
    baseVersionId: record.revision.baseVersionId,
    scopeCohortId: record.scopeCohortId,
    state: record.revision.state,
    revision: record.revision.revision,
    contentRevision: record.revision.contentRevision,
    contentWasPublished: record.contentWasPublished,
    record,
    updatedAt: new Date(now),
  };
}
type CreateFacts = Awaited<
  ReturnType<
    SelectionStandardPorts<SelectionPostgresTransaction>['creationFacts']
  >
>;
const basisDisclosureSchema = z.strictObject({
  citations: z.array(
    z.strictObject({ caseId: text, side: z.enum(['front', 'back']) }),
  ),
});
export type SelectionBasisDisclosure = z.infer<typeof basisDisclosureSchema>;
/** Mandatory current server readers, implemented outside this private storage module.
 * No admin/allow-all/in-memory production defaults and no Next session dependencies.
 */
export interface SelectionPostgresServices {
  loadAuthority(
    tx: Transaction,
    accountId: string,
    now: string,
  ): Promise<SelectionAuthority>;
  creationFacts(
    tx: Transaction,
    authority: SelectionAuthority,
    input: Parameters<
      SelectionStandardPorts<SelectionPostgresTransaction>['creationFacts']
    >[2],
  ): Promise<Omit<CreateFacts, 'baseContent'>>;
  /** Re-check every citation against the caller's current access and return
   * each one verified, in basis order; throw forbidden when one is not. */
  verifyBasisDisclosure(
    tx: Transaction,
    authority: SelectionAuthority,
    basis: SelectionRevisionRecord['revision']['basis'],
  ): Promise<SelectionBasisDisclosure>;
  readImpact(
    tx: Transaction,
    authority: SelectionAuthority,
    record: SelectionRevisionRecord,
  ): Promise<CreateFacts['impact']>;
  readCohort(
    tx: Transaction,
    authority: SelectionAuthority,
    cohortId: string,
  ): Promise<SelectionCohortBinding['cohort'] | null>;
}
async function readCurrentSelectionVersion(
  tx: Transaction,
  current: Head,
  now: string,
) {
  const result = await readEffectiveRuleVersion(
    tx,
    { category: 'xe_selection', at: now },
    () => new Date(now),
  );
  if (result.status !== 'success')
    throw new SelectionLifecycleError(result.status, result.message);
  const period = (
    await tx
      .select()
      .from(ruleVersionApplicability)
      .where(eq(ruleVersionApplicability.periodId, current.currentPeriodId))
  )[0];
  if (
    !period ||
    current.versionId !== result.version.versionId ||
    period.category !== 'xe_selection' ||
    period.versionId !== current.versionId ||
    period.effectiveFrom.toISOString() !== result.version.effectiveFrom ||
    period.effectiveUntil !== null ||
    result.version.effectiveUntil !== null
  )
    conflict();
  return result.version;
}

function unpackBinding(row: typeof selectionCohortBindings.$inferSelect) {
  const binding = selectionCohortBindingSchema.parse(row.binding);
  if (
    binding.cohort.id !== row.cohortId ||
    binding.standardVersionId !== row.versionId ||
    Date.parse(binding.boundAt) !== row.boundAt.getTime()
  )
    throw new SelectionPersistenceUnavailableError();
  return binding;
}

export function createSelectionPostgresStore(
  db: Database,
  services: SelectionPostgresServices,
) {
  for (const name of [
    'loadAuthority',
    'creationFacts',
    'verifyBasisDisclosure',
    'readImpact',
    'readCohort',
  ] as const)
    if (typeof services[name] !== 'function')
      throw new SelectionPersistenceUnavailableError();
  const contexts = new WeakMap<SelectionPostgresTransaction, State>();
  function state(tx: SelectionPostgresTransaction, write = false) {
    const value = tx && contexts.get(tx);
    if (!value?.active || (write && !value.write))
      throw new SelectionPersistenceUnavailableError();
    return value;
  }
  function authority(tx: SelectionPostgresTransaction) {
    const current = state(tx).authority;
    if (!current) throw new SelectionPersistenceUnavailableError();
    return current;
  }
  function head(tx: SelectionPostgresTransaction) {
    const current = state(tx, true).head;
    if (!current)
      throw new SelectionLifecycleError(
        'conflict',
        '选拔标准基线尚未显式初始化',
      );
    return current;
  }
  async function transact<R>(
    lock: State['lock'],
    work: (tx: SelectionPostgresTransaction) => Promise<R>,
    write: boolean,
  ): Promise<R> {
    try {
      return await db.transaction(
        async (native) => {
          let currentHead: Head | null = null;
          if (write) {
            if (!lock) throw new SelectionPersistenceUnavailableError();
            await lockRuleCategory(native, 'xe_selection');
            await native.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${'qtalent:selection-operation:' + JSON.stringify([lock.accountId, lock.operationId])}, 0))`,
            );
            currentHead =
              (
                await native
                  .select()
                  .from(selectionCategoryHeads)
                  .where(eq(selectionCategoryHeads.category, 'xe_selection'))
                  .for('update')
              )[0] ?? null;
            if (currentHead?.currentRevisionId) {
              const old = await native
                .select({
                  id: selectionRevisions.id,
                  versionId: selectionRevisions.versionId,
                  state: selectionRevisions.state,
                })
                .from(selectionRevisions)
                .where(eq(selectionRevisions.id, currentHead.currentRevisionId))
                .for('update');
              if (
                old.length !== 1 ||
                old[0].versionId !== currentHead.versionId ||
                old[0].state !== 'active'
              )
                conflict();
            }
          }
          const tx = Object.freeze({
            db: native,
          }) as SelectionPostgresTransaction;
          const current: State = {
            active: true,
            write,
            head: currentHead,
            lock,
            authority: null,
            loaded: new Map(),
            effect: null,
            auditedAction: null,
            operationWritten: false,
            reservedVersionId: null,
          };
          contexts.set(tx, current);
          try {
            const result = await work(tx);
            if (
              write &&
              ((current.effect !== null &&
                (current.auditedAction === null ||
                  (current.effect.kind !== 'binding' &&
                    !current.operationWritten))) ||
                (current.reservedVersionId !== null &&
                  !current.operationWritten))
            )
              throw new SelectionPersistenceUnavailableError();
            return result;
          } finally {
            current.active = false;
          }
        },
        {
          isolationLevel: 'read committed',
          accessMode: write ? 'read write' : 'read only',
        },
      );
    } catch (error) {
      throw selectionStorageFailure(error);
    }
  }
  async function record(tx: SelectionPostgresTransaction, id: string) {
    const current = state(tx);
    const who = authority(tx);
    const query = tx.db
      .select()
      .from(selectionRevisions)
      .where(eq(selectionRevisions.id, id));
    const row = (await (current.write ? query.for('update') : query))[0];
    if (!row) return null;
    const parsed = unpack(row);
    authorizeRecord(who, parsed);
    current.loaded.set(id, row);
    return parsed;
  }
  /** A stored signature or receipt is not a current grant to its citations. A
   * malformed or empty verifier result is an installation fault, not consent. */
  async function assertDisclosed(
    tx: SelectionPostgresTransaction,
    basis: SelectionRevisionRecord['revision']['basis'],
  ) {
    const result = basisDisclosureSchema.safeParse(
      await services.verifyBasisDisclosure(tx.db, authority(tx), basis),
    );
    if (!result.success) throw new SelectionPersistenceUnavailableError();
    if (
      !same(
        result.data.citations,
        basis.citations.map(({ caseId, side }) => ({ caseId, side })),
      )
    )
      throw new SelectionLifecycleError(
        'forbidden',
        '归因引用不在当前授权范围或来源已变化',
      );
  }
  async function content(tx: SelectionPostgresTransaction, versionId: string) {
    state(tx);
    const row = (
      await tx.db
        .select()
        .from(selectionVersionContents)
        .where(eq(selectionVersionContents.versionId, versionId))
    )[0];
    if (!row) conflict();
    return selectionStandardContentSchema.parse(row.content);
  }
  async function currentVersion(tx: SelectionPostgresTransaction) {
    return readCurrentSelectionVersion(
      tx.db,
      head(tx),
      authority(tx).context.now,
    );
  }
  async function putRecord(
    tx: SelectionPostgresTransaction,
    input: SelectionRevisionRecord,
    publish = false,
  ) {
    const current = state(tx, true);
    const next = recordSchema.parse(input);
    authorizeRecord(authority(tx), next);
    const previous = await record(tx, next.revision.id);
    if (
      previous?.contentWasPublished &&
      (!same(next.revision.humanVersion, previous.revision.humanVersion) ||
        next.revision.reason !== previous.revision.reason ||
        next.revision.contentRevision !== previous.revision.contentRevision ||
        !same(next.revision.impactPreview, previous.revision.impactPreview))
    )
      conflict();
    if (!previous) {
      if (current.reservedVersionId !== next.revision.versionId) conflict();
      if (
        next.revision.revision !== 1 ||
        next.contentWasPublished ||
        next.revision.state !== 'draft'
      )
        conflict();
      if (
        (
          await tx.db
            .select({ id: ruleVersions.id })
            .from(ruleVersions)
            .where(eq(ruleVersions.id, next.revision.versionId))
        ).length
      )
        conflict();
      await tx.db
        .insert(selectionRevisions)
        .values(values(next, authority(tx).context.now));
    } else {
      if (
        next.revision.revision !== previous.revision.revision + 1 ||
        next.revision.versionId !== previous.revision.versionId ||
        next.revision.baseVersionId !== previous.revision.baseVersionId ||
        next.scopeCohortId !== previous.scopeCohortId ||
        !same(next.baseContent, previous.baseContent) ||
        !same(next.managerBasis, previous.managerBasis) ||
        !same(next.revision.basis, previous.revision.basis) ||
        !same(next.revision.aiDraft, previous.revision.aiDraft) ||
        (previous.contentWasPublished &&
          (!next.contentWasPublished ||
            !same(next.content, previous.content))) ||
        (!previous.contentWasPublished && next.contentWasPublished && !publish)
      )
        conflict();
      const updated = await tx.db
        .update(selectionRevisions)
        .set(values(next, authority(tx).context.now))
        .where(
          and(
            eq(selectionRevisions.id, previous.revision.id),
            eq(selectionRevisions.revision, previous.revision.revision),
            eq(selectionRevisions.state, previous.revision.state),
            eq(selectionRevisions.versionId, previous.revision.versionId),
            eq(
              selectionRevisions.contentWasPublished,
              previous.contentWasPublished,
            ),
          ),
        )
        .returning({ id: selectionRevisions.id });
      if (updated.length !== 1) conflict();
    }
    current.loaded.delete(next.revision.id);
    return next;
  }
  async function changeHead(
    tx: SelectionPostgresTransaction,
    before: Head,
    next: {
      versionId: string;
      periodId: string;
      revisionId: string | null;
      publicationId: string | null;
    },
  ) {
    const updated = await tx.db
      .update(selectionCategoryHeads)
      .set({
        versionId: next.versionId,
        currentPeriodId: next.periodId,
        currentRevisionId: next.revisionId,
        currentPublicationId: next.publicationId,
        generation: before.generation + 1,
      })
      .where(
        and(
          eq(selectionCategoryHeads.category, 'xe_selection'),
          eq(selectionCategoryHeads.generation, before.generation),
          eq(selectionCategoryHeads.versionId, before.versionId),
          eq(selectionCategoryHeads.currentPeriodId, before.currentPeriodId),
          before.currentRevisionId === null
            ? isNull(selectionCategoryHeads.currentRevisionId)
            : eq(
                selectionCategoryHeads.currentRevisionId,
                before.currentRevisionId,
              ),
          before.currentPublicationId === null
            ? isNull(selectionCategoryHeads.currentPublicationId)
            : eq(
                selectionCategoryHeads.currentPublicationId,
                before.currentPublicationId,
              ),
        ),
      )
      .returning();
    if (updated.length !== 1) conflict();
    state(tx, true).head = updated[0];
  }
  function checkSwitch(
    tx: SelectionPostgresTransaction,
    change: Extract<
      SelectionRevisionPersistencePlan,
      { kind: 'publish' }
    >['publication']['categorySwitch'],
  ) {
    const current = head(tx);
    if (
      change.category !== 'xe_selection' ||
      change.expectedVersionId !== current.versionId ||
      change.deactivateVersionId !== current.versionId ||
      change.expectedPublicationId !== current.currentPublicationId ||
      Date.parse(change.at) !== Date.parse(authority(tx).context.now)
    )
      conflict();
    return current;
  }
  async function persist(
    tx: SelectionPostgresTransaction,
    plan: SelectionRevisionPersistencePlan,
  ) {
    const current = state(tx, true);
    if (current.effect !== null)
      throw new SelectionPersistenceUnavailableError();
    if (plan.kind === 'revision') {
      const next = recordSchema.parse(plan.record);
      const prior = await record(tx, next.revision.id);
      const who = authority(tx);
      let action: Action;
      if (prior === null) action = 'create';
      else if (
        prior.revision.state === 'draft' &&
        next.revision.state === 'draft'
      )
        action = 'save';
      else if (
        prior.revision.state === 'draft' &&
        next.revision.state === 'pending_confirmation'
      )
        action = 'submit';
      else if (
        prior.revision.state === 'pending_confirmation' &&
        next.revision.state === 'draft'
      )
        action = next.revision.lastReturn === null ? 'withdraw' : 'return';
      else conflict();
      for (const cohortId of scope(next))
        authorizeSelectionAction(who, role(action), cohortId);
      if (
        action === 'save' &&
        (!prior ||
          next.revision.contentRevision !==
            prior.revision.contentRevision + 1 ||
          next.revision.humanVersion?.editedBy.id !== who.actor.id ||
          Date.parse(next.revision.humanVersion.editedAt) !==
            Date.parse(who.context.now))
      )
        conflict();
      if (
        action === 'submit' &&
        (next.revision.state !== 'pending_confirmation' ||
          next.submission?.submittedBy.id !== who.actor.id ||
          Date.parse(next.submission.submittedAt) !==
            Date.parse(who.context.now) ||
          !same(next.submission.submittedBy, next.revision.submittedBy))
      )
        conflict();
      if (
        action === 'return' &&
        (next.revision.state !== 'draft' ||
          next.revision.lastReturn?.returnedBy.id !== who.actor.id ||
          Date.parse(next.revision.lastReturn.returnedAt) !==
            Date.parse(who.context.now))
      )
        conflict();
      if (
        prior &&
        action !== 'save' &&
        next.revision.contentRevision !== prior.revision.contentRevision
      )
        conflict();
      const saved = await putRecord(tx, next);
      current.effect = {
        kind: 'revision',
        action,
        record: structuredClone(saved),
      };
    } else if (plan.kind === 'publish') {
      authorizeSelectionAction(authority(tx), 'manager');
      const publication = plan.publication;
      const before = checkSwitch(tx, publication.categorySwitch);
      const priorEffective = await currentVersion(tx);
      const next = recordSchema.parse(publication.record);
      const receipt = selectionPublicationReceiptSchema.parse(
        publication.receipt,
      );
      const loaded = await record(tx, next.revision.id);
      if (
        !loaded ||
        loaded.revision.state !== 'pending_confirmation' ||
        next.revision.state !== 'active' ||
        next.content === null ||
        next.revision.versionId !== receipt.versionId ||
        next.revision.revision !== receipt.revision ||
        next.revision.publicationId !== receipt.publicationId ||
        next.revision.revision !== loaded.revision.revision + 1 ||
        publication.categorySwitch.activate.versionId !== receipt.versionId ||
        Date.parse(receipt.publishedAt) !==
          Date.parse(publication.categorySwitch.at)
      )
        conflict();
      if (
        !same(receipt.publishedBy, authority(tx).actor) ||
        !same(next.revision.publishedBy, receipt.publishedBy) ||
        Date.parse(next.revision.publishedAt) !==
          Date.parse(receipt.publishedAt)
      )
        conflict();
      const oldSide =
        before.currentRevisionId === null
          ? null
          : await record(tx, before.currentRevisionId);
      if (
        before.currentRevisionId !== null &&
        (!oldSide ||
          oldSide.revision.state !== 'active' ||
          oldSide.revision.versionId !== before.versionId)
      )
        conflict();
      const existing = (
        await tx.db
          .select()
          .from(selectionVersionContents)
          .where(
            eq(selectionVersionContents.versionId, next.revision.versionId),
          )
      )[0];
      if (existing) {
        if (
          !loaded.contentWasPublished ||
          !same(
            selectionStandardContentSchema.parse(existing.content),
            next.content,
          )
        )
          conflict();
      } else {
        if (
          loaded.contentWasPublished ||
          (
            await tx.db
              .select({ id: ruleVersions.id })
              .from(ruleVersions)
              .where(eq(ruleVersions.id, next.revision.versionId))
          ).length
        )
          conflict();
        await tx.db.insert(ruleVersions).values({
          id: next.revision.versionId,
          provenance: 'published',
          sourceCommit: null,
        });
        await tx.db.insert(selectionVersionContents).values({
          versionId: next.revision.versionId,
          content: next.content,
          origin: 'publication',
          sourceReference: receipt.publicationId,
          recordedAt: new Date(receipt.publishedAt),
        });
      }
      const saved = await putRecord(tx, next, true);
      let supersededRevision: number | null = null;
      if (oldSide) {
        const old = selectionRevisionSchema.parse({
          ...oldSide.revision,
          state: 'superseded',
          revision: oldSide.revision.revision + 1,
          supersededByVersionId: saved.revision.versionId,
          supersededAt: publication.categorySwitch.at,
        });
        await putRecord(tx, { ...oldSide, revision: old });
        supersededRevision = old.revision;
      }
      const period = await switchSelectionApplicability(tx.db, {
        expectedPeriodId: before.currentPeriodId,
        newPeriodId: randomUUID(),
        versionId: saved.revision.versionId,
        at: new Date(publication.categorySwitch.at),
      });
      await tx.db.insert(selectionPublications).values({
        id: receipt.publicationId,
        draftId: saved.revision.id,
        versionId: saved.revision.versionId,
        receipt,
        previousVersionId: before.versionId,
        previousEffective: priorEffective,
        previousPublicationId: before.currentPublicationId,
        previousRevisionSnapshot: oldSide,
        previousSupersededRevision: supersededRevision,
        previousPeriodId: before.currentPeriodId,
        periodId: period.periodId,
        previousGeneration: before.generation,
      });
      await changeHead(tx, before, {
        versionId: saved.revision.versionId,
        periodId: period.periodId,
        revisionId: saved.revision.id,
        publicationId: receipt.publicationId,
      });
      current.effect = {
        kind: 'publish',
        record: structuredClone(saved),
        receipt: structuredClone(receipt),
      };
    } else {
      authorizeSelectionAction(authority(tx), 'manager');
      const undo = plan.undo;
      const before = checkSwitch(tx, undo.categorySwitch);
      await currentVersion(tx);
      const transaction = selectionPublicationUndoTransactionSchema.parse(
        undo.transaction,
      );
      const next = recordSchema.parse(undo.record);
      const stored = (
        await tx.db
          .select()
          .from(selectionPublications)
          .where(eq(selectionPublications.id, undo.receipt.publicationId))
          .for('update')
      )[0];
      if (
        !stored ||
        stored.undoneAt !== null ||
        before.currentPublicationId !== stored.id ||
        before.currentRevisionId !== stored.draftId ||
        before.generation !== stored.previousGeneration + 1 ||
        before.currentPeriodId !== stored.periodId ||
        before.versionId !== stored.versionId ||
        next.revision.id !== stored.draftId ||
        next.revision.state !== 'pending_confirmation' ||
        undo.categorySwitch.activate.versionId !== stored.previousVersionId ||
        !same(undo.receipt, undo.transaction.receipt)
      )
        conflict();
      const previousSnapshot =
        stored.previousRevisionSnapshot === null
          ? null
          : recordSchema.parse(stored.previousRevisionSnapshot);
      const currentRecord = await record(tx, stored.draftId);
      if (
        !currentRecord ||
        currentRecord.revision.state !== 'active' ||
        next.revision.revision !== currentRecord.revision.revision + 1 ||
        currentRecord.revision.publicationId !== stored.id
      )
        conflict();
      if (
        !same(
          selectionPublicationReceiptSchema.parse(stored.receipt),
          transaction.boundary.receipt,
        ) ||
        Date.parse(transaction.boundary.requestedAt) !==
          Date.parse(authority(tx).context.now) ||
        transaction.boundary.currentRevision !==
          currentRecord.revision.revision ||
        transaction.boundary.currentPublicationId !== stored.id
      )
        conflict();
      const allBindings = await bindings(tx);
      if (
        !same(
          allBindings,
          [...undo.transaction.bindingsBefore].sort((a, b) =>
            compareBindings(a, b),
          ),
        )
      )
        conflict();
      const saved = await putRecord(tx, next);
      if (previousSnapshot) {
        const old = await record(tx, previousSnapshot.revision.id);
        if (
          !old ||
          old.revision.state !== 'superseded' ||
          old.revision.versionId !== stored.previousVersionId ||
          old.revision.revision !== stored.previousSupersededRevision ||
          old.revision.supersededByVersionId !== stored.versionId
        )
          conflict();
        // Increment from the CURRENT superseded revision, never the old snapshot's number.
        await putRecord(tx, {
          ...previousSnapshot,
          revision: selectionRevisionSchema.parse({
            ...previousSnapshot.revision,
            revision: old.revision.revision + 1,
          }),
        });
      } else if (stored.previousSupersededRevision !== null) conflict();
      const period = await switchSelectionApplicability(tx.db, {
        expectedPeriodId: before.currentPeriodId,
        newPeriodId: randomUUID(),
        versionId: stored.previousVersionId,
        at: new Date(undo.categorySwitch.at),
      });
      const paired = await tx.db
        .update(selectionPublications)
        .set({
          undoneAt: new Date(undo.categorySwitch.at),
          undoPeriodId: period.periodId,
          undoGeneration: before.generation + 1,
        })
        .where(
          and(
            eq(selectionPublications.id, stored.id),
            isNull(selectionPublications.undoneAt),
            eq(selectionPublications.periodId, before.currentPeriodId),
          ),
        )
        .returning({ id: selectionPublications.id });
      if (paired.length !== 1) conflict();
      // Restoration is not a new undoable publication: do not resurrect an old receipt.
      await changeHead(tx, before, {
        versionId: stored.previousVersionId,
        periodId: period.periodId,
        revisionId: previousSnapshot?.revision.id ?? null,
        publicationId: null,
      });
      current.effect = {
        kind: 'undo',
        record: structuredClone(saved),
        receipt: structuredClone(undo.receipt),
      };
    }
    current.auditedAction = null;
    current.operationWritten = false;
  }
  async function bindings(tx: SelectionPostgresTransaction) {
    state(tx);
    authorizeSelectionAction(authority(tx), 'manager');
    const rows = await tx.db
      .select()
      .from(selectionCohortBindings)
      .orderBy(selectionCohortBindings.cohortId);
    return rows.map((row) => unpackBinding(row)).sort(compareBindings);
  }
  const ports: SelectionStandardPorts<SelectionPostgresTransaction> = {
    transact: (lock, work) => transact(lock, work, true),
    read: (work) => transact(null, work, false),
    async loadAuthority(tx, accountId, now) {
      const current = state(tx);
      if (current.effect !== null)
        throw new SelectionPersistenceUnavailableError();
      if (
        (current.lock && current.lock.accountId !== accountId) ||
        (current.authority &&
          current.authority.context.account.id !== accountId)
      )
        throw new SelectionLifecycleError(
          'forbidden',
          '当前身份无法处理此请求',
        );
      const fresh = structuredClone(
        await services.loadAuthority(tx.db, accountId, now),
      );
      checkAuthority(fresh, accountId, now);
      function freeze(value: object) {
        for (const child of Object.values(value))
          if (child && typeof child === 'object') freeze(child);
        Object.freeze(value);
      }
      freeze(fresh);
      current.authority = fresh;
      return fresh;
    },
    async readOperation(tx, accountId, operationId) {
      const current = state(tx, true);
      const who = authority(tx);
      if (
        current.lock?.accountId !== accountId ||
        current.lock.operationId !== operationId
      )
        throw new SelectionPersistenceUnavailableError();
      const row = (
        await tx.db
          .select()
          .from(selectionOperations)
          .where(
            and(
              eq(selectionOperations.actorAccountId, accountId),
              eq(selectionOperations.operationId, operationId),
            ),
          )
      )[0];
      if (!row) return null;
      if (row.actorPersonId !== who.actor.id)
        throw new SelectionLifecycleError(
          'forbidden',
          '当前身份无法读取旧操作回执',
        );
      const action = actionSchema.parse(row.action);
      const cohorts = z.array(text).min(1).parse(row.visibleCohortIds);
      if (
        new Set(cohorts).size !== cohorts.length ||
        !cohorts.includes(row.scopeCohortId)
      )
        throw new SelectionPersistenceUnavailableError();
      for (const cohortId of cohorts)
        authorizeSelectionAction(authority(tx), role(action), cohortId);
      const parsed = results[action].parse({
        status: 'success',
        replayed: false,
        result: row.result,
      });
      if (parsed.status !== 'success')
        throw new SelectionPersistenceUnavailableError();
      // HR receipts carry the case-level basis; manager receipts do not.
      if (role(action) === 'hr')
        await assertDisclosed(
          tx,
          selectionRevisionSchema.parse(parsed.result).basis,
        );
      return {
        fingerprint: row.fingerprint,
        scopeCohortId: row.scopeCohortId,
        visibleCohortIds: cohorts,
        result: parsed.result,
      };
    },
    async writeOperation(
      tx,
      accountId,
      operationId,
      operation: SelectionOperation,
    ) {
      const current = state(tx, true);
      const effect = current.effect;
      if (
        !effect ||
        effect.kind === 'binding' ||
        !current.auditedAction ||
        current.lock?.accountId !== accountId ||
        current.lock.operationId !== operationId
      )
        throw new SelectionPersistenceUnavailableError();
      const action = actionSchema.parse(current.auditedAction);
      const parsed = results[action].parse({
        status: 'success',
        replayed: false,
        result: operation.result,
      });
      const expected =
        effect.kind === 'revision'
          ? action === 'return'
            ? projectSelectionManagerRevision(effect.record)
            : effect.record.revision
          : effect.receipt;
      if (
        parsed.status !== 'success' ||
        !same(parsed.result, expected) ||
        !/^[0-9a-f]{64}$/.test(operation.fingerprint) ||
        operation.scopeCohortId !== effect.record.scopeCohortId ||
        !same(
          [...operation.visibleCohortIds].sort(),
          scope(effect.record).sort(),
        )
      )
        throw new SelectionPersistenceUnavailableError();
      await tx.db.insert(selectionOperations).values({
        actorAccountId: accountId,
        operationId,
        actorPersonId: authority(tx).actor.id,
        action,
        fingerprint: operation.fingerprint,
        scopeCohortId: operation.scopeCohortId,
        visibleCohortIds: operation.visibleCohortIds,
        result: parsed.result,
      });
      current.operationWritten = true;
    },
    async creationFacts(tx, current, input) {
      state(tx, true);
      if (current !== authority(tx))
        throw new SelectionPersistenceUnavailableError();
      authorizeSelectionAction(current, 'hr');
      const version = await currentVersion(tx);
      const baseContent = await content(tx, version.versionId);
      const facts = await services.creationFacts(tx.db, current, input);
      authorizeSelectionAction(current, 'hr', facts.scopeCohortId);
      return { ...facts, baseContent };
    },
    async readRevision(tx, draftId, purpose) {
      // Manager planning reads keep the full record internally; only projections
      // and receipts leave the executor. HR reads return the basis, so re-check it.
      if (purpose === 'manager')
        authorizeSelectionAction(authority(tx), 'manager');
      else if (purpose !== 'hr')
        throw new SelectionPersistenceUnavailableError();
      const found = await record(tx, draftId);
      if (found && purpose === 'hr') {
        for (const cohortId of scope(found))
          authorizeSelectionAction(authority(tx), 'hr', cohortId);
        await assertDisclosed(tx, found.revision.basis);
      }
      return found;
    },
    async readImpact(tx, current, revision) {
      const native = state(tx, true);
      if (current !== authority(tx))
        throw new SelectionPersistenceUnavailableError();
      const loaded = native.loaded.get(revision.revision.id);
      const stored = loaded
        ? unpack(loaded)
        : await record(tx, revision.revision.id);
      if (!stored || !same(stored, revision)) conflict();
      authorizeRecord(current, stored);
      return services.readImpact(tx.db, current, stored);
    },
    async readEffectiveRuleVersion(tx, input, clock) {
      state(tx);
      authority(tx);
      return readEffectiveRuleVersion(tx.db, input, clock);
    },
    async readCurrentPublicationId(tx) {
      return head(tx).currentPublicationId;
    },
    async readPublication(tx, publicationId) {
      state(tx, true);
      authorizeSelectionAction(authority(tx), 'manager');
      const row = (
        await tx.db
          .select()
          .from(selectionPublications)
          .where(eq(selectionPublications.id, publicationId))
          .for('update')
      )[0];
      if (!row) return null;
      if (row.undoneAt !== null) conflict();
      const current = await record(tx, row.draftId);
      if (!current) throw new SelectionPersistenceUnavailableError();
      const receipt = selectionPublicationReceiptSchema.parse(row.receipt);
      const previous = effectiveRuleVersionSchema.parse(row.previousEffective);
      if (
        receipt.publicationId !== row.id ||
        receipt.versionId !== row.versionId ||
        receipt.previousVersionId !== row.previousVersionId ||
        previous.category !== 'xe_selection' ||
        previous.versionId !== row.previousVersionId
      )
        throw new SelectionPersistenceUnavailableError();
      return { record: current, receipt, previous };
    },
    readBindingsForUndo: bindings,
    async readCohortBinding(tx, cohortId) {
      state(tx);
      try {
        authorizeSelectionAction(authority(tx), 'manager');
      } catch (error) {
        if (!(error instanceof SelectionLifecycleError)) throw error;
        authorizeSelectionAction(authority(tx), 'hr', cohortId);
      }
      return readStoredSelectionCohortBinding(tx.db, cohortId);
    },
    async allocateId(tx) {
      state(tx, true);
      authority(tx);
      return randomUUID();
    },
    async allocateVersionId(tx) {
      const before = head(tx);
      authority(tx);
      if (state(tx, true).reservedVersionId !== null) conflict();
      const versionId = selectionVersionIdSchema.parse(
        'xe-select-v' + before.nextVersionOrdinal,
      );
      if (
        (
          await tx.db
            .select({ id: ruleVersions.id })
            .from(ruleVersions)
            .where(eq(ruleVersions.id, versionId))
        ).length ||
        (
          await tx.db
            .select({ id: selectionRevisions.id })
            .from(selectionRevisions)
            .where(eq(selectionRevisions.versionId, versionId))
        ).length
      )
        conflict();
      const changed = await tx.db
        .update(selectionCategoryHeads)
        .set({ nextVersionOrdinal: before.nextVersionOrdinal + 1 })
        .where(
          and(
            eq(selectionCategoryHeads.category, 'xe_selection'),
            eq(selectionCategoryHeads.generation, before.generation),
            eq(
              selectionCategoryHeads.nextVersionOrdinal,
              before.nextVersionOrdinal,
            ),
          ),
        )
        .returning();
      if (changed.length !== 1) conflict();
      state(tx, true).head = changed[0];
      state(tx, true).reservedVersionId = versionId;
      return versionId;
    },
    persist,
    async audit(tx, event) {
      const current = state(tx, true);
      const effect = current.effect;
      if (
        !effect ||
        current.auditedAction !== null ||
        event.actorAccountId !== current.lock?.accountId ||
        event.actorPersonId !== authority(tx).actor.id ||
        event.resourceId !==
          (effect.kind === 'binding'
            ? effect.binding.cohort.id
            : effect.record.revision.id)
      )
        throw new SelectionPersistenceUnavailableError();
      const action = event.action.slice('selection_standard.'.length);
      const allowed =
        effect.kind === 'revision'
          ? [effect.action]
          : effect.kind === 'binding'
            ? ['bind_cohort']
            : [effect.kind === 'undo' ? 'undo' : 'publish'];
      if (
        !event.action.startsWith('selection_standard.') ||
        !allowed.includes(action)
      )
        throw new SelectionPersistenceUnavailableError();
      await recordAudit(tx.db, {
        actorId: event.actorAccountId,
        action: event.action,
        resourceId: event.resourceId,
      });
      current.auditedAction = action as Action | 'bind_cohort';
    },
  };
  /** Invoke within ports.transact AFTER taking the category lock and before a
   * same-tx cohort creator commits. No caller-supplied name/version/time grant.
   */
  async function bindCohort(
    tx: SelectionPostgresTransaction,
    accountId: string,
    cohortId: string,
    clock: () => Date = () => new Date(),
  ) {
    const current = state(tx, true);
    if (current.effect !== null)
      throw new SelectionPersistenceUnavailableError();
    const now = clock().toISOString();
    const fresh = await ports.loadAuthority(tx, accountId, now);
    try {
      authorizeSelectionAction(fresh, 'manager');
    } catch (error) {
      if (!(error instanceof SelectionLifecycleError)) throw error;
      authorizeSelectionAction(fresh, 'hr', cohortId);
    }
    const cohort = await services.readCohort(tx.db, fresh, cohortId);
    if (!cohort)
      throw new SelectionLifecycleError('not_found', '期次不存在或不可见');
    if (cohort.id !== cohortId) conflict();
    const { binding, created } = await bindSelectionCohortFacts(
      tx.db,
      fresh,
      cohort,
    );
    if (!created) return binding;
    current.effect = { kind: 'binding', binding };
    current.auditedAction = null;
    await ports.audit(tx, {
      actorAccountId: accountId,
      actorPersonId: fresh.actor.id,
      action: 'selection_standard.bind_cohort',
      resourceId: cohortId,
    });
    return binding;
  }
  return { ports, bindCohort };
}
const baselineSchema = z.strictObject({
  versionId: selectionVersionIdSchema,
  existingPeriodId: text,
  content: selectionStandardContentSchema,
  sourceReference: text,
  nextVersionOrdinal: z.number().int().positive(),
});
/** Explicit reviewed import/bootstrap only. Never called automatically at startup.
 * The directory and effective period must ALREADY exist; no fabricated v1/publisher.
 */
export async function initializeSelectionBaseline(
  db: Database,
  raw: z.infer<typeof baselineSchema>,
  clock: () => Date = () => new Date(),
) {
  try {
    return await db.transaction(
      (tx) => initializeSelectionBaselineTransaction(tx, raw, clock),
      { isolationLevel: 'read committed' },
    );
  } catch (error) {
    throw selectionStorageFailure(error);
  }
}

/** Shared implementation for existing-directory bootstrap and the explicit
 * reviewed snapshot import. Neither path invents a publication/HR signature. */
async function initializeSelectionBaselineTransaction(
  tx: Transaction,
  raw: z.infer<typeof baselineSchema>,
  clock: () => Date,
) {
  const input = baselineSchema.parse(raw);
  await lockRuleCategory(tx, 'xe_selection');
  const now = clock();
  const current = await readEffectiveRuleVersion(
    tx,
    { category: 'xe_selection', at: now.toISOString() },
    () => now,
  );
  if (
    current.status !== 'success' ||
    current.version.versionId !== input.versionId ||
    current.version.effectiveUntil !== null ||
    input.nextVersionOrdinal <=
      Number(input.versionId.slice('xe-select-v'.length))
  )
    conflict();
  const period = (
    await tx
      .select()
      .from(ruleVersionApplicability)
      .where(eq(ruleVersionApplicability.periodId, input.existingPeriodId))
      .for('update')
  )[0];
  if (
    !period ||
    period.category !== 'xe_selection' ||
    period.versionId !== input.versionId ||
    period.effectiveFrom.toISOString() !== current.version.effectiveFrom ||
    period.effectiveUntil !== null
  )
    conflict();
  const oldHead = (
    await tx
      .select()
      .from(selectionCategoryHeads)
      .where(eq(selectionCategoryHeads.category, 'xe_selection'))
      .for('update')
  )[0];
  const oldContent = (
    await tx
      .select()
      .from(selectionVersionContents)
      .where(eq(selectionVersionContents.versionId, input.versionId))
  )[0];
  if (oldHead) {
    if (
      !oldContent ||
      oldContent.origin !== 'baseline' ||
      oldHead.versionId !== input.versionId ||
      oldHead.currentRevisionId !== null ||
      !same(oldContent.content, input.content) ||
      oldContent.sourceReference !== input.sourceReference
    )
      conflict();
    return oldHead;
  }
  if (oldContent) conflict();
  await tx.insert(selectionVersionContents).values({
    versionId: input.versionId,
    content: input.content,
    origin: 'baseline',
    sourceReference: input.sourceReference,
    recordedAt: now,
  });
  const [created] = await tx
    .insert(selectionCategoryHeads)
    .values({
      category: 'xe_selection',
      versionId: input.versionId,
      currentPeriodId: input.existingPeriodId,
      currentRevisionId: null,
      currentPublicationId: null,
      generation: 1,
      nextVersionOrdinal: input.nextVersionOrdinal,
    })
    .returning();
  return created;
}

const snapshotBaselineSchema = baselineSchema
  .omit({ existingPeriodId: true })
  .extend({
    sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
    periodId: text,
    effectiveFrom: z.iso.datetime(),
  })
  .strict();
export type SelectionBaselineSnapshot = z.infer<typeof snapshotBaselineSchema>;

/** Internal trusted import, on the caller's SAME live transaction. The usecase
 * authorizes a current manager before calling. Time/content/source are reviewed
 * input facts, never inferred from the import clock or a comparison row. */
export async function importSelectionBaselineSnapshot(
  tx: Transaction,
  raw: SelectionBaselineSnapshot,
  clock: () => Date = () => new Date(),
) {
  const input = snapshotBaselineSchema.parse(raw);
  await lockRuleCategory(tx, 'xe_selection');
  const now = clock();
  const effectiveFrom = new Date(input.effectiveFrom);
  if (!Number.isFinite(now.getTime()) || effectiveFrom > now) conflict();
  const [previousHead] = await tx
    .select()
    .from(selectionCategoryHeads)
    .where(eq(selectionCategoryHeads.category, 'xe_selection'))
    .for('update');
  const versions = await tx
    .select()
    .from(ruleVersions)
    .where(eq(ruleVersions.id, input.versionId))
    .for('update');
  const periods = await tx
    .select()
    .from(ruleVersionApplicability)
    .where(eq(ruleVersionApplicability.category, 'xe_selection'))
    .for('update');
  const old = versions[0];
  if (
    old &&
    (old.provenance !== 'demo_import_snapshot' ||
      old.sourceCommit !== input.sourceCommit)
  )
    conflict();
  if (
    periods.length &&
    (periods.length !== 1 ||
      periods[0]!.periodId !== input.periodId ||
      periods[0]!.versionId !== input.versionId ||
      periods[0]!.effectiveFrom.getTime() !== effectiveFrom.getTime() ||
      periods[0]!.effectiveUntil !== null)
  )
    conflict();
  if (!old)
    await tx.insert(ruleVersions).values({
      id: input.versionId,
      provenance: 'demo_import_snapshot',
      sourceCommit: input.sourceCommit,
    });
  if (!periods.length)
    await switchSelectionApplicability(tx, {
      expectedPeriodId: null,
      newPeriodId: input.periodId,
      versionId: input.versionId,
      at: effectiveFrom,
    });
  const head = await initializeSelectionBaselineTransaction(
    tx,
    {
      versionId: input.versionId,
      existingPeriodId: input.periodId,
      content: input.content,
      sourceReference: input.sourceReference,
      nextVersionOrdinal: input.nextVersionOrdinal,
    },
    () => now,
  );
  return { head, created: !previousHead };
}

/** Server-private input for921 after its current HR/node authorization.
 * Read the actual922 effective version and immutable918 content; a requested old
 * version is not silently substituted. No permission or Web DTO is created here. */
export async function readCurrentSelectionStandard(
  tx: Transaction,
  requestedVersionId: string,
  clock: () => Date = () => new Date(),
) {
  const versionId = selectionVersionIdSchema.parse(requestedVersionId);
  const now = clock();
  const effective = await readEffectiveRuleVersion(
    tx,
    { category: 'xe_selection', at: now.toISOString() },
    () => now,
  );
  if (effective.status === 'not_found') return null;
  if (effective.status !== 'success') conflict();
  if (effective.version.versionId !== versionId) return null;
  const [head] = await tx
    .select()
    .from(selectionCategoryHeads)
    .where(eq(selectionCategoryHeads.category, 'xe_selection'));
  if (!head) throw new SelectionPersistenceUnavailableError();
  const current = await readCurrentSelectionVersion(
    tx,
    head,
    now.toISOString(),
  );
  if (!same(current, effective.version)) conflict();
  const [content] = await tx
    .select()
    .from(selectionVersionContents)
    .where(eq(selectionVersionContents.versionId, versionId));
  if (!content) throw new SelectionPersistenceUnavailableError();
  return {
    version: current,
    content: selectionStandardContentSchema.parse(content.content),
  };
}

/** Internal native binding read; caller authorizes the cohort before disclosure. */
export async function readStoredSelectionCohortBinding(
  tx: Transaction,
  cohortId: string,
) {
  const [row] = await tx
    .select()
    .from(selectionCohortBindings)
    .where(eq(selectionCohortBindings.cohortId, cohortId));
  if (!row) return null;
  const binding = unpackBinding(row);
  const [content] = await tx
    .select()
    .from(selectionVersionContents)
    .where(eq(selectionVersionContents.versionId, binding.standardVersionId));
  if (!content) conflict();
  selectionStandardContentSchema.parse(content.content);
  return binding;
}

/** Reused by the existing lifecycle store and the actual cohort usecase.
 * Caller owns the transaction, current directory authorization and audit. */
export async function bindSelectionCohortFacts(
  tx: Transaction,
  authority: SelectionAuthority,
  cohort: SelectionCohortBinding['cohort'],
  mode: 'current' | 'baseline_import' = 'current',
) {
  await lockRuleCategory(tx, 'xe_selection');
  try {
    authorizeSelectionAction(authority, 'manager');
  } catch (error) {
    if (!(error instanceof SelectionLifecycleError)) throw error;
    authorizeSelectionAction(authority, 'hr', cohort.id);
  }
  const existing = await readStoredSelectionCohortBinding(tx, cohort.id);
  if (existing) return { binding: existing, created: false };
  const [head] = await tx
    .select()
    .from(selectionCategoryHeads)
    .where(eq(selectionCategoryHeads.category, 'xe_selection'))
    .for('update');
  if (!head) conflict();
  if (
    mode === 'baseline_import' &&
    (head.generation !== 1 ||
      head.currentRevisionId !== null ||
      head.currentPublicationId !== null)
  )
    conflict();

  const current = await readCurrentSelectionVersion(
    tx,
    head,
    authority.context.now,
  );
  const [content] = await tx
    .select()
    .from(selectionVersionContents)
    .where(eq(selectionVersionContents.versionId, current.versionId));
  if (!content) conflict();
  if (mode === 'baseline_import' && content.origin !== 'baseline') conflict();
  selectionStandardContentSchema.parse(content.content);
  const binding = planSelectionCohortBinding(authority, cohort, null, current);
  await tx.insert(selectionCohortBindings).values({
    cohortId: cohort.id,
    versionId: binding.standardVersionId,
    binding,
    boundAt: new Date(binding.boundAt),
  });
  return { binding, created: true };
}
