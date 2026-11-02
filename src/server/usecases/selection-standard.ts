import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  createSelectionRevisionInputSchema,
  saveSelectionRevisionInputSchema,
  submitSelectionRevisionInputSchema,
  withdrawSelectionRevisionInputSchema,
  returnSelectionRevisionInputSchema,
  publishSelectionRevisionInputSchema,
  undoSelectionPublicationInputSchema,
  createSelectionRevisionResultSchema,
  saveSelectionRevisionResultSchema,
  submitSelectionRevisionResultSchema,
  withdrawSelectionRevisionResultSchema,
  returnSelectionRevisionResultSchema,
  publishSelectionRevisionResultSchema,
  undoSelectionPublicationResultSchema,
  effectiveRuleVersionReadResultSchema,
  selectionCohortVersionReadInputSchema,
  selectionCohortVersionReadResultSchema,
  selectionAiDraftSchema,
  selectionRevisionSchema,
  type EffectiveRuleVersionReadInput,
  type EffectiveRuleVersion,
  type SelectionCohortBinding,
} from '../../contracts/selection-standard';
import {
  authorizeSelectionAction,
  SelectionLifecycleError,
  planCreateSelectionRevision,
  planSaveSelectionRevision,
  planSubmitSelectionRevision,
  planWithdrawSelectionRevision,
  planReturnSelectionRevision,
  planPublishSelectionRevision,
  planUndoSelectionPublication,
  projectSelectionManagerRevision,
  type SelectionAuthority,
  type SelectionRevisionRecord,
  type SelectionImpactFacts,
} from '../modules/evaluation-system/selection-standard';

export const selectionRevisionCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('create'),
    input: createSelectionRevisionInputSchema,
  }),
  z.strictObject({
    action: z.literal('save'),
    input: saveSelectionRevisionInputSchema,
  }),
  z.strictObject({
    action: z.literal('submit'),
    input: submitSelectionRevisionInputSchema,
  }),
  z.strictObject({
    action: z.literal('withdraw'),
    input: withdrawSelectionRevisionInputSchema,
  }),
  z.strictObject({
    action: z.literal('return'),
    input: returnSelectionRevisionInputSchema,
  }),
  z.strictObject({
    action: z.literal('publish'),
    input: publishSelectionRevisionInputSchema,
  }),
  z.strictObject({
    action: z.literal('undo'),
    input: undoSelectionPublicationInputSchema,
  }),
]);
export type SelectionRevisionCommand = z.infer<
  typeof selectionRevisionCommandSchema
>;
const resultSchemas = {
  create: createSelectionRevisionResultSchema,
  save: saveSelectionRevisionResultSchema,
  submit: submitSelectionRevisionResultSchema,
  withdraw: withdrawSelectionRevisionResultSchema,
  return: returnSelectionRevisionResultSchema,
  publish: publishSelectionRevisionResultSchema,
  undo: undoSelectionPublicationResultSchema,
};
export type SelectionRevisionPersistencePlan =
  | { kind: 'revision'; record: SelectionRevisionRecord }
  | {
      kind: 'publish';
      publication: ReturnType<typeof planPublishSelectionRevision>;
    }
  | { kind: 'undo'; undo: ReturnType<typeof planUndoSelectionPublication> };
export interface SelectionOperation {
  fingerprint: string;
  scopeCohortId: string;
  visibleCohortIds: string[];
  result: unknown;
}

/**
 * A server composition supplies these ports. This file is not a PostgreSQL
 * adapter: the contract below still needs real concurrency/restart validation.
 */
