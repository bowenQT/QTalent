import { isDeepStrictEqual } from 'node:util';
import type { z } from 'zod';
import type { RecordBatchDraftSet } from '../../contracts/record';
import type { effectiveRuleVersionReadInputSchema } from '../../contracts/selection-standard';
import {
  MODELINK_MODEL,
  type ModelinkMaasClient,
  type MaasFailureKind,
} from '../integrations/maas';
import {
  prepareBatch,
  prepareBatchSources,
  batchId,
  type BatchIdentityLedger,
  type BatchPreparation,
  type BatchRuleBundle,
  type BatchSnapshot,
  type PreparedBatch,
  type BatchQuote,
} from '../modules/records/arrange/batch';
import {
  batchMessages,
  BATCH_PROMPT_VERSION,
  modelBatchSchema,
} from '../modules/records/arrange/batch-prompt';
import {
  materializeBatch,
  validateBatchModel,
  type ValidatedBatch,
} from '../modules/records/arrange/batch-validate';

export type BatchArrangeRequest = {
  accountId: string;
  batchId: string;
  operationId: string;
  attempt: number;
};
export type BatchArrangeTrace = {
  inputVersion: string;
  boundAt: string;
  occurredOn: string;
  fingerprint: string;
  promptVersion: typeof BATCH_PROMPT_VERSION;
  modelVersion: typeof MODELINK_MODEL;
  dimensionVersionId: string;
  anchorVersionId: string;
};
export type BatchArrangeCommit = BatchArrangeTrace & {
  events: { eventKey: string; draftId: string; witnesses: BatchQuote[] }[];
};
export type BatchArrangeOutcome =
  | Exclude<BatchPreparation, { status: 'ready' }>
  | { status: 'drafts'; draftSet: RecordBatchDraftSet }
  | { status: 'ignored' | 'cancelled' }
  | {
      status: 'failed';
      kind: MaasFailureKind | 'input_changed';
      retryable: boolean;
    };
