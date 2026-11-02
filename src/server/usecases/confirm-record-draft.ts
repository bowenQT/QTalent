import {
  recordSaveInputSchema,
  recordUndoInputSchema,
} from '../../contracts/record';
import type { EvaluationAuthzContext } from '../authz/evaluation-node';
import {
  ConfirmationError,
  confirmationAuthorizationDraft,
  confirmationSemanticKey,
  planRecordConfirmation,
  requireConfirmationAuthority,
  type ConfirmationCommand,
  type ConfirmationPlan,
  type ConfirmationRules,
  type ConfirmationSourceFact,
  type ConfirmationState,
} from '../modules/talent/record-confirmation';
import type { RecordBatchDraft } from '../../contracts/record';

/** Planning only: no default database, persistence, queue or application action.
 * A later native transaction adapter must recheck these fences and commit all
 * effects/operation/audit atomically. A planned result is not a saved receipt.
 */
export interface ConfirmRecordDraftDependencies {
  businessNow(): string;
  wallNow(): string;
  newId(): string;
  readState(
    accountId: string,
    command: ConfirmationCommand,
  ): Promise<ConfirmationState>;
  loadAuthorization(
    accountId: string,
    at: string,
  ): Promise<EvaluationAuthzContext>;
  readRules(versions: {
    dimensionVersionId: string;
    anchorVersionId: string;
  }): Promise<ConfirmationRules | null>;
  readSources(
    accountId: string,
    draft: RecordBatchDraft,
  ): Promise<ConfirmationSourceFact[]>;
}
export type ConfirmationPlanningResult =
  | { status: 'planned'; plan: ConfirmationPlan }
  | { status: 'validation_error'; input: unknown }
  | { status: 'conflict'; reason: string; input: unknown }
  | { status: 'forbidden' | 'not_found' | 'unavailable'; reason: string };
export function createConfirmRecordDraftUsecase(
  deps: ConfirmRecordDraftDependencies,
) {
  for (const method of [
    'businessNow',
    'wallNow',
    'newId',
    'readState',
    'loadAuthorization',
    'readRules',
    'readSources',
  ] as const)
    if (typeof deps[method] !== 'function')
      throw new TypeError(`Missing confirmation method: ${method}`);
  async function authorization(accountId: string) {
    const at = deps.businessNow();
    const context = await deps.loadAuthorization(accountId, at);
    if (
      !accountId ||
      context.account.id !== accountId ||
      !Number.isFinite(Date.parse(at)) ||
      Date.parse(context.now) !== Date.parse(at) ||
      ![
        context.evaluationNodes,
        context.evaluationNodeSubjects,
        context.evaluationRelations,
      ].every(Array.isArray)
    )
      throw new ConfirmationError(
        'forbidden',
        'current_authorization_required',
      );
    return context;
  }
  async function plan(
    accountId: string,
    command: ConfirmationCommand,
  ): Promise<ConfirmationPlanningResult> {
    try {
      const state = await deps.readState(accountId, command);
      const context = await authorization(accountId);
      const draft = confirmationAuthorizationDraft(state, accountId, command);
      requireConfirmationAuthority(context, draft);
      const replay = state.operations.some(
        (row) =>
          row.actorAccountId === accountId &&
          row.action === command.action &&
          row.operationId === command.input.operation_id,
      );
      const rules =
        command.action === 'save' && !replay
          ? await deps.readRules({
              dimensionVersionId: draft.dimensionVersionId,
              anchorVersionId: draft.anchorVersionId,
            })
          : null;
      const sources = await deps.readSources(accountId, draft);
      const fresh = await deps.readState(accountId, command);
      const freshDraft = confirmationAuthorizationDraft(
        fresh,
        accountId,
        command,
      );
      if (
        confirmationSemanticKey(freshDraft) !== confirmationSemanticKey(draft)
      )
        throw new ConfirmationError(
          'conflict',
          'draft_changed_during_planning',
        );
      const currentContext = await authorization(accountId);
      if (currentContext.account.personId !== context.account.personId)
        throw new ConfirmationError('forbidden', 'account_binding_changed');
      return {
        status: 'planned',
        plan: planRecordConfirmation({
          accountId,
          command,
          state: fresh,
          context: currentContext,
          sources,
          rules,
          wallNow: deps.wallNow(),
          newId: deps.newId,
        }),
      };
    } catch (error) {
      if (!(error instanceof ConfirmationError)) throw error;
      if (error.status === 'conflict')
        return {
          status: 'conflict',
          reason: error.reason,
          input: command.input,
        };
      return { status: error.status, reason: error.reason };
    }
  }
  return {
    save(accountId: string, raw: unknown): Promise<ConfirmationPlanningResult> {
      const parsed = recordSaveInputSchema.safeParse(raw);
      return parsed.success
        ? plan(accountId, { action: 'save', input: parsed.data })
        : Promise.resolve({ status: 'validation_error', input: raw });
    },
    undo(accountId: string, raw: unknown): Promise<ConfirmationPlanningResult> {
      const parsed = recordUndoInputSchema.safeParse(raw);
      return parsed.success
        ? plan(accountId, { action: 'undo', input: parsed.data })
        : Promise.resolve({ status: 'validation_error', input: raw });
    },
  };
}