export interface SelectionStandardPorts<Tx> {
  /** Acquire category + actor/operation locks BEFORE invoking work. Read Committed.
   * All publication/undo/cohort-creation writers use this same category fence.
   * persist, operation and audit must commit/roll back as one transaction.
   */
  transact<R>(
    lock: { category: 'xe_selection'; accountId: string; operationId: string },
    work: (tx: Tx) => Promise<R>,
  ): Promise<R>;
  read<R>(work: (tx: Tx) => Promise<R>): Promise<R>;
  loadAuthority(
    tx: Tx,
    accountId: string,
    now: string,
  ): Promise<SelectionAuthority>;
  /** A stored HR receipt is returned only after its citations are re-checked
   * against the caller's current access; a receipt is not a current grant. */
  readOperation(
    tx: Tx,
    accountId: string,
    operationId: string,
  ): Promise<SelectionOperation | null>;
  writeOperation(
    tx: Tx,
    accountId: string,
    operationId: string,
    operation: SelectionOperation,
  ): Promise<void>;
  /** Must resolve attribution -> batch -> cohort and authorize BEFORE reading private basis/impact.
   * Impact is scoped to currently authorized cohorts, never all server bindings.
   */
  creationFacts(
    tx: Tx,
    authority: SelectionAuthority,
    input: z.infer<typeof createSelectionRevisionInputSchema>,
  ): Promise<
    Omit<
      Parameters<typeof planCreateSelectionRevision>[2],
      'draftId' | 'versionId' | 'previewId' | 'current'
    > & { aiDraft?: z.infer<typeof selectionAiDraftSchema> }
  >;
  /** 'hr' reads return the private basis, so the port re-checks every citation
   * against current access first. 'manager' reads require manager authorization
   * and serve planning only; the executor returns projections or receipts. */
  readRevision(
    tx: Tx,
    draftId: string,
    purpose: 'hr' | 'manager',
  ): Promise<SelectionRevisionRecord | null>;
  /** Current facts for the SAME saved preview scope, not a new manager-global preview. */
  readImpact(
    tx: Tx,
    authority: SelectionAuthority,
    record: SelectionRevisionRecord,
  ): Promise<SelectionImpactFacts>;
  /** Compose BOW-922 readEffectiveRuleVersion(tx,input,clock); never reimplement its query. */
  readEffectiveRuleVersion(
    tx: Tx,
    input: EffectiveRuleVersionReadInput,
    clock: () => Date,
  ): Promise<z.infer<typeof effectiveRuleVersionReadResultSchema>>;
  readCurrentPublicationId(tx: Tx): Promise<string | null>;
  readPublication(
    tx: Tx,
    publicationId: string,
  ): Promise<{
    record: SelectionRevisionRecord;
    receipt: Parameters<typeof planUndoSelectionPublication>[3]['receipt'];
    previous: EffectiveRuleVersion;
  } | null>;
  /** Private server-global snapshot, only after current manager authorization. */
  readBindingsForUndo(tx: Tx): Promise<SelectionCohortBinding[]>;
  readCohortBinding(
    tx: Tx,
    cohortId: string,
  ): Promise<SelectionCohortBinding | null>;
  allocateId(
    tx: Tx,
    kind: 'draft' | 'preview' | 'publication',
  ): Promise<string>;
  allocateVersionId(tx: Tx): Promise<string>;
  /** CAS revision/category-publication identity; persist both lifecycle sides,
   * category reads/default and immutable publication content. Undo preserves ALL
   * bindings. Never update historical results, rubric/anchors or talent snapshots.
   */
  persist(tx: Tx, plan: SelectionRevisionPersistencePlan): Promise<void>;
  audit(
    tx: Tx,
    event: {
      actorAccountId: string;
      actorPersonId: string;
      action: string;
      resourceId: string;
    },
  ): Promise<void>;
}
function requiredRole(command: SelectionRevisionCommand): 'hr' | 'manager' {
  return ['return', 'publish', 'undo'].includes(command.action)
    ? 'manager'
    : 'hr';
}
function fingerprint(command: SelectionRevisionCommand) {
  const { operationId: _key, ...semantics } = command.input;
  void _key;
  return createHash('sha256')
    .update(JSON.stringify([command.action, semantics]))
    .digest('hex');
}
function verifyAccount(
  authority: SelectionAuthority,
  accountId: string,
  now: string,
) {
  if (
    authority.context.account.id !== accountId ||
    Date.parse(authority.context.now) !== Date.parse(now)
  )
    throw new SelectionLifecycleError('forbidden', '当前身份无法处理此请求');
}
function visibleCohorts(record: SelectionRevisionRecord): string[] {
  return [
    ...new Set([
      record.scopeCohortId,
      record.revision.impactPreview.nextCohort.id,
      ...record.revision.impactPreview.existingResults.map(
        (row) => row.cohortId,
      ),
      ...record.revision.impactPreview.preservedBindings.map(
        (row) => row.cohort.id,
      ),
    ]),
  ];
}
async function currentSelection<Tx>(
  ports: SelectionStandardPorts<Tx>,
  tx: Tx,
  now: string,
) {
  const result = effectiveRuleVersionReadResultSchema.parse(
    await ports.readEffectiveRuleVersion(
      tx,
      { category: 'xe_selection', at: now },
      () => new Date(now),
    ),
  );
  if (result.status !== 'success')
    throw new SelectionLifecycleError(result.status, result.message);
  return result.version;
}