export type BatchArrangeOperation = {
  accountId: string;
  batchId: string;
  operationId: string;
  attempt: number;
  inputVersion: string;
  phase:
    'queued' | 'running' | 'done' | 'failed' | 'needs_review' | 'cancelled';
  cancelRequested: boolean;
  failure: {
    kind: MaasFailureKind | 'input_changed';
    retryable: boolean;
  } | null;
  trace: BatchArrangeTrace | null;
  draftSet: RecordBatchDraftSet | null;
};
export type BatchArrangeTransaction = {
  operation: BatchArrangeOperation | null;
  /** Load current identity, permissions, membership/binding facts inside this tx. */
  loadSnapshot(): Promise<BatchSnapshot | null>;
  /** Adapter calls922 readEffectiveRuleVersion on this native tx, then loads its content. */
  readRules(
    input: z.infer<typeof effectiveRuleVersionReadInputSchema>,
  ): Promise<BatchRuleBundle | null>;
  saveOperation(value: BatchArrangeOperation): Promise<void>;
  /** Native server ledger assigns first IDs and returns prior IDs/drafts on revision.
   * Same operation/input must reuse reservations. Model keys are not durable IDs.
   */
  reserveIdentities(plan: ValidatedBatch): Promise<BatchIdentityLedger>;
  /** Same native transaction as reservations, job/operation and source metadata. */
  persistDraftSet(
    value: RecordBatchDraftSet,
    trace: BatchArrangeCommit,
  ): Promise<RecordBatchDraftSet>;
};
export type BatchArrangePorts = {
  locked<T>(
    request: BatchArrangeRequest,
    callback: (tx: BatchArrangeTransaction) => Promise<T>,
  ): Promise<T>;
};
export function createRecordBatchArrange(
  ports: BatchArrangePorts,
  client: ModelinkMaasClient,
) {
  return async (
    request: BatchArrangeRequest,
    signal?: AbortSignal,
  ): Promise<BatchArrangeOutcome> => {
    if (
      ![request.accountId, request.batchId, request.operationId].every(
        (id) => batchId.safeParse(id).success,
      )
    )
      return { status: 'ignored' };
    function sameOperation(op: BatchArrangeOperation) {
      return (
        op.accountId === request.accountId &&
        op.batchId === request.batchId &&
        op.operationId === request.operationId
      );
    }
    async function load(tx: BatchArrangeTransaction) {
      const snapshot = await tx.loadSnapshot();
      if (
        !snapshot ||
        snapshot.accountId !== request.accountId ||
        snapshot.batchId !== request.batchId ||
        snapshot.inputVersion !== tx.operation?.inputVersion
      )
        return { status: 'not_found' } as const;
      const authorized = prepareBatchSources(snapshot);
      if (authorized.status !== 'ready') return authorized;
      const rules = await tx.readRules({
        category: 'dimension_anchors',
        at: snapshot.boundAt,
      });
      return rules === null
        ? ({ status: 'not_ready', reason: 'rules_unavailable' } as const)
        : prepareBatch(snapshot, rules);
    }
    const claimed = await ports.locked(
      request,
      async (
        tx,
      ): Promise<
        | { outcome: BatchArrangeOutcome }
        | { prepared: PreparedBatch; trace: BatchArrangeTrace }
      > => {
        const op = tx.operation;
        if (
          !op ||
          !sameOperation(op) ||
          op.attempt !== request.attempt ||
          !Number.isInteger(request.attempt) ||
          request.attempt < 1 ||
          request.attempt > 2
        )
          return { outcome: { status: 'ignored' } as const };
        if (op.cancelRequested || signal?.aborted) {
          await tx.saveOperation({ ...op, phase: 'cancelled' });
          return { outcome: { status: 'cancelled' } as const };
        }
        if (
          op.attempt > 1 &&
          op.phase === 'queued' &&
          !(op.failure?.kind === 'network' && op.failure.retryable)
        )
          return { outcome: { status: 'ignored' } as const };
        if (!['queued', 'done'].includes(op.phase))
          return { outcome: { status: 'ignored' } as const };
        const prepared = await load(tx);
        if (prepared.status !== 'ready') {
          if (prepared.status === 'needs_review')
            await tx.saveOperation({ ...op, phase: 'needs_review' });
          return { outcome: prepared };
        }
        if (op.phase === 'done')
          return {
            outcome:
              op.draftSet &&
              op.draftSet.revision === prepared.value.snapshot.batchRevision &&
              op.trace?.modelVersion === MODELINK_MODEL &&
              op.trace.promptVersion === BATCH_PROMPT_VERSION &&
              op.trace.fingerprint === prepared.value.fingerprint
                ? { status: 'drafts' as const, draftSet: op.draftSet }
                : {
                    status: 'failed' as const,
                    kind: 'input_changed' as const,
                    retryable: false,
                  },
          };
        const trace: BatchArrangeTrace = {
          inputVersion: prepared.value.snapshot.inputVersion,
          boundAt: prepared.value.snapshot.boundAt,
          occurredOn: prepared.value.snapshot.occurredOn,
          fingerprint: prepared.value.fingerprint,
          promptVersion: BATCH_PROMPT_VERSION,
          modelVersion: MODELINK_MODEL,
          dimensionVersionId: prepared.value.rules.dimensionVersionId,
          anchorVersionId: prepared.value.rules.anchorVersionId,
        };
        await tx.saveOperation({
          ...op,
          phase: 'running',
          trace,
          failure: null,
        });
        return { prepared: prepared.value, trace };
      },
    );
    if ('outcome' in claimed) return claimed.outcome;
    let result: Awaited<ReturnType<ModelinkMaasClient['generateStructured']>>;
    try {
      result = await client.generateStructured({
        messages: batchMessages(claimed.prepared),
        promptVersion: BATCH_PROMPT_VERSION,
        schema: modelBatchSchema,
        signal,
      });
    } catch {
      result = {
        ok: false,
        kind: 'outcome_unknown',
        retryable: false,
        metadata: {
          model: MODELINK_MODEL,
          promptVersion: BATCH_PROMPT_VERSION,
          attempts: 1,
          elapsedMs: 0,
        },
      };
    }
    return ports.locked(request, async (tx): Promise<BatchArrangeOutcome> => {
      const op = tx.operation;
      if (
        !op ||
        !sameOperation(op) ||
        op.phase !== 'running' ||
        op.attempt !== request.attempt ||
        !isDeepStrictEqual(op.trace, claimed.trace)
      )
        return { status: 'ignored' };
      if (op.cancelRequested || signal?.aborted) {
        await tx.saveOperation({ ...op, phase: 'cancelled' });
        return { status: 'cancelled' };
      }
      const fresh = await load(tx);
      let failure: Extract<BatchArrangeOutcome, { status: 'failed' }> | null =
        null;
      if (
        fresh.status !== 'ready' ||
        fresh.value.snapshot.batchRevision !==
          claimed.prepared.snapshot.batchRevision ||
        fresh.value.fingerprint !== claimed.trace.fingerprint
      )
        failure = { status: 'failed', kind: 'input_changed', retryable: false };
      else if (!result.ok)
        failure = {
          status: 'failed',
          kind: result.kind,
          retryable: result.kind === 'network' && result.retryable,
        };
      else if (
        result.metadata.model !== MODELINK_MODEL ||
        result.metadata.promptVersion !== BATCH_PROMPT_VERSION
      )
        failure = {
          status: 'failed',
          kind: 'invalid_response',
          retryable: false,
        };
      if (failure) {
        await tx.saveOperation({
          ...op,
          phase: 'failed',
          failure: { kind: failure.kind, retryable: failure.retryable },
        });
        return failure;
      }
      if (!result.ok || fresh.status !== 'ready')
        throw new Error('unreachable_batch_state');
      let plan: ValidatedBatch;
      try {
        plan = validateBatchModel(fresh.value, result.value);
      } catch {
        const failure = {
          status: 'failed' as const,
          kind: 'invalid_response' as const,
          retryable: false,
        };
        await tx.saveOperation({
          ...op,
          phase: 'failed',
          failure: { kind: failure.kind, retryable: failure.retryable },
        });
        return failure;
      }
      const identities = await tx.reserveIdentities(plan);
      const value = materializeBatch(fresh.value, plan, identities);
      const metadata: BatchArrangeCommit = {
        ...claimed.trace,
        events: plan.events.map((event) => ({
          eventKey: event.eventKey,
          draftId: identities.drafts.find(
            (slot) => slot.eventKey === event.eventKey,
          )!.draftId,
          witnesses: event.evidence,
        })),
      };
      const persisted = await tx.persistDraftSet(value, metadata);
      if (!isDeepStrictEqual(value, persisted))
        throw new Error('batch_writer_contract_mismatch');
      await tx.saveOperation({ ...op, phase: 'done', draftSet: persisted });
      return { status: 'drafts', draftSet: persisted };
    });
  };
}