/** accountId comes from requireSession/verified server identity, never browser roles. */
export async function executeSelectionRevision<Tx>(
  ports: SelectionStandardPorts<Tx>,
  accountId: string,
  raw: unknown,
  clock: () => Date = () => new Date(),
) {
  const parsed = selectionRevisionCommandSchema.safeParse(raw);
  if (!parsed.success)
    return {
      status: 'validation_error' as const,
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
      input: raw,
    };
  const command = parsed.data;
  const schema = resultSchemas[command.action];
  try {
    return await ports.transact(
      {
        category: 'xe_selection',
        accountId,
        operationId: command.input.operationId,
      },
      async (tx) => {
        // Clock and current authorization are loaded AFTER waiting for all locks.
        const now = clock().toISOString();
        const authority = await ports.loadAuthority(tx, accountId, now);
        verifyAccount(authority, accountId, now);
        authorizeSelectionAction(authority, requiredRole(command));
        const previous = await ports.readOperation(
          tx,
          accountId,
          command.input.operationId,
        );
        const payloadFingerprint = fingerprint(command);
        if (previous) {
          authorizeSelectionAction(
            authority,
            requiredRole(command),
            previous.scopeCohortId,
          );
          for (const cohort of previous.visibleCohortIds)
            authorizeSelectionAction(authority, requiredRole(command), cohort);
          if (previous.fingerprint !== payloadFingerprint)
            throw new SelectionLifecycleError(
              'conflict',
              '同一提交编号不能用于不同内容',
            );
          return schema.parse({
            status: 'success',
            replayed: true,
            result: previous.result,
          });
        }
        let plan: SelectionRevisionPersistencePlan;
        let result: unknown;
        let record: SelectionRevisionRecord;
        if (command.action === 'create') {
          const facts = await ports.creationFacts(tx, authority, command.input);
          record = planCreateSelectionRevision(authority, command.input, {
            ...facts,
            current: await currentSelection(ports, tx, now),
            draftId: await ports.allocateId(tx, 'draft'),
            versionId: await ports.allocateVersionId(tx),
            previewId: await ports.allocateId(tx, 'preview'),
          });
          if (facts.aiDraft !== undefined) {
            const aiDraft = selectionAiDraftSchema.parse(facts.aiDraft);
            if (
              JSON.stringify(aiDraft.basis) !==
              JSON.stringify(record.revision.basis)
            )
              throw new SelectionLifecycleError(
                'conflict',
                'AI提案依据与当前人工归因不一致',
              );
            // Server-loaded initial proposal only; no save/publish command can
            // replace the immutable AI original or manufacture an HR edit.
            record.revision = selectionRevisionSchema.parse({
              ...record.revision,
              aiDraft,
            });
          }
          plan = { kind: 'revision', record };
          result = record.revision;
        } else if (command.action === 'undo') {
          const publication = await ports.readPublication(
            tx,
            command.input.publicationId,
          );
          if (!publication)
            throw new SelectionLifecycleError(
              'not_found',
              '发布记录不存在或不可见',
            );
          const undo = planUndoSelectionPublication(
            authority,
            publication.record,
            command.input,
            {
              receipt: publication.receipt,
              previous: publication.previous,
              current: await currentSelection(ports, tx, now),
              currentPublicationId: await ports.readCurrentPublicationId(tx),
              bindingsBefore: await ports.readBindingsForUndo(tx),
            },
          );
          record = undo.record;
          plan = { kind: 'undo', undo };
          result = undo.receipt;
        } else {
          const loaded = await ports.readRevision(
            tx,
            command.input.draftId,
            requiredRole(command),
          );
          if (!loaded)
            throw new SelectionLifecycleError(
              'not_found',
              '草稿不存在或不可见',
            );
          // Authorize before fetching impact or returning any saved private content.
          authorizeSelectionAction(
            authority,
            requiredRole(command),
            loaded.scopeCohortId,
          );
          for (const cohort of visibleCohorts(loaded))
            authorizeSelectionAction(authority, requiredRole(command), cohort);
          switch (command.action) {
            case 'save':
              record = planSaveSelectionRevision(
                authority,
                loaded,
                command.input,
                {
                  previewId: await ports.allocateId(tx, 'preview'),
                  impact: await ports.readImpact(tx, authority, loaded),
                },
              );
              break;
            case 'submit':
              record = planSubmitSelectionRevision(
                authority,
                loaded,
                command.input,
              );
              break;
            case 'withdraw':
              record = planWithdrawSelectionRevision(
                authority,
                loaded,
                command.input,
              );
              break;
            case 'return':
              record = planReturnSelectionRevision(
                authority,
                loaded,
                command.input,
              );
              break;
            case 'publish': {
              const publication = planPublishSelectionRevision(
                authority,
                loaded,
                command.input,
                {
                  current: await currentSelection(ports, tx, now),
                  currentPublicationId:
                    await ports.readCurrentPublicationId(tx),
                  publicationId: await ports.allocateId(tx, 'publication'),
                  impact: await ports.readImpact(tx, authority, loaded),
                },
              );
              record = publication.record;
              plan = { kind: 'publish', publication };
              result = publication.receipt;
              break;
            }
          }
          if (command.action !== 'publish') {
            plan = { kind: 'revision', record };
            result =
              command.action === 'return'
                ? projectSelectionManagerRevision(record)
                : record.revision;
          }
        }
        const response = schema.parse({
          status: 'success',
          replayed: false,
          result,
        });
        if (response.status !== 'success')
          throw new Error('Invalid selection success result');
        await ports.persist(tx, plan!);
        await ports.audit(tx, {
          actorAccountId: accountId,
          actorPersonId: authority.actor.id,
          action: 'selection_standard.' + command.action,
          resourceId: record.revision.id,
        });
        await ports.writeOperation(tx, accountId, command.input.operationId, {
          fingerprint: payloadFingerprint,
          scopeCohortId: record.scopeCohortId,
          visibleCohortIds: visibleCohorts(record),
          result: response.result,
        });
        return response;
      },
    );
  } catch (error) {
    if (!(error instanceof SelectionLifecycleError)) throw error;
    return schema.parse(
      error.status === 'conflict'
        ? { status: 'conflict', message: error.message, input: command.input }
        : { status: error.status, message: error.message },
    );
  }
}

/** A bound cohort never falls back to the global current version. */
export async function readSelectionCohortVersion<Tx>(
  ports: SelectionStandardPorts<Tx>,
  accountId: string,
  raw: unknown,
  clock: () => Date = () => new Date(),
) {
  const input = selectionCohortVersionReadInputSchema.parse(raw);
  try {
    return await ports.read(async (tx) => {
      const now = clock().toISOString();
      const authority = await ports.loadAuthority(tx, accountId, now);
      verifyAccount(authority, accountId, now);
      try {
        authorizeSelectionAction(authority, 'manager');
      } catch (error) {
        if (!(error instanceof SelectionLifecycleError)) throw error;
        authorizeSelectionAction(authority, 'hr', input.cohortId);
      }
      const binding = await ports.readCohortBinding(tx, input.cohortId);
      if (!binding)
        return {
          status: 'not_found' as const,
          message: '该期次尚未绑定选拔标准',
        };
      if (binding.cohort.id !== input.cohortId)
        throw new Error('Stored cohort binding identity mismatch');
      return selectionCohortVersionReadResultSchema.parse({
        status: 'success',
        binding,
      });
    });
  } catch (error) {
    if (!(error instanceof SelectionLifecycleError)) throw error;
    return {
      status: 'forbidden' as const,
      message: '你没有读取此期次选拔标准的权限',
    };
  }
}
